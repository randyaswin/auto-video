import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { appRoot, isElectron, isPackaged, resourcesRoot, userDataDir } from './platform'

export function dataDir(): string {
  return userDataDir()
}

export function dbPath(): string {
  return join(dataDir(), 'studio.db')
}

export function projectsRoot(): string {
  const dir = join(dataDir(), 'projects')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function projectDir(projectId: string): string {
  const dir = join(projectsRoot(), projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Absolute path of an asset stored relative to its project folder. */
export function assetAbsPath(projectId: string, localPath: string): string {
  return join(projectsRoot(), projectId, localPath)
}

export function fontsDir(): string {
  if (isElectron && isPackaged()) return join(resourcesRoot(), 'fonts')
  return join(appRoot(), 'resources', 'fonts')
}

/**
 * URL the renderer uses for a stored asset. Electron serves them from the `studio://` protocol;
 * the web server serves the same paths over HTTP at `/studio/...`.
 */
export function assetUrl(projectId: string, localPath: string): string {
  const rel = `${projectId}/${localPath}`.split(/[\\/]/).map(encodeURIComponent).join('/')
  return isElectron ? `studio://asset/${rel}` : `/studio/asset/${rel}`
}

/** ffmpeg-static / ffprobe-static paths, fixed up for the unpacked asar folder in the installed app. */
export function binPath(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}
