#!/usr/bin/env node
/**
 * Produces one project end to end without Higgsfield or Gemini TTS:
 * Bang Story writes the script and storyboard with its own LLM, NexaBot draws the image, animates
 * it and speaks the voice-over, every file is imported onto its clip, and the project is exported.
 *
 *   node scripts/nexabot-produce.mjs --project <id> [--no-video] [--voice Achernar] [--name my-short]
 *            [--scenes N] [--rebuild-script]
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

/** Local copy of a clip's image, generated now or pulled from the app's asset route. */
async function stageImage(clip, index, key, aspect, style) {
  const jpg = join(RUN, `${index}`.padStart(2, '0') + '.jpg')
  if (existsSync(jpg)) return jpg
  if (clip.image) {
    const res = await fetch(`${BASE}${clip.image}`)
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
      if (!clip.image) {
        const img = await stageImage(clip, i, key, ASPECT, STYLE)
        await api('assets:importClip', [PROJECT, clip.id, 'image', img])
        console.log('     gambar ok')
      } else console.log('     gambar sudah ada, lewati')

      if (WANT_VIDEO && !clip.video) {
        try {
          const jpg = await stageImage(clip, i, key, ASPECT, STYLE)
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

      if (!clip.voice && clip.narration) {
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

  console.log('[3/4] Ekspor MP4')
  const folder = await api('export:defaultFolder')
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
  for (;;) {
    await sleep(2000)
    bundle = await api('projects:get', [PROJECT])
    const j = bundle.jobs.find((x) => x.id === job.id)
    if (j && ['done', 'failed', 'canceled'].includes(j.status)) {
      if (j.status !== 'done') throw new Error(`Ekspor ${j.status}: ${j.error ?? j.message ?? ''}`)
      console.log(`[4/4] Selesai: ${j.message ?? folder}`)
      break
    }
    if (Date.now() > deadline) throw new Error('Ekspor melebihi 20 menit')
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('GAGAL:', e.message)
    process.exit(1)
  })
