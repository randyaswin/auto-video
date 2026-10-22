#!/usr/bin/env node
// Daftar SEMUA entri di playlist upload (termasuk yang private/unlisted/deleted) — cari dobel.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const t = JSON.parse(readFileSync(join(homedir(), '.bang-story', 'youtube-tokens.json'), 'utf8'))
const r0 = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: t.clientId, client_secret: t.clientSecret, refresh_token: t.refreshToken, grant_type: 'refresh_token' })
})
const a = (await r0.json()).access_token
const H = { authorization: 'Bearer ' + a }
const ch = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=contentDetails&mine=true', { headers: H })).json()
const upl = ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads
console.log('uploads playlist:', upl)
let page = null
const items = []
do {
  const u = new URL(`https://www.googleapis.com/youtube/v3/playlistItems`)
  u.searchParams.set('part', 'snippet,contentDetails'); u.searchParams.set('playlistId', upl); u.searchParams.set('maxResults', '50')
  if (page) u.searchParams.set('pageToken', page)
  const j = await (await fetch(u, { headers: H })).json()
  if (j.error) { console.log(JSON.stringify(j.error)); break }
  for (const it of j.items ?? []) items.push({ title: it.snippet.title, vid: it.snippet.resourceId?.videoId, at: it.snippet.publishedAt, priv: it.snippet.status?.privacyStatus, state: it.status?.privacyStatus })
  page = j.nextPageToken
} while (page)
console.log('total entri playlist:', items.length)
const byTitle = {}
for (const i of items) {
  const k = (i.title || '').trim().toLowerCase()
  ;(byTitle[k] ??= []).push(i)
}
let dupes = 0
for (const [k, v] of Object.entries(byTitle)) {
  if (v.length > 1) { dupes++; console.log(`\nDOBEL x${v.length}: ${k}`); for (const i of v) console.log('   ', i.at, i.vid, i.priv) }
}
if (!dupes) console.log('Tidak ada judul dobel di playlist upload.')
for (const i of items) if (i.priv && i.priv !== 'public') console.log('non-public:', i.priv, i.title, i.at, i.vid)
