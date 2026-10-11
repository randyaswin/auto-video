import { EVENTS } from '@shared/api'
import type { Asset, CharacterPatchEvent, ClipPatchEvent, Job, WhisperStatus } from '@shared/types'

export type EventListener = (channel: string, payload: unknown) => void

// One fan-out for every host: Electron forwards to its windows, the web server to each open SSE
// stream, and the MCP server simply never subscribes (it reads the job table instead).
const listeners = new Set<EventListener>()

export function subscribe(listener: EventListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function send(channel: string, payload: unknown): void {
  for (const listener of [...listeners]) {
    try {
      listener(channel, payload)
    } catch {
      // A broken listener must never take a generation job down with it.
    }
  }
}

export const emit = {
  job: (job: Job): void => send(EVENTS.job, job),
  clip: (e: ClipPatchEvent): void => send(EVENTS.clip, e),
  character: (e: CharacterPatchEvent): void => send(EVENTS.character, e),
  asset: (asset: Asset): void => send(EVENTS.asset, asset),
  whisper: (status: WhisperStatus): void => send(EVENTS.whisper, status)
}
