import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/**
 * Everything the core needs from its host environment, in one place.
 *
 * The same code runs inside Electron (desktop app), inside the web server, and inside the MCP
 * server. Only the Electron build may touch `electron`, so every access goes through a lazy
 * `require` guarded by `isElectron`: a plain Node process must never import the module, because a
 * static named import from the `electron` npm package fails to link under ESM.
 */

export const isElectron: boolean = typeof process.versions.electron === 'string'

type ElectronModule = typeof import('electron')

let cachedElectron: ElectronModule | null | undefined

function el(): ElectronModule | null {
  if (!isElectron) return null
  if (cachedElectron === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cachedElectron = require('electron') as ElectronModule
    } catch {
      cachedElectron = null
    }
  }
  return cachedElectron
}

export function isPackaged(): boolean {
  return el()?.app?.isPackaged ?? false
}

/** Root of the repository / installed app: fonts, bundled binaries, package.json. */
export function appRoot(): string {
  if (isElectron) {
    const app = el()?.app
    if (app) return app.getAppPath()
  }
  if (process.env.STUDIO_APP_ROOT) return resolve(process.env.STUDIO_APP_ROOT)
  // out/server/index.cjs (and out/mcp/index.cjs) live two levels below the root.
  return resolve(__dirname, '..', '..')
}

/** Folder with the read-only files shipped with the app (fonts, whisper binaries). */
export function resourcesRoot(): string {
  if (isElectron && isPackaged() && process.resourcesPath) return process.resourcesPath
  return join(appRoot(), 'resources')
}

/** The single folder holding the database, projects, keys and caches. */
export function userDataDir(): string {
  const fromElectron = el()?.app?.getPath('userData')
  if (fromElectron) return fromElectron
  if (process.env.STUDIO_USER_DATA) return resolve(process.env.STUDIO_USER_DATA)
  return join(homedir(), '.bang-story')
}

/** Where finished MP4 files go when the user never picked a folder. */
export function defaultVideosDir(): string {
  const fromElectron = el()?.app?.getPath('videos')
  if (fromElectron) return join(fromElectron, 'Bang Story')
  const dir = join(userDataDir(), 'exports')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function appVersion(): string {
  if (isElectron && el()?.app?.getVersion()) return el()!.app.getVersion()
  try {
    const pkg = JSON.parse(readFileSync(join(appRoot(), 'package.json'), 'utf8')) as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// ---------- desktop affordances (no-ops in the web build) ----------

export function openExternal(url: string): void {
  void el()?.shell?.openExternal(url)
}

export function showItemInFolder(path: string): void {
  void el()?.shell?.showItemInFolder(path)
}

export function openPath(path: string): void {
  void el()?.shell?.openPath(path)
}

export function copyText(text: string): void {
  el()?.clipboard?.writeText(text)
}

export interface PickOptions {
  title?: string
  defaultPath?: string
  /** Extensions without a dot, e.g. `['png', 'jpg']`. Directories when `directory` is set. */
  extensions?: string[]
  directory?: boolean
}

/** Returns the chosen path, or null when the dialog was cancelled (always null outside Electron). */
export async function pickPath(opts: PickOptions): Promise<string | null> {
  const app = el()?.app
  const dialog = el()?.dialog
  if (!app || !dialog) return null
  const res = await dialog.showOpenDialog({
    title: opts.title,
    defaultPath: opts.defaultPath,
    properties: opts.directory ? ['openDirectory', 'createDirectory'] : ['openFile'],
    ...(opts.extensions?.length
      ? { filters: [{ name: 'File', extensions: opts.extensions }] }
      : {})
  })
  if (res.canceled || !res.filePaths[0]) return null
  return res.filePaths[0]
}

// ---------- secret storage ----------
//
// Electron uses safeStorage (DPAPI on Windows, keychain-backed on macOS/Linux). Plain Node has no
// equivalent, so keys are sealed with AES-256-GCM using a key file next to the database. The file
// is only readable by the owner of the account running the server, which is the same trust boundary
// the database itself sits behind.

let plainKey: Buffer | null = null

function keyFile(): string {
  return join(userDataDir(), '.secret-key')
}

function secretKey(): Buffer {
  if (plainKey) return plainKey
  mkdirSync(userDataDir(), { recursive: true })
  const file = keyFile()
  if (existsSync(file)) {
    plainKey = readFileSync(file)
  } else {
    plainKey = randomBytes(32)
    writeFileSync(file, plainKey, { mode: 0o600 })
    try {
      chmodSync(file, 0o600)
    } catch {
      // Best effort on filesystems without POSIX modes.
    }
  }
  return plainKey
}

/** Called once at startup so the key material exists before the first secret is saved. */
export function warmUpEncryption(): void {
  const safeStorage = el()?.safeStorage
  if (safeStorage?.isEncryptionAvailable()) {
    try {
      safeStorage.encryptString('bang-story')
    } catch {
      // Ignore; the fallback below still works.
    }
    return
  }
  if (isElectron) return // Electron without encryption keeps the old plain-storage fallback.
  secretKey()
}

export function encryptString(value: string): Buffer {
  const safeStorage = el()?.safeStorage
  if (safeStorage?.isEncryptionAvailable()) return safeStorage.encryptString(value)
  if (isElectron) return Buffer.from(value, 'utf8') // legacy plain row, readable by decryptString
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv)
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([iv, enc, cipher.getAuthTag()])
}

export function decryptString(value: Buffer): string | null {
  const safeStorage = el()?.safeStorage
  if (safeStorage?.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(value)
    } catch {
      return null
    }
  }
  if (value.length === 0) return ''
  if (isElectron) return value.toString('utf8')
  try {
    if (value.length < 12 + 16) return value.toString('utf8')
    const iv = value.subarray(0, 12)
    const tag = value.subarray(value.length - 16)
    const body = value.subarray(12, value.length - 16)
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
