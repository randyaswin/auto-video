import express, { type Request, type Response } from 'express'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { bootCore } from '../main/bootstrap'
import { subscribe } from '../main/events'
import { dispatch, importLocalAsset } from '../main/ipc'
import { dataDir } from '../main/paths'
import { appRoot, appVersion } from '../main/platform'
import { contentTypeOf, openStream, parseRange, resolveStudioFile, sizeOf } from '../main/protocol'

/**
 * Bang Story as a web app: the renderer from the Electron build, served over HTTP, talking to the
 * same API registry the desktop app uses through IPC. Nothing in the pipeline is reimplemented —
 * `/api/call` dispatches into `main/ipc.ts`, so the preview, the jobs and the export behave
 * exactly as they do on the desktop.
 */

const PORT = Number(process.env.BANG_STORY_PORT ?? process.env.PORT ?? 4627)
const HOST = process.env.BANG_STORY_HOST ?? '127.0.0.1'
const RENDERER_DIR = join(appRoot(), 'out', 'renderer')

const errorText = (e: unknown): string => (e as Error)?.message ?? String(e)

bootCore()

const app = express()
app.use(express.json({ limit: '64mb' }))

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, app: 'bang-story', version: appVersion(), dataDir: dataDir() })
})

/** One route for every IPC channel, so the renderer runs unchanged outside Electron. */
app.post('/api/call', async (req: Request, res: Response) => {
  try {
    const { channel, args } = (req.body ?? {}) as { channel?: unknown; args?: unknown }
    if (typeof channel !== 'string' || !channel) throw new Error('Kanal tidak valid')
    const result = await dispatch(channel, Array.isArray(args) ? args : [])
    res.json({ result: result ?? null })
  } catch (e) {
    res.status(500).json({ error: errorText(e) })
  }
})

/** Job, clip, asset and whisper events, pushed as Server-Sent Events. */
app.get('/api/events', (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()
  res.write('retry: 2000\n\n')
  const off = subscribe((channel, payload) => {
    res.write(`event: ${channel}\ndata: ${JSON.stringify(payload)}\n\n`)
  })
  const heartbeat = setInterval(() => res.write(': ping\n\n'), 20_000)
  req.on('close', () => {
    clearInterval(heartbeat)
    off()
  })
})

/**
 * File picker for the browser: the raw request body lands in a temp file and goes through the same
 * import rules as the desktop's native dialog (`importLocalAsset`).
 */
app.post('/api/upload', async (req: Request, res: Response) => {
  try {
    const projectId = String(req.query.projectId ?? '')
    const kind = String(req.query.kind ?? '')
    if (!projectId) throw new Error('Proyek belum ditentukan')
    if (kind !== 'music' && kind !== 'overlay') throw new Error('Jenis berkas tidak dikenal')
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const dir = join(dataDir(), 'tmp')
    mkdirSync(dir, { recursive: true })
    const tmp = join(dir, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}${extname(String(req.query.name ?? ''))}`)
    writeFileSync(tmp, Buffer.concat(chunks))
    try {
      res.json({ result: await importLocalAsset(projectId, kind, tmp) })
    } finally {
      rmSync(tmp, { force: true })
    }
  } catch (e) {
    res.status(500).json({ error: errorText(e) })
  }
})

/** Assets and fonts, with Range support so audio and video seek like they do on the desktop. */
app.get(/^\/studio\/(asset|fonts)\/.*/, (req: Request, res: Response) => {
  const parts = req.path.split('/')
  const abs = resolveStudioFile(parts[2] ?? '', `/${parts.slice(3).join('/')}`)
  const size = abs ? sizeOf(abs) : null
  if (!abs || size == null) {
    res.status(404).type('text/plain').send('Not found')
    return
  }
  const range = parseRange(req.headers.range, size)
  if (range === false) {
    res.setHeader('Content-Range', `bytes */${size}`)
    res.status(416).end()
    return
  }
  res.setHeader('Content-Type', contentTypeOf(abs))
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-cache')
  if (range) {
    res.status(206)
    res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
    res.setHeader('Content-Length', String(range.end - range.start + 1))
  } else {
    res.setHeader('Content-Length', String(size))
  }
  openStream(abs, range).pipe(res)
})

app.use(express.static(RENDERER_DIR, { index: false }))
// Single-page app: everything that is not an API or asset route renders the shell.
app.get(/^\/(?!api\/|studio\/).*/, (_req: Request, res: Response) => {
  res.sendFile(join(RENDERER_DIR, 'index.html'), (err) => {
    if (err) res.status(500).type('text/plain').send('Renderer belum dibuild. Jalankan: npm run build:web')
  })
})

app.listen(PORT, HOST, () => {
  console.log(`Bang Story web berjalan di http://${HOST}:${PORT}`)
  console.log(`Data: ${dataDir()}`)
})
