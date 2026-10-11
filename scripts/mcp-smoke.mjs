#!/usr/bin/env node
/**
 * Smoke test for the MCP server: connect over stdio, list the tools, seed the demo project and
 * render it to MP4. Proves the whole pipeline (SQLite, jobs, FFmpeg, export) without API keys.
 *
 * Run from the repo root, after `npm run build:web`:
 *   node scripts/mcp-smoke.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['out/mcp/index.cjs'],
  stderr: 'pipe'
})
transport.stderr?.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`))

const client = new Client({ name: 'bang-story-smoke', version: '1.0.0' })
await client.connect(transport)

const call = async (name, args = {}) => {
  const res = await client.callTool({ name, arguments: args }, undefined, { timeout: 900_000 })
  const text = (res.content ?? [])
    .map((c) => c.text)
    .filter(Boolean)
    .join('\n')
  if (res.isError) throw new Error(`${name} gagal: ${text}`)
  return text
}

const tools = await client.listTools()
console.log(`tools (${tools.tools.length}): ${tools.tools.map((t) => t.name).join(', ')}`)

const seed = JSON.parse(await call('demo_seed'))
console.log(`demo: ${seed.projectId} — ${seed.title}, ${seed.clips.length} klip`)
console.log(`  klip 1 gambar: ${seed.clips[0].image}`)
console.log(`  klip 1 suara : ${seed.clips[0].voice}`)

const exported = JSON.parse(
  await call('export_video', { projectId: seed.projectId, fileName: 'smoke-mcp', resolution: 720, fps: 30 })
)
console.log(`export selesai: ${exported.file ?? exported.message} (status ${exported.status})`)

const jobs = JSON.parse(await call('jobs_status', { projectId: seed.projectId, limit: 10 }))
console.log(`jobs: ${jobs.map((j) => `${j.kind}=${j.status}`).join(', ')}`)

await client.close()
console.log('SMOKE_OK')
