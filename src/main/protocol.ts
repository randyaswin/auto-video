import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { fontsDir, projectsRoot } from './paths'

const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.ttf': 'font/ttf'
}

export function contentTypeOf(abs: string): string {
  return TYPES[extname(abs).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Absolute path behind a `studio://` URL — the `/studio/...` HTTP route in the web build uses the
 * same layout. Returns null when the host is unknown, the path escapes its root, or the file is gone.
 */
export function resolveStudioFile(host: string, pathname: string): string | null {
  const root = host === 'fonts' ? fontsDir() : host === 'asset' ? projectsRoot() : null
  if (!root) return null
  let rel: string
  try {
    rel = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const base = normalize(root)
  const abs = normalize(join(base, rel.replace(/^\/+/, '')))
  if (abs !== base && !abs.startsWith(base + sep)) return null
  try {
    if (!statSync(abs).isFile()) return null
  } catch {
    return null
  }
  return abs
}

export interface ByteRange {
  start: number
  end: number
}

/**
 * Parses an HTTP Range header for a file of `size` bytes.
 * `null` = no range, `false` = unsatisfiable (answer 416), object = serve those bytes.
 */
export function parseRange(header: string | null | undefined, size: number): ByteRange | null | false {
  if (!header) return null
  const m = /bytes=(\d*)-(\d*)/.exec(header)
  if (!m) return null
  const start = m[1] ? parseInt(m[1], 10) : Math.max(0, size - parseInt(m[2], 10))
  const end = m[1] && m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) return false
  return { start, end }
}

export function sizeOf(abs: string): number | null {
  try {
    return statSync(abs).size
  } catch {
    return null
  }
}

export function openStream(abs: string, range: ByteRange | null): Readable {
  return createReadStream(abs, range ? { start: range.start, end: range.end } : undefined)
}

// ---------- Electron only ----------

export function registerSchemes(): void {
  if (!process.versions.electron) return
  const { protocol } = require('electron') as typeof import('electron')
  protocol.registerSchemesAsPrivileged([
    { scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

/** Serves project assets and caption fonts to the renderer, with Range support so audio and video can seek. */
export function handleStudioProtocol(): void {
  if (!process.versions.electron) return
  const { protocol } = require('electron') as typeof import('electron')
  protocol.handle('studio', (req) => {
    const url = new URL(req.url)
    const abs = resolveStudioFile(url.hostname, url.pathname)
    if (!abs) return new Response('Not found', { status: 404 })
    const size = statSync(abs).size
    const type = contentTypeOf(abs)
    const range = parseRange(req.headers.get('range'), size)
    if (range === false) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
    const body = Readable.toWeb(openStream(abs, range)) as ReadableStream
    if (range) {
      return new Response(body, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(range.end - range.start + 1),
          'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' }
    })
  })
}
