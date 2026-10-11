import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { request as httpsRequest } from 'node:https'

/**
 * Uploads a finished MP4 to YouTube with the refresh token from scripts/youtube-auth.mjs.
 * Kept out of the app's secrets table on purpose: this token belongs to the server side of the
 * pipeline (Hermes talking to MCP), not to anything the renderer needs to read.
 */

const TOKENS_PATH = join(homedir(), '.bang-story', 'youtube-tokens.json')
const OAUTH = 'https://oauth2.googleapis.com/token'
const SCOPES = 'https://www.googleapis.com/auth/youtube.upload'

type Tokens = { clientId: string; clientSecret: string; refreshToken: string }

export type YoutubeUploadInput = {
  path: string
  title: string
  description?: string
  tags?: string[]
  privacy?: 'private' | 'unlisted' | 'public'
  categoryId?: string
}

export type YoutubeUploadResult = { id: string; url: string; privacy: string }

function loadTokens(): Tokens {
  if (!existsSync(TOKENS_PATH)) {
    throw new Error('Belum ada izin YouTube. Jalankan scripts/youtube-auth.mjs sekali untuk memasukkan izin.')
  }
  const t = JSON.parse(readFileSync(TOKENS_PATH, 'utf8')) as Partial<Tokens>
  if (!t.clientId || !t.clientSecret || !t.refreshToken) throw new Error('Berkas token YouTube tidak lengkap.')
  return t as Tokens
}

function postForm(url: string, fields: Record<string, string>): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = new URLSearchParams(fields).toString()
    const req = httpsRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 30_000
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => {
        let body: any = null
        try { body = JSON.parse(raw) } catch { body = raw.slice(0, 300) }
        resolve({ status: res.statusCode ?? 0, body })
      })
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Permintaan otorisasi YouTube timeout')))
    req.end(payload)
  })
}

async function accessToken(t: Tokens): Promise<string> {
  const { status, body } = await postForm(OAUTH, {
    client_id: t.clientId,
    client_secret: t.clientSecret,
    refresh_token: t.refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPES
  })
  if (status !== 200 || !body?.access_token) {
    throw new Error(`Gagal memperbarui akses YouTube: ${body?.error ?? status} ${body?.error_description ?? ''}`.slice(0, 300))
  }
  return body.access_token
}

function put(url: string, headers: Record<string, string>, filePath?: string): Promise<{ status: number; headers: any; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, { method: 'PUT', headers, timeout: 15 * 60_000 }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: raw }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Upload YouTube timeout')))
    if (filePath) createReadStream(filePath).on('error', reject).pipe(req)
    else req.end()
  })
}

/**
 * Resumable upload: ask YouTube where to send the bytes, then stream the file straight from disk so a
 * 10-minute MP4 never sits in memory.
 */
export async function youtubeUpload(input: YoutubeUploadInput): Promise<YoutubeUploadResult> {
  if (!existsSync(input.path)) throw new Error(`File tidak ada: ${input.path}`)
  const size = statSync(input.path).size
  const tokens = loadTokens()
  const bearer = await accessToken(tokens)

  const metadata = {
    snippet: {
      title: input.title.slice(0, 100),
      description: (input.description ?? '').slice(0, 4800),
      tags: (input.tags ?? []).slice(0, 30),
      categoryId: input.categoryId ?? '27' // Education
    },
    status: {
      privacyStatus: input.privacy ?? 'private',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: true // AI visuals — YouTube asks creators to declare this
    }
  }

  const initRes = await new Promise<{ status: number; location: string | undefined; body: string }>((resolve, reject) => {
    const url = new URL('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status')
    const payload = JSON.stringify(metadata)
    const req = httpsRequest(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearer}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(size),
        'X-Upload-Content-Type': 'video/mp4',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 60_000
    }, (res) => {
      let raw = ''
      res.on('data', (c) => { raw += c })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, location: res.headers.location, body: raw }))
    })
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('Permintaan upload YouTube timeout')))
    req.end(payload)
  })

  if (initRes.status !== 200 || !initRes.location) {
    throw new Error(`Upload YouTube ditolak saat inisialisasi: ${initRes.status} ${initRes.body.slice(0, 300)}`)
  }

  const up = await put(initRes.location, {
    Authorization: `Bearer ${bearer}`,
    'Content-Type': 'video/mp4',
    'Content-Length': String(size),
    'Content-Range': `bytes 0-${size - 1}/${size}`
  }, input.path)

  if (up.status !== 200 && up.status !== 201) {
    throw new Error(`Upload YouTube gagal: HTTP ${up.status} ${up.body.slice(0, 300)}`)
  }
  let id = ''
  try { id = JSON.parse(up.body).id ?? '' } catch { /* body may be empty on some responses */ }
  if (!id) {
    const m = /"id"\s*:\s*"([^"]+)"/.exec(up.body)
    id = m?.[1] ?? ''
  }
  if (!id) throw new Error('Upload selesai tetapi YouTube tidak mengembalikan ID video.')
  return { id, url: `https://youtu.be/${id}`, privacy: input.privacy ?? 'private' }
}

/** Writes the client id/secret handed over by the user so youtube-auth.mjs can find them. */
export function saveOauthClient(clientId: string, clientSecret: string): void {
  const dir = join(homedir(), '.hermes')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'youtube-oauth.env')
  writeFileSync(file, `YOUTUBE_CLIENT_ID=${clientId}\nYOUTUBE_CLIENT_SECRET=${clientSecret}\n`)
  chmodSync(file, 0o600)
}
