#!/usr/bin/env node
/**
 * One-time YouTube OAuth handshake for a Desktop-app client.
 * Prints the consent URL, waits for Google to redirect back to http://127.0.0.1:8788/callback (if the
 * browser runs on this machine) or lets the user paste the code by hand, then stores the refresh token.
 *
 *   node scripts/youtube-auth.mjs [--port 8788]
 *
 * Credentials live in ~/.hermes/youtube-oauth.env (YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET), mode 600.
 * The refresh token is written to ~/.bang-story/youtube-tokens.json, mode 600.
 */
import { createServer } from 'node:http'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const SCOPES = 'https://www.googleapis.com/auth/youtube.upload'
const argv = process.argv.slice(2)
const portArg = argv.indexOf('--port')
const PORT = Number(portArg >= 0 ? argv[portArg + 1] : '8788')

function credentialFile() {
  for (const f of [join(homedir(), '.hermes/youtube-oauth.env'), join(homedir(), 'youtube-oauth.env')]) {
    if (!existsSync(f)) continue
    const text = readFileSync(f, 'utf8')
    const pick = (k) => new RegExp(`^${k}=\\s*"?([^\\s"]+)"?`, 'm').exec(text)?.[1]
    const id = pick('YOUTUBE_CLIENT_ID')
    const secret = pick('YOUTUBE_CLIENT_SECRET')
    if (id && secret) return { id, secret }
  }
  throw new Error('YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET tidak ada di ~/.hermes/youtube-oauth.env')
}

async function main() {
  const { id, secret } = credentialFile()
  const redirect = `http://127.0.0.1:${PORT}/callback`
  const authUrl =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: id,
      redirect_uri: redirect,
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      scope: SCOPES
    }).toString()

  console.log('\nBuka URL ini di browser (pakai akun YouTube channel yang mau diupload):\n')
  console.log(authUrl)
  console.log(`\nKalau browser ada di mesin ini, redirect otomatis. Kalau dari mesin lain,\ncopy kode dari address bar (berbentuk 4/0A...) lalu paste di sini.\n`)

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let code = null
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, redirect)
    if (url.pathname !== '/callback') {
      res.writeHead(404).end()
      return
    }
    code = url.searchParams.get('code')
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h3>Izin diberikan. Kembali ke terminal — proses berlanjut otomatis.</h3>')
    rl.close()
    server.close()
  })
  server.listen(PORT, '127.0.0.1')

  if (!code) {
    const answer = await rl.question('Paste kode otorisasi (atau Enter kalau browser lokal sudah jalan): ')
    if (answer.trim()) code = answer.trim().split(/\s+/)[0]
  }
  for (let i = 0; !code && i < 30; i++) await new Promise((r) => setTimeout(r, 1000))
  if (!code) throw new Error('Tidak ada kode otorisasi')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirect,
      grant_type: 'authorization_code'
    })
  })
  const body = await res.json()
  if (!res.ok || !body.refresh_token) throw new Error(`Tukar kode gagal: ${body.error ?? res.status} ${body.error_description ?? ''}`)

  const dir = join(homedir(), '.bang-story')
  mkdirSync(dir, { recursive: true })
  const out = join(dir, 'youtube-tokens.json')
  writeFileSync(out, JSON.stringify({ clientId: id, clientSecret: secret, refreshToken: body.refresh_token, savedAt: new Date().toISOString() }, null, 2))
  chmodSync(out, 0o600)
  console.log(`\nRefresh token tersimpan di ${out}. Upload siap dipakai.`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('GAGAL:', e.message)
    process.exit(1)
  })
