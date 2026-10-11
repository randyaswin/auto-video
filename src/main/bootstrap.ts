import { getDb } from './db'
import { resumeJobs } from './generation'
import { warmUpEncryption } from './secrets'

/**
 * Brings the core up outside Electron: encryption, the database, and any Higgsfield jobs that were
 * already sent when the process last stopped. Shared by the web server and the MCP server so both
 * start from exactly the state the desktop app starts from.
 */
export function bootCore(): void {
  warmUpEncryption()
  getDb()
  resumeJobs()
}
