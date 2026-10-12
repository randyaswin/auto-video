#!/usr/bin/env node
/**
 * Sends the videos that waited out the daily upload quota. Runs once the quota resets (midnight
 * Pacific = 16:00/17:00 JST); anything still refused goes back on the list for the next attempt.
 *
 *   node scripts/flush-uploads.mjs            # ritme harian: 5 Shorts + 2 long-form
 *   node scripts/flush-uploads.mjs 8 2        # override: 8 Shorts + 2 long-form (kuota API = 6/hari!)
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = join(homedir(), '.bang-story', 'pending-uploads.json')
if (!existsSync(file)) {
  console.log('Tidak ada video tertunda.')
  process.exit(0)
}
// Daily rhythm Randy asked for: five Shorts plus two long-form a day — steady, not a dump. (The API
// itself allows six uploads a day, so five Shorts alone already sits near the ceiling; a refused
// upload goes straight back on the list for the next run.)
const dry = process.argv.includes('--dry-run')
const args = process.argv.slice(2).filter((a) => a !== '--dry-run').map(Number).filter((n) => Number.isFinite(n))
const quotaShorts = args[0] ?? 5
const quotaLongs = args[1] ?? 2
const limit = quotaShorts + quotaLongs
const pending = JSON.parse(readFileSync(file, 'utf8'))

// Long-form projects are listed in queue-longform.tsv; mix them into the batch instead of letting
// every long-form sit at the back of the queue behind two dozen Shorts.
const lfFile = join(dirname(fileURLToPath(import.meta.url)), 'queue-longform.tsv')
let longProjects = new Set()
if (existsSync(lfFile)) {
  longProjects = new Set(readFileSync(lfFile, 'utf8').split(/\n/).map((l) => l.split(/\s+/)[0]).filter(Boolean))
}
const isLong = (x) => longProjects.has(x.project)
const allShorts = pending.filter((x) => !isLong(x))
const allLongs = pending.filter(isLong)
const pickedShorts = allShorts.slice(0, quotaShorts)
const pickedLongs = allLongs.slice(0, quotaLongs)
// Spread the long-form across the Shorts instead of stacking them: one long-form at the end of every
// stretch of Shorts, so a single day's uploads look like a mix, not a block.
const ordered = []
const restShorts = allShorts.slice(quotaShorts)
const restLongs = allLongs.slice(quotaLongs)
while (pickedShorts.length || pickedLongs.length) {
  const take = Math.ceil(pickedShorts.length / (pickedLongs.length + 1))
  for (let i = 0; i < take && pickedShorts.length; i++) ordered.push(pickedShorts.shift())
  if (pickedLongs.length) ordered.push(pickedLongs.shift())
}
if (dry) {
  console.log(`Rencana kirim hari ini (${ordered.length}):`)
  ordered.forEach((x, i) => console.log(`  ${i + 1}. ${x.name}${isLong(x) ? ' [long-form]' : ''}`))
  console.log(`Sisa tertunda: ${pending.length - ordered.length}`)
  process.exit(0)
}
pending.splice(0, pending.length, ...ordered, ...restShorts, ...restLongs)
const rest = []
let sent = 0
for (const item of pending) {
  if (sent >= limit) { rest.push(item); continue }
  console.log(`Kirim ${item.name} …`)
  const r = spawnSync(process.execPath, [
    join(dirname(fileURLToPath(import.meta.url)), 'nexabot-produce.mjs'),
    '--project', item.project, '--name', item.name, '--publish-only',
    '--privacy', item.privacy ?? 'private'
  ], { stdio: 'inherit' })
  if (r.status === 0) { sent++; console.log(`  terkirim: ${item.name}`) }
  else { console.log(`  masih tertunda: ${item.name}`); rest.push(item) }
}
writeFileSync(file, JSON.stringify(rest, null, 2))
console.log(`Selesai. Terkirim ${sent}, masih tertunda ${rest.length}.`)
