#!/usr/bin/env node
/**
 * Gate topik: cek judul/sinopsis baru terhadap SEMUA topik yang pernah dipakai, supaya channel tidak
 * pernah mengulang tema (Randy: "pastikan tidak ada yang mirip, harus selalu baru").
 *
 *   node scripts/topic-check.mjs "Why the Moon Is Rough"        → lapor skor; exit 1 kalau mirip
 *   node scripts/topic-check.mjs --force "..."                  → dipakai kalau sudah yakin beda
 *   node scripts/topic-check.mjs --record "<judul>" <short|long> <cluster> "<sinopsis>"
 *
 * Daftar topik: `topics-used.tsv` (judul, jenis, cluster, kata kunci). Tambah baris setiap kali
 * satu proyek dibuat — biar cek berikutnya tahu bahwa topik itu sudah terpakai.
 * Ambang mirip: containment (kata unik yang sama ÷ kata unik kandidat) ≥ 0,35.
 */
import { appendFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'topics-used.tsv')
const THRESHOLD = 0.35
const STOP = new Set(
  ('the a an and or of to in on for with why how what when into than then they them their have has but not ' +
    'your you are was were this that from it its is are be can will really about more than one two them some ' +
    'what when where which while about into over under after before every never always very much many')
    .split(' ')
)
const tokens = (s) =>
  new Set(((s ?? '').toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !STOP.has(w) && w.length > 3))

function load() {
  return readFileSync(FILE, 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('\t'))
    .map((l) => {
      const [id, title, kind, cluster, keywords] = l.split('\t')
      return { id, title, kind, cluster, keywords }
    })
}

const argv = process.argv.slice(2)
if (argv[0] === '--record') {
  const [, title, kind, cluster, synopsis] = argv
  if (!title || !kind) {
    console.error('Pakai: --record "<judul>" <short|long> <cluster> "<sinopsis>"')
    process.exit(2)
  }
  const words = [...tokens(`${title} ${synopsis ?? ''}`)].slice(0, 18).join(',')
  const id = `${Date.now().toString(36)}`
  appendFileSync(FILE, `${id}\t${title.replace(/\t/g, ' ')}\t${kind || 'short'}\t${cluster || 'misc'}\t${words}\n`)
  console.log(`Tercatat: ${title} [${cluster || 'misc'}] (${words.split(',').length} kata kunci)`)
  process.exit(0)
}

const query = argv.filter((a) => a !== '--force').join(' ')
const force = argv.includes('--force')
if (!query.trim()) {
  console.error('Pakai: node scripts/topic-check.mjs "<judul atau sinopsis topik baru>"')
  process.exit(2)
}

const cand = tokens(query)
if (!cand.size) {
  console.error('Tidak ada kata kunci yang bisa diambil dari input.')
  process.exit(2)
}
const rows = load()
const hits = []
for (const r of rows) {
  const have = new Set((r.keywords ?? '').split(',').filter(Boolean))
  const shared = [...cand].filter((w) => have.has(w))
  if (!shared.length) continue
  const containment = shared.length / cand.size
  const union = new Set([...cand, ...have]).size
  const jac = shared.length / union
  const score = Math.max(containment, jac)
  if (score >= 0.2) hits.push({ ...r, score: +score.toFixed(2), shared })
}
hits.sort((a, b) => b.score - a.score)

const usedClusters = {}
for (const r of rows) usedClusters[r.cluster] = (usedClusters[r.cluster] ?? 0) + 1
const guessed = Object.entries(usedClusters).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'misc'

if (!hits.length) {
  console.log(`TOPIK UNIK — tidak ada judul lama yang mendekati (${cand.size} kata kunci).`)
  console.log(`Cluster paling ramai sekarang: ${guessed} (${usedClusters[guessed]} video) — pertimbangkan cluster lain.`)
  process.exit(0)
}

console.log('Kecocokan dengan topik yang sudah dipakai:')
for (const h of hits.slice(0, 5)) {
  console.log(`  ${h.score.toFixed(2)}  [${h.cluster}] ${h.title}`)
  console.log(`        kata sama: ${h.shared.join(', ')}`)
}
const worst = hits[0].score
if (worst >= THRESHOLD && !force) {
  console.log(`\nMIRIP (skor ${worst.toFixed(2)} ≥ ${THRESHOLD}) — pakai topik lain atau tambah sudut yang benar-benar baru.`)
  process.exit(1)
}
console.log(`\nSkor teratas ${worst.toFixed(2)} di bawah ambang ${THRESHOLD} — boleh lanjut.`)
process.exit(0)
