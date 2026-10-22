#!/usr/bin/env node
/**
 * Pindahkan hasil ekspor yang sudah jadi ke antrean unggah (`pending-uploads.json`).
 *
 * Pemisahan ini penting: produksi berjalan terus (Randy: generate tanpa jeda), sementara unggah
 * harus dijeda sepanjang hari (1 video per slot cron). File yang sudah diekspor tapi belum diantrekan
 * akan hilang dari radar — skrip ini menutup celah itu.
 *
 *   node scripts/queue-pending.mjs            # antrekan yang belum ada
 *   node scripts/queue-pending.mjs --dry      # hanya laporan
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOME = homedir()
const PENDING = join(HOME, '.bang-story', 'pending-uploads.json')
const LEDGER = join(HOME, '.bang-story', 'uploaded-names.json')
const EXPORTS = join(HOME, '.bang-story', 'exports')
const DRY = process.argv.includes('--dry')

const readJson = (f, fallback) => {
  try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return fallback }
}
// Nama yang sudah pernah tayang tidak boleh masuk antrean lagi (anti-dobel).
const uploaded = new Set(readJson(LEDGER, []))
let pending = readJson(PENDING, [])
const inQueue = new Set(pending.map((x) => x.name))

// Sumber nama: antrean produksi (queue.tsv / queue-longform.tsv) — id proyek + nama + gaya.
const names = new Map()
for (const f of ['queue.tsv', 'queue-longform.tsv']) {
  const p = join(HERE, f)
  if (!existsSync(p)) continue
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const parts = line.trim().split(/\s+/)
    if (parts.length >= 2 && /^[0-9a-f-]{8,}$/.test(parts[0])) names.set(parts[1], parts[0])
  }
}
if (!existsSync(EXPORTS)) {
  console.log('Folder ekspor belum ada:', EXPORTS)
  process.exit(0)
}
const files = readdirSync(EXPORTS).filter((f) => f.endsWith('.mp4'))
const added = []
for (const name of names.keys()) {
  if (uploaded.has(name) || inQueue.has(name)) continue
  // Ambil file terbaru untuk nama ini (produksi ulang menaddaki nama-N.mp4).
  const cands = files.filter((f) => f === `${name}.mp4` || f.startsWith(`${name}-`)).sort()
  if (!cands.length) continue
  const file = join(EXPORTS, cands[cands.length - 1])
  const item = { project: names.get(name), name, file, privacy: 'public' }
  pending.push(item)
  inQueue.add(name)
  added.push(item)
}
if (!added.length) {
  console.log(`Tidak ada ekspor baru untuk diantrekan (antrean: ${pending.length}).`)
  process.exit(0)
}
if (DRY) {
  console.log(`Akan diantrekan (${added.length}):`)
  for (const a of added) console.log('  ', a.name, '->', a.file)
  process.exit(0)
}
writeFileSync(PENDING, JSON.stringify(pending, null, 2))
console.log(`Diantrekan ${added.length}, total antrean ${pending.length}:`)
for (const a of added) console.log('  ', a.name)
