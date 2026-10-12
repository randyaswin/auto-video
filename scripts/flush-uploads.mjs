#!/usr/bin/env node
/**
 * Sends the videos that waited out the daily upload quota. Runs once the quota resets (midnight
 * Pacific = 16:00/17:00 JST); anything still refused goes back on the list for the next attempt.
 *
 *   node scripts/flush-uploads.mjs            # 2 Shorts + 1 long-form (rithme harian yang Randy minta)
 *   node scripts/flush-uploads.mjs 5          # batas lain; kuota API sendiri 6 unggahan/hari
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
// Daily rhythm Randy asked for: NOT the API maximum. Three a day — two Shorts and one long-form —
// so the channel grows at a human pace instead of dumping everything at once.
const limit = process.argv[2] ? Number(process.argv[2]) : 3
const pending = JSON.parse(readFileSync(file, 'utf8'))

// Long-form projects are listed in queue-longform.tsv; mix them into the batch instead of letting
// every long-form sit at the back of the queue behind two dozen Shorts.
const lfFile = join(dirname(fileURLToPath(import.meta.url)), 'queue-longform.tsv')
let longProjects = new Set()
if (existsSync(lfFile)) {
  longProjects = new Set(readFileSync(lfFile, 'utf8').split(/\n/).map((l) => l.split(/\s+/)[0]).filter(Boolean))
}
const isLong = (x) => longProjects.has(x.project)
const shorts = pending.filter((x) => !isLong(x))
const longs = pending.filter(isLong)
const ordered = []
while (ordered.length < limit && (shorts.length || longs.length)) {
  for (let k = 0; k < 2 && shorts.length && ordered.length < limit; k++) ordered.push(shorts.shift())
  if (longs.length && ordered.length < limit) ordered.push(longs.shift())
  if (!shorts.length && !longs.length) break
}
pending.splice(0, pending.length, ...ordered, ...shorts, ...longs)
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
