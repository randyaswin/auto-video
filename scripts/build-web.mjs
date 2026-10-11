import { build } from 'esbuild'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Bundles the two headless hosts — the web server and the MCP server — and rewrites the renderer
 * for the browser. Run after `electron-vite build` (npm run build:web does both).
 *
 * Native and host-provided modules stay external: better-sqlite3 is a compiled addon, ffmpeg-static
 * is a path to a binary, and `electron` must never be evaluated outside Electron.
 */
const root = process.cwd()

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
  alias: { '@shared': resolve(root, 'src/shared') },
  external: ['electron', 'better-sqlite3', 'ffmpeg-static', 'ffprobe-static']
}

await build({ ...shared, entryPoints: ['src/server/index.ts'], outfile: 'out/server/index.cjs' })
await build({ ...shared, entryPoints: ['src/mcp/index.ts'], outfile: 'out/mcp/index.cjs' })

/** `studio://…` only exists inside Electron; in the browser those URLs are same-origin routes. */
function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

const rendererDir = resolve(root, 'out/renderer')
let rewritten = 0
for (const file of walk(rendererDir)) {
  if (!/\.(css|js|html|js.map|css.map)$/.test(file)) continue
  const before = readFileSync(file, 'utf8')
  const after = before.split('studio://').join('/studio/')
  if (after !== before) {
    writeFileSync(file, after)
    rewritten++
  }
}

console.log(`build:web selesai — server + MCP dibundel, ${rewritten} berkas renderer diubah (studio:// → /studio/)`)
