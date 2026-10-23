#!/usr/bin/env node
/**
 * Segarkan cookie sesi NexaBot tanpa OTP.
 *
 * Cookie `nexabot_session` berupa JWT berumur 30 hari. Selama belum kedaluwarsa, memuat salah satu
 * halaman web dengan cookie itu membuat server mengirim cookie baru (umur 30 hari lagi) — jadi umurnya
 * terus bergeser selama pipeline jalan secara berkala. Skrip ini menyimpannya ke
 * `~/.hermes/nexabot-cookie.txt` (mode 600) dan menulis statusnya supaya supervisor bisa berhenti
 * dengan pesan jelas kalau segarkan gagal (baru saat itu OTP diperlukan).
 *
 *   node scripts/nexabot-refresh-cookie.mjs           # segarkan, exit 1 kalau sesi mati
 *   node scripts/nexabot-refresh-cookie.mjs --check   # hanya laporkan sisa umur
 */
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const FILE = join(homedir(), '.hermes', 'nexabot-cookie.txt')
const CHECK = process.argv.includes('--check')

if (!existsSync(FILE)) {
  console.log('Cookie belum ada:', FILE)
  process.exit(1)
}
const current = readFileSync(FILE, 'utf8').trim()
const session = /nexabot_session=([^;]+)/.exec(current)?.[1] ?? ''
function expiry(value) {
  try {
    const body = value.split('.')[0]
    const claims = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'))
    const exp = Number(claims.exp ?? 0)
    return exp > 1e12 ? exp / 1000 : exp // seconds either way
  } catch {
    return 0
  }
}
const left = (expiry(session) - Date.now() / 1000) / 86400
if (CHECK) {
  console.log(`Sisa umur cookie: ${left.toFixed(1)} hari`)
  process.exit(left > 0 ? 0 : 1)
}
if (left <= 0) {
  console.log('Sesi NexaBot sudah kedaluwarsa — perlu login OTP sekali (scripts/nexabot-login).')
  process.exit(1)
}

// A page load with a valid cookie rotates it; /dashboard is the cheapest one that does.
const res = await fetch('https://nexabot.id/dashboard', {
  headers: { Cookie: current, 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) bang-story/1.0' },
  redirect: 'manual'
})
const setCookies = typeof res.headers.getSetCookie === 'function'
  ? res.headers.getSetCookie()
  : [res.headers.get('set-cookie') ?? ''].filter(Boolean)
const jar = new Map(current.split('; ').map((p) => [p.split('=')[0], p.split('=').slice(1).join('=')]))
let rotated = false
for (const raw of setCookies) {
  const [pair] = raw.split(';')
  const [name, ...rest] = pair.split('=')
  const value = rest.join('=')
  if (!name?.startsWith('nexabot_') || !value) continue
  if (jar.get(name) !== value) rotated = true
  jar.set(name, value)
}
const next = [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
if (rotated) {
  writeFileSync(FILE, next)
  chmodSync(FILE, 0o600)
}
const newLeft = (expiry(jar.get('nexabot_session') ?? '') - Date.now() / 1000) / 86400
console.log(`${rotated ? 'Cookie diperbarui' : 'Cookie tetap'} · sisa umur ${newLeft.toFixed(1)} hari`)

// Prove the session is still usable before anyone spends a render on it.
try {
  const me = await fetch('https://nexabot.id/api/auth/me', { headers: { Cookie: next } })
  const body = await me.json()
  if (!body?.authenticated) throw new Error('tidak terautentikasi')
  console.log(`Sesi hidup · unlimited ${body.unlimited_active ? 'AKTIF' : 'TIDAK aktif'} · kredit ${body.credit}`)
} catch (e) {
  console.log('Sesi tertolak:', e.message)
  process.exit(1)
}
