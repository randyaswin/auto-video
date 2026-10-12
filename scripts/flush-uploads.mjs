#!/usr/bin/env node
/**
 * Sends the videos that waited out the daily upload quota. Runs once the quota resets (midnight
 * Pacific = 16:00/17:00 JST); anything still refused goes back on the list for the next attempt.
 *
 *   node scripts/flush-uploads.mjs            # semua yang tertunda
 *   node scripts/flush-uploads.mjs 3          # maksimal 3 video (kuota harian API = 6 unggahan)
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
const limit = process.argv[2] ? Number(process.argv[2]) : Infinity
const pending = JSON.parse(readFileSync(file, 'utf8'))
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
