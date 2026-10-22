#!/usr/bin/env node
/**
 * Sinkronkan ledger anti-dobel dengan isi kanal YouTube yang sebenarnya.
 *
 * Latar: `uploaded-names.json` dulu hanya berisi 6 nama padahal 31 video sudah tayang. Tanpa itu,
 * flush bisa mengunggah ulang video yang sama persis — persis gejala "video sama tapi diupload 2 kali".
 * Skrip ini membaca kanal lewat API, mencocokkan tiap judul tayang dengan proyeknya (judul proyek),
 * lalu menulis nama proyek itu ke ledger sebagai "sudah pernah tayang".
 *
 *   node scripts/sync-uploaded.mjs            # tulis ledger
 *   node scripts/sync-uploaded.mjs --dry      # hanya laporan
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BANG_STORY_URL ?? 'http://100.115.185.3:4627'
const HOME = homedir()
const TOK = join(HOME, '.bang-story', 'youtube-tokens.json')
const LEDGER = join(HOME, '.bang-story', 'uploaded-names.json')
const DRY = process.argv.includes('--dry')

const STOP = new Set(['the','and','for','with','that','this','from','your','you','are','was','were','how','why','what','when','into','than','then','they','them','their','have','has','but','not','a','an','of','to','in','on','is','it','its','be','can','will','really','about','still','inside','only','very','more','most','one','two','three','just','like','make','makes','made','get','gets'])
function toks(s) {
  const seen = new Set(); const out = []
  for (const t of String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)) {
    if (!t || STOP.has(t) || seen.has(t)) continue
    seen.add(t); out.push(t)
  }
  return out
}
function sim(a, b) {
  const A = new Set(toks(a)); const B = new Set(toks(b))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const x of A) if (B.has(x)) inter++
  const jac = inter / (A.size + B.size - inter)
  const cont = inter / Math.min(A.size, B.size)
  return Math.max(jac, cont)
}
async function token() {
  const t = JSON.parse(readFileSync(TOK, 'utf8'))
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: t.clientId, client_secret: t.clientSecret, refresh_token: t.refreshToken, grant_type: 'refresh_token' })
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('token gagal: ' + JSON.stringify(j).slice(0, 200))
  return j.access_token
}
async function api(channel, args = []) {
  const res = await fetch(`${BASE}/api/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, args }) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `${channel} gagal (HTTP ${res.status})`)
  return body.result
}
async function channelVideos() {
  const a = await token()
  const out = []; let page = null
  do {
    const u = new URL('https://www.googleapis.com/youtube/v3/search')
    u.searchParams.set('part', 'snippet'); u.searchParams.set('forMine', 'true')
    u.searchParams.set('type', 'video'); u.searchParams.set('maxResults', '50')
    if (page) u.searchParams.set('pageToken', page)
    const r = await fetch(u, { headers: { authorization: 'Bearer ' + a } })
    const j = await r.json()
    if (j.error) throw new Error(JSON.stringify(j.error))
    for (const it of j.items ?? []) out.push({ id: it.id.videoId, title: it.snippet.title, pub: it.snippet.publishedAt })
    page = j.nextPageToken
  } while (page)
  return out
}
// nama proyek (dipakai sebagai --name saat produksi) untuk tiap id proyek
function nameMap() {
  const m = new Map()
  // Empat proyek pertama dibuat sebelum konvensi nama file ada; nama produksinya dicatat manual.
  for (const [id, name] of Object.entries({
    '89233381-e9ae-426f-9d48-d7534d20fae3': 'bone-steel',
    '34f5d3f2-c4ec-4be9-8522-50240820e3b2': 'star-explode',
    '2fff5972-33cf-49a7-8d77-fbf3fae23d80': 'earth-core-short',
    '60947720-8baf-45eb-a149-1dde5a4dc07a': 'water-cycle-longform'
  })) m.set(id, name)
  for (const f of ['queue.tsv', 'queue-longform.tsv', 'queue-retry.tsv']) {
    const p = join(HERE, f)
    if (!existsSync(p)) continue
    for (const line of readFileSync(p, 'utf8').split(/\n/)) {
      const parts = line.trim().split(/\s+/)
      if (parts.length >= 2 && /^[0-9a-f-]{8,}$/.test(parts[0])) m.set(parts[0], parts[1])
    }
  }
  return m
}
const videos = await channelVideos()
const bundle = await api('projects:list')
const projects = (bundle?.projects ?? bundle ?? []).map((p) => ({ id: p.id ?? p.projectId, title: p.title ?? '', dur: p.durationSec ?? p.duration_sec ?? 0 }))
const names = nameMap()
const rows = []
for (const v of videos) {
  let best = null; let bestScore = 0
  for (const p of projects) {
    const s = sim(v.title, p.title)
    if (s > bestScore) { bestScore = s; best = p }
  }
  const name = best ? (names.get(best.id) ?? null) : null
  rows.push({ video: v.title, id: v.id, pub: v.pub, project: best ? best.id : null, projectTitle: best ? best.title : null, score: Number(bestScore.toFixed(2)), name })
}
console.log(`Video di kanal: ${videos.length}\nProyek terdaftar: ${projects.length}\n`)
for (const r of rows) {
  const flag = r.name ? 'LEDAGER' : (r.score >= 0.35 ? 'TANPA-NAMA' : 'TIDAK-COCOK')
  console.log(`[${flag}] ${r.score.toFixed(2)} ${r.video}  ->  ${r.projectTitle ?? '-'}  (${r.name ?? 'tanpa nama'})`)
}
const add = new Set(rows.filter((r) => r.name).map((r) => r.name))
let ledger = []
try { ledger = JSON.parse(readFileSync(LEDGER, 'utf8')) } catch { /* belum ada */ }
const before = ledger.length
for (const n of add) if (!ledger.includes(n)) ledger.push(n)
ledger = ledger.sort()
if (DRY) {
  console.log(`\nDry-run: ledger ${before} -> ${ledger.length} nama`)
  process.exit(0)
}
writeFileSync(LEDGER, JSON.stringify(ledger, null, 2))
console.log(`\nLedger ditulis: ${before} -> ${ledger.length} nama.`)
