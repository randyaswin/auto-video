import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import { estimateWordTimings } from '@shared/captions'
import type { Asset, CameraPresetId } from '@shared/types'
import { emit } from './events'
import { assetAbsPath } from './paths'
import { getClip, getProject, insertAsset, patchClip } from './repo'
import { probeDurationMs, probeSize } from './services/audio'

export type ClipMediaKind = 'image' | 'video' | 'audio'

const DIRS: Record<ClipMediaKind, string> = { image: 'images', video: 'videos', audio: 'audio' }
const GLIDE: CameraPresetId[] = ['zoomin', 'panright', 'zoomout', 'panleft', 'kenburns']

/**
 * Imported footage is usually shorter than the scene it plays in, and the exporter pads the tail by
 * cloning its last frame — with a still camera that tail reads as a frozen player. So an import never
 * keeps a static camera; the move varies per clip so neighbouring scenes do not drift the same way.
 */
function glideFor(clipId: string): CameraPresetId {
  const seed = [...clipId].reduce((n, ch) => n + ch.charCodeAt(0), 0)
  return GLIDE[seed % GLIDE.length]
}
const DEFAULT_EXT: Record<ClipMediaKind, string> = { image: '.png', video: '.mp4', audio: '.wav' }

/**
 * Puts a media file made outside the app (NexaBot, another generator, a phone) onto one clip the
 * same way a generation job would: asset row, clip binding, and estimated caption timings for
 * audio. From there the editor and the exporter treat it exactly like a generated asset, so a
 * project can use any media provider without the app knowing that provider's API.
 */
export async function importClipMedia(projectId: string, clipId: string, kind: ClipMediaKind, src: string): Promise<Asset> {
  getProject(projectId)
  const clip = getClip(clipId)
  if (clip.projectId !== projectId) throw new Error('Klip ini bukan milik proyek tersebut')

  const ext = extname(src).toLowerCase() || DEFAULT_EXT[kind]
  const rel = `${DIRS[kind]}/${randomUUID()}${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  copyFileSync(src, abs)

  const durationMs = kind === 'image' ? null : await probeDurationMs(abs).catch(() => null)
  if (kind !== 'image' && !durationMs) throw new Error('Berkas tidak terbaca sebagai media. Pastikan formatnya benar.')
  const size = kind === 'image' ? await probeSize(abs).catch(() => null) : null
  if (kind === 'image' && !size) throw new Error('Gambar tidak bisa dibaca. Pakai file PNG, JPG, atau WebP.')

  const asset = insertAsset({
    projectId,
    clipId,
    kind,
    provider: 'local',
    prompt: basename(src),
    localPath: rel,
    durationMs,
    width: size?.width ?? null,
    height: size?.height ?? null,
    ...(kind === 'audio' && clip.narration && durationMs
      ? { meta: { words: estimateWordTimings(clip.narration, durationMs / 1000), estimatedTimings: true } }
      : {})
  })

  const patch =
    kind === 'image'
      ? { imageAssetId: asset.id }
      : kind === 'video'
        ? {
            videoAssetId: asset.id,
            motionType: 'video' as const,
            ...(clip.videoCamera === 'static' ? { videoCamera: glideFor(clipId) } : {})
          }
        : { audioAssetId: asset.id, ...(durationMs ? { durationMs: durationMs + 400 } : {}) }
  patchClip(clipId, patch)
  emit.asset(asset)
  emit.clip({ clipId, patch })
  return asset
}
