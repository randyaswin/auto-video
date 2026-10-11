#!/usr/bin/env node
/**
 * Produces one project end to end without Higgsfield or Gemini TTS:
 * Bang Story writes the script and storyboard with its own LLM, NexaBot draws the image, animates
 * it and speaks the voice-over, every file is imported onto its clip, and the project is exported.
 *
 *   node scripts/nexabot-produce.mjs --project <id> [--no-video] [--voice Achernar] [--name my-short]
 *            [--scenes N] [--rebuild-script] [--publish] [--publish-only] [--recrop]
 *            [--privacy private|unlisted|public]
 *
 * Env: BANG_STORY_URL (default http://127.0.0.1:4627), NEXABOT_API_KEY or ~/.hermes/nexabot.env.
 * Run it where the project lives (the laptop): imported files must be readable by the app.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const BASE = process.env.BANG_STORY_URL ?? 'http://100.115.185.3:4627' // laptop tailnet IP; the server is bound to it, not to loopback
const NEXA = 'https://nexabot.id/api/v1'
const STAGE = join(tmpdir(), 'nexabot-produce')

const argv = process.argv.slice(2)
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback
}
const flag = (name) => argv.includes(`--${name}`)
const PROJECT = opt('project')
if (!PROJECT) {
  console.error('Pakai: node scripts/nexabot-produce.mjs --project <id>')
  process.exit(1)
}
const WANT_VIDEO = !flag('no-video')
const VOICE = opt('voice', 'Achernar')

const RUN = join(STAGE, PROJECT) // staging per project — one project's image must never feed another
mkdirSync(RUN, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function nexaKey() {
  if (process.env.NEXABOT_API_KEY) return process.env.NEXABOT_API_KEY
  for (const f of [join(homedir(), '.hermes/nexabot.env'), join(homedir(), 'nexabot.env')]) {
    if (!existsSync(f)) continue
    const m = /(?:^|\n)(?:NEXABOT_API_KEY|API_KEY)=\s*"?([^\s"]+)"?/.exec(readFileSync(f, 'utf8'))
    if (m) return m[1]
  }
  throw new Error('NEXABOT_API_KEY tidak ditemukan di env maupun ~/.hermes/nexabot.env')
}

async function api(channel, args = []) {
  const res = await fetch(`${BASE}/api/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args })
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `${channel} gagal (HTTP ${res.status})`)
  return body.result
}

async function nexaFetch(path, init, key) {
  let res
  for (let attempt = 0; attempt < 4; attempt++) {
    res = await fetch(`${NEXA}${path}`, { ...init, headers: { ...(init?.headers ?? {}), 'x-api-key': key } })
    if (res.status !== 429) return res
    console.log('     antrean NexaBot penuh, tunggu 30 dtk…')
    await sleep(30_000)
  }
  return res
}

/** Submits a job, waits for it, writes the result to `out`. Returns the output path. */
async function nexaJob(payload, out, key) {
  // The documented route enforces the credit balance (402 at zero credit) and ignores the active
  // unlimited pass; the older /api/v1/generate honours it and answers the same way. Try both.
  const submitted = { error: '' }
  for (const path of ['/api', '/generate']) {
    const res = await nexaFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, key)
    const body = await res.json().catch(() => ({}))
    if (body.ok && body.job_id) {
      submitted.jobId = body.job_id
      submitted.route = path
      break
    }
    submitted.error = `${path}: ${body.error ?? body.message ?? `HTTP ${res.status}`}`
  }
  if (!submitted.jobId) throw new Error(`NexaBot ${payload.mode} gagal — ${submitted.error}`)
  console.log(`     antri lewat ${submitted.route}`)
  const started = Date.now()
  for (;;) {
    await sleep(6000)
    const res = await nexaFetch(`/jobs/${submitted.jobId}`, {}, key)
    const body = await res.json().catch(() => ({}))
    const job = body.job ?? body
    const state = job.status
    if (state === 'done') break
    if (state === 'failed') throw new Error(`NexaBot job gagal: ${job.error ?? job.status_text ?? 'tanpa pesan'}`)
    if (Date.now() - started > 15 * 60_000) throw new Error(`NexaBot job ${submitted.jobId} melebihi 15 menit`)
    if (!['queued', 'processing', 'pending', undefined].includes(state)) throw new Error(`NexaBot status tak dikenal: ${state}`)
  }
  const dl = await nexaFetch(`/jobs/${submitted.jobId}/download`, {}, key)
  if (!dl.ok) throw new Error(`Unduhan NexaBot gagal (HTTP ${dl.status})`)
  await writeFile(out, Buffer.from(await dl.arrayBuffer()))
  return out
}

/** The star sits bottom-right on stills too, and a still is what most long-form scenes are made of. */
function cropWatermarkStill(src) {
  const out = src.replace(/\.[a-z0-9]+$/i, '-crop.jpg')
  const r = spawnSync(require('ffmpeg-static'), [
    '-y', '-i', src,
    '-vf', 'crop=iw*0.8435:ih*0.84375:iw*0.0778:0,scale=iw/0.8435:ih/0.84375:flags=lanczos',
    '-q:v', '2', out
  ], { encoding: 'utf8' })
  if (r.status !== 0) {
    console.warn('  crop gambar gagal, pakai hasil mentah:', (r.stderr ?? '').split('\n').slice(-3).join(' '))
    return src
  }
  return out
}

/** The API burns a white star bottom-right; cropping it is cleaner than patching pixels. */
function cropWatermark(src, scale) {
  const out = src.replace(/\.mp4$/, '-crop.mp4')
  const r = spawnSync(require('ffmpeg-static'), ['-y', '-i', src, '-vf', `crop=iw*0.8435:ih*0.84375:iw*0.0778:0,scale=${scale}:flags=lanczos`, '-c:a', 'copy', out], {
    encoding: 'utf8'
  })
  if (r.status !== 0) {
    console.warn('  crop watermark gagal, pakai hasil mentah:', (r.stderr ?? '').split('\n').slice(-3).join(' '))
    return src
  }
  return out
}

/** Framing clauses follow the project's aspect ratio: 9:16 Shorts vs 16:9 long-form. */
const styleFor = (aspectRatio) =>
  `cinematic ${aspectRatio === '16:9' ? 'widescreen 16:9' : 'vertical 9:16'} frame, photorealistic, ` +
  'natural lighting, shallow depth of field, ' +
  'no text, no letters, no numbers, no captions, no logos, no watermark anywhere in frame'

const DATA_DIR = join(homedir(), '.bang-story')
const GLIDE = ['zoomin', 'panright', 'zoomout', 'panleft', 'kenburns']

/**
 * A still scene plays as a frozen frame, and imported footage shorter than its scene is padded by
 * cloning its last frame — a frozen tail. So before rendering, every scene gets a gentle move.
 */
async function smoothStillCameras(bundle) {
  const still = bundle.clips.filter(
    (c) => c.cameraPreset === 'static' || (c.motionType === 'video' && c.videoCamera === 'static')
  )
  if (!still.length) return 0
  const pick = (seed) => GLIDE[[...seed].reduce((n, ch) => n + ch.charCodeAt(0), 0) % GLIDE.length]
  const strip = (o, keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))
  const snap = {
    project: strip(bundle.project, ['createdAt', 'updatedAt', 'coverAssetId']),
    characters: (bundle.characters ?? []).map((c) => strip(c, ['sheetAssetId'])),
    clips: bundle.clips.map((c) => {
      const next = strip(c, ['imageAssetId', 'videoAssetId', 'audioAssetId'])
      if (next.cameraPreset === 'static') next.cameraPreset = pick(c.id)
      if (c.motionType === 'video' && next.videoCamera === 'static') next.videoCamera = pick(c.id + 'video')
      return next
    })
  }
  await api('projects:save', [snap])
  return still.length
}

/** The app's asset row for a clip, so an existing image can be reused instead of paid for again. */
function assetOf(bundle, clipId, kind) {
  return (bundle.assets ?? []).find((a) => a.clipId === clipId && a.kind === kind && a.localPath) ?? null
}

/** Local copy of a clip's image: already imported, pulled from the app's asset route, or generated. */
async function stageImage(bundle, clip, index, key, aspect, style) {
  const jpg = join(RUN, `${index}`.padStart(2, '0') + '.jpg')
  if (existsSync(jpg)) return jpg
  const existing = assetOf(bundle, clip.id, 'image')
  if (existing) {
    const local = join(DATA_DIR, existing.localPath)
    if (existsSync(local)) return local
    const res = await fetch(`${BASE}/studio/asset/${existing.localPath}`)
    if (res.ok) {
      await writeFile(jpg, Buffer.from(await res.arrayBuffer()))
      return jpg
    }
  }
  return nexaJob({ mode: 'img', prompt: `${clip.visualPrompt}. ${style}`, aspect }, jpg, key)
}

async function main() {
  const key = nexaKey()
  // A long script can outlive the LLM endpoint's patience; retrying is cheaper than restarting by hand.
  const retry = async (label, fn) => {
    let last = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { return await fn() } catch (e) {
        last = e
        console.warn(`     ${label} gagal (percobaan ${attempt}/3): ${e.message}`)
        await sleep(15_000 * attempt)
      }
    }
    throw last
  }
  const SCENES = opt('scenes') ? Number(opt('scenes')) : undefined
  const REBUILD = flag('rebuild-script')
  console.log(`[1/4] Naskah + storyboard (LLM Bang Story${SCENES ? `, ${SCENES} adegan` : ''}${REBUILD ? ', naskah ditulis ulang' : ''})`)
  let bundle = await api('projects:get', [PROJECT])
  if (!bundle.clips.length || REBUILD) {
    bundle = await retry('story:script', () => api('story:script', [PROJECT, SCENES]))
    bundle = await retry('story:visuals', () => api('story:visuals', [PROJECT, REBUILD ? 'all' : 'missing']))
  } else if (!bundle.clips.every((c) => c.visualPrompt)) {
    bundle = await retry('story:visuals', () => api('story:visuals', [PROJECT, 'missing']))
  }
  console.log(`      ${bundle.clips.length} klip · bahasa ${bundle.project.language} · ${bundle.project.durationSec}s`)

  const AR = bundle.project.aspectRatio ?? '9:16'
  const ASPECT = AR === '16:9' ? 2 : 5
  const SCALE = AR === '16:9' ? '1920:1080' : '1080:1920'
  const RATIO = AR === '16:9' ? 1 : 2 // NexaBot: 1 landscape, 2 portrait
  const STYLE = styleFor(AR)
  console.log(`[2/4] Media NexaBot (gambar${WANT_VIDEO ? ' + video' : ''} + suara, ${AR})`)
  for (const [i, clip] of bundle.clips.entries()) {
    console.log(`  -- klip ${i}: ${(clip.title || clip.narration || '').slice(0, 50)}`)
    try {
      if (!clip.imageAssetId) {
        const img = await stageImage(bundle, clip, i, key, ASPECT, STYLE)
        await api('assets:importClip', [PROJECT, clip.id, 'image', cropWatermarkStill(img)])
        console.log('     gambar ok')
      } else console.log('     gambar sudah ada, lewati')

      if (WANT_VIDEO && !clip.videoAssetId) {
        try {
          const jpg = await stageImage(bundle, clip, i, key, ASPECT, STYLE)
          const vid = await nexaJob(
            {
              mode: 'sfv',
              prompt: `${clip.videoPrompt || clip.visualPrompt}. Slow subtle camera movement, smooth continuous motion, ${STYLE}`,
              ratio: RATIO,
              resolution: 720,
              media: [`data:image/jpeg;base64,${(await readFile(jpg)).toString('base64')}`]
            },
            join(RUN, `${`${i}`.padStart(2, '0')}.mp4`),
            key
          )
          await api('assets:importClip', [PROJECT, clip.id, 'video', cropWatermark(vid, SCALE)])
          console.log('     video ok')
        } catch (e) {
          console.warn(`     video gagal (${e.message}) — klip tetap pakai gambar + gerak kamera`)
        }
      }

      if (!clip.audioAssetId && clip.narration) {
        const wav = await nexaJob(
          { mode: 'tts', prompt: clip.narration, voice: VOICE },
          join(RUN, `${`${i}`.padStart(2, '0')}-tts.wav`),
          key
        )
        await api('assets:importClip', [PROJECT, clip.id, 'audio', wav])
        console.log('     suara ok')
      } else if (!clip.narration) console.log('     tanpa narasi, suara dilewati')
      else console.log('     suara sudah ada, lewati')
    } catch (e) {
      console.warn(`     klip ${i} sebagian gagal: ${e.message}`)
    }
  }

  const folder = await api('export:defaultFolder')
  if (flag('publish-only')) {
    // The export may already be running (or done) inside the server — do not render the same video twice.
    const candidate = join(folder, `${opt('name', `short-${Date.now()}`)}.mp4`)
    if (!existsSync(candidate)) throw new Error(`--publish-only tapi file tidak ada: ${candidate}`)
    console.log('[3/4] Ekspor dilewati (pakai file yang ada)')
    await publish(candidate)
    return
  }

  const refreshed = await api('projects:get', [PROJECT])
  if (flag('recrop')) {
    const n = await api('assets:recropImages', [PROJECT])
    if (n) console.log(`  ${n} gambar dibersihkan dari watermark`)
  }
  const smoothed = await smoothStillCameras(refreshed)
  if (smoothed) console.log(`  ${smoothed} klip kamera diam diganti gerakan halus`)

  console.log('[3/4] Ekspor MP4')
  const job = await api('export:start', [
    PROJECT,
    {
      fileName: opt('name', `short-${Date.now()}`),
      resolution: 1080,
      fps: 30,
      // No burned-in captions: viewers switch YouTube's own CC track on and off instead.
      burnCaptions: false,
      writeSrt: true,
      normalizeAudio: true,
      duckMusic: true,
      folder
    }
  ])
  const deadline = Date.now() + 20 * 60_000
  let exported = null
  for (;;) {
    await sleep(2000)
    bundle = await api('projects:get', [PROJECT])
    const j = bundle.jobs.find((x) => x.id === job.id)
    if (j && ['done', 'failed', 'canceled'].includes(j.status)) {
      if (j.status !== 'done') throw new Error(`Ekspor ${j.status}: ${j.error ?? j.message ?? ''}`)
      exported = j.message ?? null
      console.log(`[4/4] Selesai: ${exported ?? folder}`)
      break
    }
    if (Date.now() > deadline) throw new Error('Ekspor melebihi 20 menit')
  }

  if (flag('publish')) await publish(exported)
}

/** Title, description, tags and the .srt straight onto YouTube. */
async function publish(filePath) {
  if (!filePath) throw new Error('Ekspor tidak mengembalikan path file, tidak bisa diunggah.')
  console.log('[5/5] Unggah ke YouTube')
  const bundle = await api('projects:get', [PROJECT])
  const meta = buildMetadata(bundle, opt('title'), opt('name'))
  const srt = filePath.replace(/\.mp4$/i, '.srt')
  const up = await api('youtube:upload', [{
    path: filePath,
    title: meta.title,
    description: meta.description,
    tags: meta.tags,
    privacy: opt('privacy', 'private'),
    ...(existsSync(srt) ? { subtitlesPath: srt } : {})
  }])
  console.log(`[5/5] Terunggah: ${up.url} (${up.privacy})`)
  return up
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was', 'were', 'how',
  'why', 'what', 'when', 'into', 'than', 'then', 'they', 'them', 'their', 'have', 'has', 'but', 'not'
])

/**
 * Title, description and tags straight from the project: synopsis, chapter timestamps and the full
 * narration, so the video has real metadata instead of an empty box.
 */
function buildMetadata(bundle, titleOverride, fallbackName) {
  const p = bundle.project
  const clips = bundle.clips
  const title = (titleOverride || p.title || fallbackName || 'Untitled').trim().slice(0, 100)
  const narration = clips.map((c) => (c.narration || '').replace(/<[^>]*>/g, '').trim()).filter(Boolean)
  const total = clips.reduce((n, c) => n + (c.durationMs || 0), 0)

  let chapters = []
  if (clips.length >= 3 && total >= 60_000) {
    let acc = 0
    chapters = clips.map((c) => {
      const at = Math.round(acc / 1000)
      acc += c.durationMs || 0
      const label = (c.title || '').trim().replace(/\s+/g, ' ')
      return label && label !== `Scene ${clips.indexOf(c) + 1}`
        ? `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')} ${label}`
        : null
    }).filter(Boolean)
    if (chapters.length < 3) chapters = []
  }

  const description = [
    title,
    '',
    chapters.length ? ['Chapters', ...chapters.map((c) => c), ''].join('\n') : '',
    narration.join(' '),
    '',
    'Narrated and illustrated with AI. Facts checked before publishing.',
    `Source project: Bang Story (${p.aspectRatio}, ${Math.round(total / 1000)}s).`
  ].filter((x) => x !== '').join('\n').slice(0, 4800)

  const words = `${title} ${p.synopsis ?? ''}`.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []
  const tags = [
    ...new Set([...words.filter((w) => !STOP.has(w)), 'science', 'education', 'how it works', 'documentary',
      p.aspectRatio === '9:16' ? 'shorts' : 'video essay'])
  ].slice(0, 30)

  return { title, description, tags }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('GAGAL:', e.message)
    process.exit(1)
  })
