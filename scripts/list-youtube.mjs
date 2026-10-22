#!/usr/bin/env node
// Daftar video yang benar-benar ada di kanal YouTube (ground truth).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
const t = JSON.parse(readFileSync(join(homedir(), '.bang-story', 'youtube-tokens.json'), 'utf8'))
async function tok() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: t.clientId, client_secret: t.clientSecret,
      refresh_token: t.refreshToken, grant_type: 'refresh_token'
    })
  })
  const j = await r.json()
  if (!j.access_token) throw new Error('token gagal: ' + JSON.stringify(j).slice(0, 200))
  return j.access_token
}
const a = await tok()
let page = null
const out = []
do {
  const u = new URL('https://www.googleapis.com/youtube/v3/search')
  u.searchParams.set('part', 'snippet')
  u.searchParams.set('forMine', 'true')
  u.searchParams.set('type', 'video')
  u.searchParams.set('maxResults', '50')
  if (page) u.searchParams.set('pageToken', page)
  const r = await fetch(u, { headers: { authorization: 'Bearer ' + a } })
  const j = await r.json()
  if (j.error) throw new Error(JSON.stringify(j.error))
  for (const it of j.items ?? []) out.push({ id: it.id.videoId, title: it.snippet.title, pub: it.snippet.publishedAt, dur: it.snippet.liveBroadcastContent })
  page = j.nextPageToken
} while (page)
console.log(JSON.stringify(out, null, 1))
