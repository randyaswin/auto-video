#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { bootCore } from '../main/bootstrap'
import { getDb } from '../main/db'
import { seedDemo } from '../main/demo'
import { dispatch, importLocalAsset } from '../main/ipc'
import { importClipMedia } from '../main/media'
import { youtubeUpload, youtubeAddSubtitles, saveOauthClient } from '../main/youtube'
import { assetAbsPath } from '../main/paths'
import { getAsset, getBundle, getJob, listProjects } from '../main/repo'
import type { Asset, Job, ProjectBundle } from '../shared/types'

/**
 * Bang Story as an MCP server: one process, the same core the desktop and the web app run, exposed
 * as tools so an agent can take a story from idea to exported MP4. Long work runs as jobs; every
 * generating tool waits for its jobs and reports the files it produced, because an agent cannot
 * subscribe to the event stream.
 */

bootCore()

// A type alias (not an interface): the MCP SDK's result shape has an index signature, and
// interfaces do not get one implicitly.
type ToolResult = {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

const ok = (data: unknown): ToolResult => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }]
})

const bad = (e: unknown): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: (e as Error)?.message ?? String(e) }]
})

/** Wraps a handler so every tool answers with readable JSON instead of a stack trace. */
const guard =
  <A>(fn: (args: A) => Promise<unknown> | unknown) =>
  async (args: A): Promise<ToolResult> => {
    try {
      return ok(await fn(args))
    } catch (e) {
      return bad(e)
    }
  }

const absOf = (a: Asset): string => assetAbsPath(a.projectId, a.localPath)

function summarize(b: ProjectBundle): Record<string, unknown> {
  const byId = new Map(b.assets.map((a) => [a.id, a]))
  const file = (id: string | null): string | null => {
    const a = id ? byId.get(id) : undefined
    return a ? absOf(a) : null
  }
  return {
    projectId: b.project.id,
    title: b.project.title,
    status: b.project.status,
    step: b.project.step,
    durationSec: b.project.durationSec,
    language: b.project.language,
    aspectRatio: b.project.aspectRatio,
    characters: b.characters.map((c) => c.name),
    clips: b.clips.map((c) => ({
      id: c.id,
      sort: c.sort,
      title: c.title,
      narration: c.narration,
      durationMs: c.durationMs,
      image: file(c.imageAssetId),
      video: file(c.videoAssetId),
      voice: file(c.audioAssetId)
    })),
    jobs: b.jobs.filter((j) => j.status === 'queued' || j.status === 'running').map(jobInfo)
  }
}

function jobInfo(j: Job): Record<string, unknown> {
  const asset = getAsset(j.resultAssetId)
  return {
    id: j.id,
    kind: j.kind,
    provider: j.provider,
    status: j.status,
    progress: Math.round(j.progress * 100) / 100,
    message: j.message,
    error: j.error,
    resultFile: asset ? absOf(asset) : null
  }
}

const TERMINAL = new Set(['done', 'failed', 'canceled'])

/** Polls the job table until every id is finished, or the deadline passes. */
async function waitForJobs(ids: string[], timeoutSec: number): Promise<Job[]> {
  const deadline = Date.now() + timeoutSec * 1000
  const jobs = (): Job[] => ids.map((id) => getJob(id)).filter((j): j is Job => !!j)
  for (;;) {
    const current = jobs()
    if (current.length === ids.length && current.every((j) => TERMINAL.has(j.status))) return current
    if (Date.now() > deadline) {
      throw new Error(
        `Masih berjalan setelah ${timeoutSec} detik (${current.map((j) => `${j.kind}:${j.status}`).join(', ') || 'tanpa job'}). Pakai jobs_status untuk melanjutkan pemantauan.`
      )
    }
    await new Promise((r) => setTimeout(r, 700))
  }
}

/** Runs a channel that returns job ids, waits for them, and fails loudly on any that broke. */
async function runJobs(channel: string, args: unknown[], timeoutSec: number): Promise<Record<string, unknown>[]> {
  const out = await dispatch(channel, args)
  const jobs = Array.isArray(out) ? out : [out]
  const ids = jobs.map((j) => (j as Job).id).filter(Boolean)
  if (ids.length === 0) return []
  const done = await waitForJobs(ids, timeoutSec)
  const failed = done.filter((j) => j.status === 'failed')
  if (failed.length) throw new Error(`Job gagal: ${failed.map((j) => `${j.kind}: ${j.error ?? 'tanpa pesan'}`).join('; ')}`)
  return done.map(jobInfo)
}

const server = new McpServer({ name: 'bang-story', version: '1.0.0' })

// ---------- projects ----------

server.registerTool(
  'projects_list',
  { description: 'List every story project with its step, clip count and total duration.' },
  guard(() => listProjects())
)

server.registerTool(
  'projects_create',
  {
    description: 'Create a project from a story idea (synopsis). Returns the project id the other tools need.',
    inputSchema: {
      synopsis: z.string().min(1).describe('The story idea or a one-paragraph synopsis'),
      title: z.string().optional().describe('Optional working title; a default is derived from the synopsis'),
      durationSec: z.number().int().min(30).max(600).optional().describe('Target length, 30 to 600 seconds'),
      language: z.string().optional().describe('Narration language code, e.g. "id" or "en"'),
      aspectRatio: z.enum(['16:9', '9:16']).optional(),
      styleId: z.string().optional().describe('Visual style id, e.g. "stickman"'),
      ttsProvider: z.enum(['gemini', 'elevenlabs']).optional()
    }
  },
  guard(async (a) => {
    const bundle = await dispatch('projects:create', [
      {
        synopsis: a.synopsis,
        ...(a.title ? { title: a.title } : {}),
        ...(a.durationSec ? { durationSec: a.durationSec } : {}),
        ...(a.language ? { language: a.language } : {}),
        ...(a.aspectRatio ? { aspectRatio: a.aspectRatio } : {}),
        ...(a.styleId ? { styleId: a.styleId } : {}),
        ...(a.ttsProvider ? { ttsProvider: a.ttsProvider } : {})
      }
    ])
    return summarize(bundle as ProjectBundle)
  })
)

server.registerTool(
  'projects_get',
  {
    description: 'Read one project: settings, characters, and every clip with narration and asset files.',
    inputSchema: { projectId: z.string().min(1) }
  },
  guard(async (a) => summarize(getBundle(a.projectId)))
)

server.registerTool(
  'projects_remove',
  { description: 'Delete a project and its files.', inputSchema: { projectId: z.string().min(1) } },
  guard(async (a) => {
    await dispatch('projects:remove', [a.projectId])
    return `Proyek ${a.projectId} dihapus.`
  })
)

// ---------- script and storyboard ----------

server.registerTool(
  'story_script',
  {
    description:
      'Write the scene-by-scene script (story and voice-over) for a project with the configured LLM. Blocks until the model answers.',
    inputSchema: { projectId: z.string().min(1) }
  },
  guard(async (a) => summarize((await dispatch('story:script', [a.projectId])) as ProjectBundle))
)

server.registerTool(
  'story_visuals',
  {
    description:
      'Plan the visuals of every scene: image prompt, cast, camera move, transition and video direction. "missing" only does scenes whose plan is outdated.',
    inputSchema: {
      projectId: z.string().min(1),
      mode: z.enum(['missing', 'all']).optional().describe('Default: missing')
    }
  },
  guard(async (a) => summarize((await dispatch('story:visuals', [a.projectId, a.mode ?? 'missing'])) as ProjectBundle))
)

server.registerTool(
  'story_music_prompt',
  {
    description: 'A background-music prompt that fits the finished script, for Suno or another music AI.',
    inputSchema: { projectId: z.string().min(1) }
  },
  guard(async (a) => dispatch('story:musicPrompt', [a.projectId]))
)

// ---------- generation ----------

server.registerTool(
  'generate_images',
  {
    description: 'Generate an AI image for every scene that has none. Blocks until the jobs finish and returns the files.',
    inputSchema: { projectId: z.string().min(1), timeoutSec: z.number().int().min(30).max(1800).optional() }
  },
  guard(async (a) => runJobs('generate:missingImages', [a.projectId], a.timeoutSec ?? 900))
)

server.registerTool(
  'generate_videos',
  {
    description: 'Animate every scene image into an AI video. Blocks until the jobs finish and returns the files.',
    inputSchema: { projectId: z.string().min(1), timeoutSec: z.number().int().min(30).max(1800).optional() }
  },
  guard(async (a) => runJobs('generate:missingVideos', [a.projectId], a.timeoutSec ?? 1500))
)

server.registerTool(
  'generate_tts',
  {
    description: 'Speak the voice-over of every scene that has none (TTS per scene).',
    inputSchema: { projectId: z.string().min(1), timeoutSec: z.number().int().min(30).max(1800).optional() }
  },
  guard(async (a) => runJobs('generate:missingTts', [a.projectId], a.timeoutSec ?? 900))
)

server.registerTool(
  'generate_narration',
  {
    description:
      'Record the whole narration as one continuous take and cut it per scene, keeping the voice consistent. Caption words are estimated unless the local Whisper model is installed.',
    inputSchema: {
      projectId: z.string().min(1),
      mode: z.enum(['missing', 'all']).optional().describe('Default: missing'),
      timeoutSec: z.number().int().min(30).max(1800).optional()
    }
  },
  guard(async (a) => runJobs('generate:narration', [a.projectId, a.mode ?? 'missing'], a.timeoutSec ?? 1200))
)

server.registerTool(
  'sync_captions',
  {
    description:
      'Re-time caption words against the recorded voice with the local Whisper model. Needs whisper-cli on PATH; overwrites hand-edited captions.',
    inputSchema: {
      projectId: z.string().min(1),
      mode: z.enum(['stale', 'all']).optional().describe('Default: stale'),
      timeoutSec: z.number().int().min(30).max(1800).optional()
    }
  },
  guard(async (a) => runJobs('generate:syncCaptions', [a.projectId, a.mode ?? 'stale'], a.timeoutSec ?? 900))
)

// ---------- edit and export ----------

server.registerTool(
  'clips_split',
  {
    description: 'Split one clip in two at a timestamp, so a scene can be retimed.',
    inputSchema: { clipId: z.string().min(1), atMs: z.number().int().min(0) }
  },
  guard(async (a) => summarize((await dispatch('clips:split', [a.clipId, a.atMs])) as ProjectBundle))
)

server.registerTool(
  'assets_import',
  {
    description: 'Copy a file the server can read (background music, logo or watermark) into a project as an asset.',
    inputSchema: {
      projectId: z.string().min(1),
      kind: z.enum(['music', 'overlay']),
      path: z.string().min(1).describe('Absolute path of the file on this machine')
    }
  },
  guard(async (a) => importLocalAsset(a.projectId, a.kind, a.path))
)

server.registerTool(
  'media_import',
  {
    description:
      'Attach an image, video or voice file the server can read to one clip, as if the app had generated it. Use this to feed media from NexaBot (or any other generator) into a project.',
    inputSchema: {
      projectId: z.string().min(1),
      clipId: z.string().min(1),
      kind: z.enum(['image', 'video', 'audio']),
      path: z.string().min(1).describe('Absolute path of the media file on the laptop')
    }
  },
  guard(async (a) => importClipMedia(a.projectId, a.clipId, a.kind, a.path))
)

server.registerTool(
  'youtube_set_client',
  {
    description:
      'Store the Google OAuth client id and secret used for YouTube uploads (one-time setup, saved mode 600).',
    inputSchema: { clientId: z.string().min(1), clientSecret: z.string().min(1) }
  },
  guard(async (a) => {
    saveOauthClient(a.clientId, a.clientSecret)
    return 'Kredensial OAuth YouTube tersimpan. Selanjutnya jalankan scripts/youtube-auth.mjs untuk mengambil refresh token.'
  })
)

server.registerTool(
  'youtube_upload',
  {
    description:
      'Upload a finished MP4 to YouTube (resumable, streamed from disk). Needs the refresh token from scripts/youtube-auth.mjs. Default privacy is private so nothing goes public by accident.',
    inputSchema: {
      path: z.string().min(1).describe('Absolute path of the MP4 on the laptop'),
      subtitlesPath: z
        .string()
        .optional()
        .describe('Optional .srt written by the exporter (writeSrt) — uploaded as a toggleable CC track'),
      title: z.string().min(1).max(100),
      description: z.string().max(4800).optional(),
      tags: z.array(z.string()).max(30).optional(),
      privacy: z.enum(['private', 'unlisted', 'public']).optional().default('private'),
      categoryId: z.string().optional().describe('YouTube category id, default 27 (Education)')
    }
  },
  guard(async (a) => youtubeUpload(a))
)

server.registerTool(
  'youtube_add_subtitles',
  {
    description:
      'Attach an .srt caption track to an already uploaded video so viewers can toggle it as YouTube CC.',
    inputSchema: {
      videoId: z.string().min(1).describe('YouTube video id, e.g. -f5zl-hd70I'),
      subtitlesPath: z.string().min(1).describe('Absolute path of the .srt on the laptop')
    }
  },
  guard(async (a) => youtubeAddSubtitles(a.videoId, a.subtitlesPath))
)

server.registerTool(
  'export_video',
  {
    description:
      'Render the project to MP4 with FFmpeg (captions, camera moves, transitions, music ducking). Blocks until the render finishes and returns the output path.',
    inputSchema: {
      projectId: z.string().min(1),
      fileName: z.string().optional().describe('Output name without extension'),
      resolution: z.union([z.literal(720), z.literal(1080), z.literal(2160)]).optional(),
      fps: z.union([z.literal(30), z.literal(60)]).optional(),
      burnCaptions: z.boolean().optional().describe('Burn karaoke captions into the picture (default true)'),
      writeSrt: z.boolean().optional(),
      timeoutSec: z.number().int().min(60).max(3600).optional()
    }
  },
  guard(async (a) => {
    const folder = (await dispatch('export:defaultFolder', [])) as string
    const [job] = await runJobs(
      'export:start',
      [
        a.projectId,
        {
          fileName: a.fileName ?? `bang-story-${Date.now()}`,
          resolution: a.resolution ?? 1080,
          fps: a.fps ?? 30,
          burnCaptions: a.burnCaptions ?? true,
          writeSrt: a.writeSrt ?? false,
          normalizeAudio: true,
          duckMusic: true,
          folder
        }
      ],
      a.timeoutSec ?? 1800
    )
    return { ...job, folder, file: job.message ?? null }
  })
)

// ---------- status and setup ----------

server.registerTool(
  'jobs_status',
  {
    description: 'List recent jobs with progress, errors and produced files.',
    inputSchema: { projectId: z.string().optional(), limit: z.number().int().min(1).max(200).optional() }
  },
  guard(async (a) => {
    const rows = getDb()
      .prepare(
        `SELECT id FROM jobs ${a.projectId ? 'WHERE project_id = ?' : ''} ORDER BY created_at DESC LIMIT ?`
      )
      .all(...(a.projectId ? [a.projectId, a.limit ?? 50] : [a.limit ?? 50])) as { id: string }[]
    return rows.map((r) => getJob(r.id)).filter((j): j is Job => !!j).map(jobInfo)
  })
)

server.registerTool(
  'settings_get',
  { description: 'Current settings: LLM provider and models, TTS voice, default media models, export folder.' },
  guard(() => dispatch('settings:get', []))
)

server.registerTool(
  'settings_set',
  {
    description: 'Change settings. Partial patch, e.g. {"llmProvider":"groq","llmModels":{"groq":"llama-3.3-70b"}}.',
    inputSchema: { patch: z.record(z.string(), z.unknown()) }
  },
  guard(async (a) => dispatch('settings:set', [a.patch]))
)

server.registerTool(
  'settings_set_key',
  {
    description:
      'Store an API key (higgsfield, gemini, elevenlabs, openrouter, groq) and test it. Keys are encrypted at rest and never logged.',
    inputSchema: { provider: z.enum(['higgsfield', 'gemini', 'elevenlabs', 'openrouter', 'groq', 'custom']), key: z.string().min(1) }
  },
  guard(async (a) => dispatch('settings:setKey', [a.provider, a.key]))
)

server.registerTool(
  'settings_keys',
  { description: 'Which API keys are configured, masked, with their last test result.' },
  guard(() => dispatch('settings:keys', []))
)

server.registerTool('whisper_status', { description: 'Local Whisper model state, for word-accurate captions.' }, guard(() =>
  dispatch('whisper:status', [])
))

server.registerTool(
  'demo_seed',
  {
    description:
      'Create a four-scene demo project from synthetic media — proves the whole pipeline renders without spending API credits.'
  },
  guard(() => summarize(getBundle(seedDemo())))
)

async function main(): Promise<void> {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('bang-story MCP siap (stdio)')
}

void main()
