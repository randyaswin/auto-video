#!/usr/bin/env node
/**
 * Satu topik baru -> proyek -> produksi (naskah, media, ekspor, unggah public).
 * Menjalankan gerbang topik SEBELUM membuat proyek, lalu mendaftarkan topik SESUDAH proyek ada.
 *
 *   node scripts/new-topic.mjs --title "..." --synopsis "..." --cluster tech --style cinematic
 *   node scripts/new-topic.mjs --dry ...
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const HERE = dirname(fileURLToPath(import.meta.url))
const BASE = process.env.BANG_STORY_URL ?? 'http://100.115.185.3:4627'
const argv = process.argv.slice(2)
const opt = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d }
const flag = (n) => argv.includes('--' + n)
const TITLE = opt('title'); const SYNOPSIS = opt('synopsis'); const CLUSTER = opt('cluster', 'misc')
// Gaya yang diterima pipeline media: photo | animation | 3d | diagram.
const STYLE = opt('style', 'photo'); const KIND = opt('kind', 'short')
const NAME = opt('name') ?? TITLE.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
if (!TITLE || !SYNOPSIS) { console.error('Pakai: --title "..." --synopsis "..."'); process.exit(1) }
function sh(cmd, args, extra = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...extra } })
  return { rc: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}
async function api(channel, args = []) {
  const res = await fetch(`${BASE}/api/call`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ channel, args }) })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error ?? `${channel} gagal (HTTP ${res.status})`)
  return body.result
}
// 1) Gerbang topik: jangan buat proyek kalau temanya mirip.
const chk = sh(process.execPath, [join(HERE, 'topic-check.mjs'), TITLE])
if (chk.rc === 1 && !flag('force')) {
  console.log('DITOLAK gerbang topik (mirip):\n' + chk.out)
  process.exit(1)
}
// 2) Daftarkan nama produksi di antrean (dipakai flush & ledger). Kalau nama ini sudah ada di
// antrean, pakai proyek yang sudah ada — jangan buat proyek kembar (percobaan ulang tidak boleh
// menyisakan topik dobel di database).
const qf = join(HERE, KIND === 'long' ? 'queue-longform.tsv' : 'queue.tsv')
if (!existsSync(qf)) writeFileSync(qf, '')
const q = readFileSync(qf, 'utf8')
const existing = q.split('\n').map((l) => l.split(/\s+/)).find((p) => p[1] === NAME)
if (existing) {
  console.log('Topik ini sudah punya proyek:', existing[0], NAME)
  process.exit(2)
}
// 3) Buat proyek.
const bundle = await api('projects:create', [{
  synopsis: SYNOPSIS, title: TITLE,
  durationSec: KIND === 'long' ? 600 : 30, language: 'en', aspectRatio: KIND === 'long' ? '16:9' : '9:16', styleId: STYLE
}])
const id = bundle.project.id
console.log('Proyek dibuat:', id, bundle.project.title)
appendFileSync(qf, `${id} ${NAME} ${STYLE}\n`)
// 4) Produksi. Default: tanning, bukan langsung unggah — unggahan waited for the cron slot
// (Randy: jangan menumpuk semua unggahan di satu jam, harus dijeda sepanjang hari).
if (flag('dry')) { console.log('Dry-run. Produksi dilewati.'); process.exit(0) }
const publish = flag('publish')
const args = [join(HERE, 'nexabot-produce.mjs'), '--project', id, '--name', NAME, '--style', STYLE, '--title', TITLE]
if (publish) args.push('--publish', '--privacy', 'public')
const prod = sh(process.execPath, args, { BANG_STORY_URL: BASE })
process.stdout.write(prod.out)
if (prod.rc !== 0) { console.log('Produksi GAGAL rc=' + prod.rc); process.exit(prod.rc) }
if (!publish) {
  // Masukkan ke antrean unggah: cron flush yang mengirimnya pada jadwalnya (1 per slot).
  const dir = join(homedir(), '.bang-story', 'exports')
  const cands = existsSync(dir)
    ? (await import('node:fs')).readdirSync(dir).filter((f) => f.startsWith(NAME) && f.endsWith('.mp4'))
    : []
  if (!cands.length) { console.log('Tidak ada file ekspor untuk ' + NAME + ' — tidak masuk antrean.'); process.exit(1) }
  cands.sort()
  const file = join(dir, cands[cands.length - 1])
  const pf = join(homedir(), '.bang-story', 'pending-uploads.json')
  let list = []
  try { list = JSON.parse(readFileSync(pf, 'utf8')) } catch { /* belum ada */ }
  if (!list.some((x) => x.name === NAME)) list.push({ project: id, name: NAME, file, privacy: 'public' })
  writeFileSync(pf, JSON.stringify(list, null, 2))
  console.log('Menunggu unggah di slot cron:', file)
}
// 5) Catat topik ke registry (supaya tidak terulang).
const rec = sh(process.execPath, [join(HERE, 'topic-check.mjs'), '--record', TITLE, KIND, CLUSTER, SYNOPSIS])
console.log(rec.out)
