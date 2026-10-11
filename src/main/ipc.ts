import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import {
  appVersion,
  copyText,
  defaultVideosDir,
  openExternal,
  pickPath,
  showItemInFolder
} from './platform'
import type {
  ApiProvider,
  Asset,
  AppSettings,
  AspectRatio,
  ExportOptions,
  KeyTestResult,
  ModelSource,
  NewProjectInput,
  ProjectSnapshot,
  TtsProvider,
  VoiceOption,
  WordTiming
} from '@shared/types'
import { startExport } from './exporter'
import {
  estimateCredits,
  forgetEstimates,
  generateCharacterSheet,
  generateClipImage,
  generateClipTts,
  generateClipVideo,
  generateMissingImages,
  generateMissingVideos,
  generateMissingTts,
  setActiveAsset
} from './generation'
import { cancelJob } from './jobs'
import { generateNarration, syncCaptions } from './narration'
import { cancelDownload, downloadModel, openModelFolder, removeModel, whisperStatus } from './whisper'
import { assetAbsPath } from './paths'
import { detachVoice, splitClip } from './editing'
import { emit } from './events'
import {
  createProject,
  duplicateProject,
  getAsset,
  getBundle,
  getProject,
  insertAsset,
  listProjects,
  removeProject,
  saveSnapshot,
  updateAssetMeta
} from './repo'
import { clearSecret, keyStatuses, recordCheck, revealSecret, setSecret } from './secrets'
import { dropCache, getSettings, setSettings } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as hf from './services/higgsfield'
import * as llm from './services/llm'
import { generateScript, generateVisuals, generateMusicPrompt } from './story'
import { importClipMedia } from './media'


type Handler = (...args: any[]) => unknown

const handlers = new Map<string, Handler>()
let built = false

function handle(channel: string, fn: Handler): void {
  handlers.set(channel, fn)
}

/**
 * Runs one API channel. The same registry backs the Electron IPC bridge, the web server's
 * `/api/call` route and the MCP server, so every host executes identical behaviour.
 */
export async function dispatch(channel: string, args: unknown[]): Promise<unknown> {
  registerHandlers()
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`Kanal tidak dikenal: ${channel}`)
  try {
    return await fn(...args)
  } catch (e) {
    // Only the message crosses the IPC boundary; keep it readable for the user.
    throw new Error((e as Error)?.message ?? String(e))
  }
}

export function channels(): string[] {
  registerHandlers()
  return [...handlers.keys()]
}

async function testProvider(provider: ApiProvider, key?: string): Promise<KeyTestResult> {
  if (provider === 'higgsfield') return hf.testCredentials(key)
  if (provider === 'elevenlabs') return eleven.testKey(key)
  return llm.testLlm(provider, key)
}

function defaultExportFolder(): string {
  return getSettings().exportFolder ?? defaultVideosDir()
}

function registerHandlers(): void {
  if (built) return
  built = true
  handle('projects:list', () => listProjects())
  handle('projects:create', (input: NewProjectInput) => getBundle(createProject(input).id))
  handle('projects:get', (id: string) => getBundle(id))
  handle('projects:save', (snap: ProjectSnapshot) => ({ updatedAt: saveSnapshot(snap) }))
  handle('projects:remove', (id: string) => removeProject(id))
  handle('projects:duplicate', (id: string) => duplicateProject(id))

  handle('story:script', (projectId: string, sceneCount?: number) => generateScript(projectId, sceneCount))
  handle('story:musicPrompt', (projectId: string) => generateMusicPrompt(projectId))
  handle('story:visuals', (projectId: string, mode: 'missing' | 'all') => generateVisuals(projectId, mode === 'all' ? 'all' : 'missing'))

  handle('generate:clipImage', (clipId: string) => generateClipImage(clipId))
  handle('generate:clipVideo', (clipId: string) => generateClipVideo(clipId))
  handle('generate:clipTts', (clipId: string) => generateClipTts(clipId))
  handle('generate:characterSheet', (characterId: string) => generateCharacterSheet(characterId))
  handle('generate:missingImages', (projectId: string) => generateMissingImages(projectId))
  handle('generate:missingVideos', (projectId: string) => generateMissingVideos(projectId))
  handle('generate:missingTts', (projectId: string) => generateMissingTts(projectId))
  handle('generate:narration', (projectId: string, mode: 'missing' | 'all') => generateNarration(projectId, mode === 'all' ? 'all' : 'missing'))
  handle('generate:syncCaptions', (projectId: string, mode?: 'stale' | 'all') => syncCaptions(projectId, mode === 'all' ? 'all' : 'stale'))

  handle('whisper:status', () => whisperStatus())
  // The download runs in the background and reports through whisper events.
  handle('whisper:download', () => {
    void downloadModel().catch(() => {})
  })
  handle('whisper:cancel', () => cancelDownload())
  handle('whisper:remove', () => removeModel())
  handle('whisper:openFolder', () => openModelFolder())
  handle('generate:cancel', (jobId: string) => cancelJob(jobId))
  handle('generate:estimate', (kind: 'image' | 'video', modelId: string, aspect: AspectRatio, seconds?: number, resolution?: string | null) =>
    estimateCredits(kind, modelId, aspect, seconds, resolution)
  )

  handle('assets:setActive', (clipId: string, assetId: string) => setActiveAsset(clipId, assetId))
  handle('clips:split', (clipId: string, atMs: number) => splitClip(clipId, Number(atMs)))
  handle('clips:detachVoice', (clipId: string) => detachVoice(clipId))
  // Caption text fixed by hand in the editor; the words keep their times.
  handle('assets:setWords', (assetId: string, words: WordTiming[]) => {
    const a = getAsset(assetId)
    if (!a || a.kind !== 'audio') throw new Error('Suara klip tidak ditemukan')
    const clean = (Array.isArray(words) ? words : [])
      .filter((w) => w && typeof w.text === 'string' && w.text.trim() && Number.isFinite(w.start) && Number.isFinite(w.end))
      .map((w) => ({ text: w.text.trim(), start: Math.max(0, w.start), end: Math.max(w.start, w.end) }))
    updateAssetMeta(a.id, { ...a.meta, words: clean, editedWords: true })
    const fresh = getAsset(a.id)!
    emit.asset(fresh)
    return fresh
  })
  // Media made by any generator outside the app (NexaBot, a phone) lands on a clip through here.
  handle('assets:importClip', (projectId: string, clipId: string, kind: 'image' | 'video' | 'audio', src: string) =>
    importClipMedia(projectId, clipId, kind, src)
  )

  handle('assets:pickMusic', async (projectId: string) => {
    const src = await pickPath({ title: 'Pilih musik latar', extensions: ['mp3', 'wav', 'm4a', 'ogg'] })
    if (!src) return null
    return importLocalAsset(projectId, 'music', src)
  })

  handle('assets:pickImage', async (projectId: string) => {
    const src = await pickPath({ title: 'Pilih gambar logo atau watermark', extensions: ['png', 'jpg', 'jpeg', 'webp'] })
    if (!src) return null
    return importLocalAsset(projectId, 'overlay', src)
  })

  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<AppSettings>) => setSettings(patch))
  handle('settings:keys', () => keyStatuses())
  handle('settings:setKey', async (provider: ApiProvider, key: string) => {
    const clean = key.trim()
    if (!clean) throw new Error('Kunci masih kosong')
    setSecret(provider, clean)
    dropCache(`models:${provider}`)
    if (provider === 'gemini') dropCache('models:gemini-tts')
    if (provider === 'higgsfield') forgetEstimates()
    const result = await testProvider(provider, clean)
    recordCheck(provider, result.ok, result.message)
    return result
  })
  handle('settings:setCustom', async (baseUrl: string, key: string) => {
    const url = baseUrl.trim().replace(/\/+$/, '')
    if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Alamat endpoint harus diawali http:// atau https://')
    setSettings({ customBaseUrl: url })
    if (key.trim()) setSecret('custom', key.trim())
    dropCache('models:custom')
    const result = await llm.testLlm('custom', key.trim() || undefined, url)
    recordCheck('custom', result.ok, result.message)
    return result
  })
  handle('settings:clearKey', (provider: ApiProvider) => {
    clearSecret(provider)
    dropCache(`models:${provider}`)
    if (provider === 'higgsfield') forgetEstimates()
    if (provider === 'custom') setSettings({ customBaseUrl: '' })
  })
  handle('models:list', (source: ModelSource, refresh?: boolean) => llm.listModels(source, !!refresh))
  handle('settings:testKey', async (provider: ApiProvider) => {
    const result = await testProvider(provider).catch((e): KeyTestResult => ({ ok: false, message: (e as Error).message }))
    recordCheck(provider, result.ok, result.message)
    return result
  })
  handle('settings:revealKey', (provider: ApiProvider) => revealSecret(provider))
  handle('settings:voices', async (provider: TtsProvider): Promise<VoiceOption[]> => {
    if (provider === 'gemini') return gemini.listVoices()
    return eleven.listVoices()
  })

  handle('export:start', (projectId: string, opts: ExportOptions) => startExport(projectId, opts))
  handle('export:defaultFolder', () => defaultExportFolder())
  handle('export:pickFolder', async () => {
    const dir = await pickPath({ title: 'Pilih folder ekspor', defaultPath: defaultExportFolder(), directory: true })
    if (!dir) return null
    setSettings({ exportFolder: dir })
    return dir
  })
  handle('export:reveal', (path: string) => showItemInFolder(path))

  handle('app:version', () => appVersion())
  handle('app:copyText', (text: string) => copyText(String(text)))
  handle('app:openExternal', (url: string) => {
    if (/^https:\/\//i.test(url)) return openExternal(url)
    return undefined
  })
}

/**
 * Copies a file that lives outside the app's data folder (native dialog, HTTP upload, a path the
 * MCP client knows) into the project and registers it as an asset, so every host shares one rule set.
 */
export async function importLocalAsset(projectId: string, kind: 'music' | 'overlay', src: string): Promise<Asset> {
  getProject(projectId)
  const rel = `${kind === 'music' ? 'music' : 'overlays'}/${randomUUID()}${extname(src).toLowerCase()}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  copyFileSync(src, abs)
  if (kind === 'music') {
    const durationMs = await probeDurationMs(abs).catch(() => null)
    return insertAsset({
      projectId,
      kind: 'music',
      provider: 'local',
      prompt: basename(src) ?? 'musik',
      localPath: rel,
      durationMs
    })
  }
  const size = await probeSize(abs).catch(() => null)
  if (!size) throw new Error('Gambar tidak bisa dibaca. Pakai file PNG, JPG, atau WebP.')
  return insertAsset({
    projectId,
    kind: 'overlay',
    provider: 'local',
    prompt: basename(src),
    localPath: rel,
    width: size.width,
    height: size.height
  })
}

/** Binds every channel to `ipcMain`. Only the Electron entry may call this. */
export function registerIpc(): void {
  registerHandlers()
  const { ipcMain } = require('electron') as typeof import('electron')
  for (const channel of handlers.keys()) {
    ipcMain.handle(channel, (_e, ...args: unknown[]) => dispatch(channel, args))
  }
}
