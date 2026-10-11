/**
 * `window.api` for the browser build.
 *
 * The desktop app gets this object from its preload script. In a browser every call becomes a
 * POST to /api/call and every listener a Server-Sent Events subscription, so the renderer code
 * stays identical in both hosts.
 */
(() => {
  if (window.api) return // Electron already exposed it through the preload script

  const listeners = new Map() // event channel -> Set<callback>
  let source = null

  const dispatchEvent = (channel, payload) => {
    const set = listeners.get(channel)
    if (!set) return
    for (const cb of [...set]) {
      try {
        cb(payload)
      } catch (e) {
        console.error('Listener event gagal:', channel, e)
      }
    }
  }

  const ensureSource = () => {
    if (source && source.readyState !== EventSource.CLOSED) return
    source = new EventSource('/api/events')
    for (const channel of ['event:job', 'event:clip', 'event:character', 'event:asset', 'event:whisper']) {
      source.addEventListener(channel, (e) => {
        let payload = null
        try {
          payload = JSON.parse(e.data)
        } catch {
          /* payload rusak diabaikan, koneksi tetap hidup */
        }
        dispatchEvent(channel, payload)
      })
    }
  }

  const call = (channel) => async (...args) => {
    const res = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args })
    })
    let data = null
    try {
      data = await res.json()
    } catch {
      /* badan respons kosong */
    }
    if (!res.ok) throw new Error((data && data.error) || `Permintaan ${channel} gagal (HTTP ${res.status})`)
    return data.result
  }

  const listen = (channel) => (cb) => {
    ensureSource()
    let set = listeners.get(channel)
    if (!set) {
      set = new Set()
      listeners.set(channel, set)
    }
    set.add(cb)
    return () => set.delete(cb)
  }

  const pickFile = (accept) =>
    new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null)
      input.click()
    })

  // The desktop picks a file through a native dialog; the browser uploads it instead, and the
  // server runs the very same import rules.
  const upload = async (projectId, kind, accept) => {
    const file = await pickFile(accept)
    if (!file) return null
    const url = `/api/upload?projectId=${encodeURIComponent(projectId)}&kind=${kind}&name=${encodeURIComponent(file.name)}`
    const res = await fetch(url, { method: 'POST', body: file })
    let data = null
    try {
      data = await res.json()
    } catch {
      /* badan respons kosong */
    }
    if (!res.ok) throw new Error((data && data.error) || 'Unggahan berkas gagal')
    return data.result
  }

  window.api = {
    projects: {
      list: call('projects:list'),
      create: call('projects:create'),
      get: call('projects:get'),
      save: call('projects:save'),
      remove: call('projects:remove'),
      duplicate: call('projects:duplicate')
    },
    story: {
      script: call('story:script'),
      visuals: call('story:visuals'),
      musicPrompt: call('story:musicPrompt')
    },
    generate: {
      clipImage: call('generate:clipImage'),
      clipVideo: call('generate:clipVideo'),
      clipTts: call('generate:clipTts'),
      characterSheet: call('generate:characterSheet'),
      missingImages: call('generate:missingImages'),
      missingVideos: call('generate:missingVideos'),
      missingTts: call('generate:missingTts'),
      narration: call('generate:narration'),
      syncCaptions: call('generate:syncCaptions'),
      cancel: call('generate:cancel'),
      estimate: call('generate:estimate')
    },
    clips: {
      split: call('clips:split'),
      detachVoice: call('clips:detachVoice')
    },
    assets: {
      setActive: call('assets:setActive'),
      setWords: call('assets:setWords'),
      pickMusic: (projectId) => upload(projectId, 'music', '.mp3,.wav,.m4a,.ogg,audio/*'),
      pickImage: (projectId) => upload(projectId, 'overlay', '.png,.jpg,.jpeg,.webp,image/*')
    },
    settings: {
      get: call('settings:get'),
      set: call('settings:set'),
      keys: call('settings:keys'),
      setKey: call('settings:setKey'),
      setCustom: call('settings:setCustom'),
      clearKey: call('settings:clearKey'),
      revealKey: call('settings:revealKey'),
      testKey: call('settings:testKey'),
      voices: call('settings:voices')
    },
    models: {
      list: call('models:list')
    },
    exporter: {
      start: call('export:start'),
      // No folder dialog in a browser: the server owns the export folder.
      defaultFolder: call('export:defaultFolder'),
      pickFolder: async () => null,
      reveal: async () => {}
    },
    app: {
      openExternal: async (url) => {
        if (/^https:\/\//i.test(url)) window.open(url, '_blank', 'noopener')
      },
      copyText: async (text) => {
        try {
          await navigator.clipboard.writeText(String(text))
        } catch {
          /* clipboard diblokir browser */
        }
      },
      version: call('app:version')
    },
    whisper: {
      status: call('whisper:status'),
      download: call('whisper:download'),
      cancel: call('whisper:cancel'),
      remove: call('whisper:remove'),
      openFolder: async () => {}
    },
    on: {
      whisper: listen('event:whisper'),
      job: listen('event:job'),
      clip: listen('event:clip'),
      character: listen('event:character'),
      asset: listen('event:asset')
    }
  }
})()
