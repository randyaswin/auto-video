# Web dan MCP

Inti aplikasi (database, LLM, Higgsfield, TTS, Whisper, FFmpeg) tidak lagi terikat pada Electron.
Tiga host menjalankan kode yang sama persis:

| Host | Entry | Dipakai untuk |
|---|---|---|
| Desktop (Electron) | `src/main/index.ts` | Aplikasi Windows seperti biasa |
| Server web | `src/server/index.ts` | Antarmuka di browser, bisa dijalankan di server |
| MCP | `src/mcp/index.ts` | Dipakai agen (Hermes, Claude Code, dsb.) lewat tools |

Semua memanggil satu registry yang sama: `dispatch()` di `src/main/ipc.ts`. Ada `POST /api/call`
di web dan ada tools MCP, tetapi keduanya mengeksekusi handler yang sama dengan yang dieksekusi
`ipcMain` di desktop, jadi perilaku naskah, generate, dan ekspor identik di ketiganya.

Berbeda host punya akses host masing-masing lewat `src/main/platform.ts` (folder data, dialog,
enkripsi kunci, perintah buka folder). Di luar Electron, dialog digantikan unggah berkas di browser,
dan kunci API disimpan terenkripsi AES-256-GCM pada berkas `.secret-key` di folder data.

## Menjalankan server web

```bash
npm install
npm run build:web     # electron-vite build + bundel server/MCP + rewrite studio:// → /studio/
npm run start:web     # http://127.0.0.1:4627
```

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `BANG_STORY_PORT` / `PORT` | `4627` | Port HTTP |
| `BANG_STORY_HOST` | `127.0.0.1` | Alamat bind; `0.0.0.0` atau IP Tailscale untuk diakses mesin lain |
| `STUDIO_USER_DATA` | `~/.bang-story` | Folder data (database, proyek, kunci, ekspor) |
| `STUDIO_APP_ROOT` | akar repo | Dipakai bila bundel dipindahkan dari `out/` |

Rute:

- `POST /api/call` — `{ "channel": "projects:list", "args": [] }`, sama seperti IPC.
- `GET /api/events` — Server-Sent Events untuk `event:job`, `event:clip`, `event:character`,
  `event:asset`, `event:whisper`.
- `POST /api/upload?projectId=…&kind=music|overlay` — badan mentah berkas; masuk lewat
  `importLocalAsset()` yang sama dengan dialog desktop.
- `GET /studio/asset/<proyek>/<path>` dan `/studio/fonts/<file>` — aset dengan dukungan `Range`.

Renderer tidak diubah: `src/renderer/public/web-api.js` mengisi `window.api` dengan `fetch` ke
`/api/call` dan `EventSource` ke `/api/events`. Di Electron file itu dimuat lebih dulu dan langsung
keluar karena preload sudah mengisi `window.api`.

## Menjalankan server MCP

```bash
npm run build:web
npm run start:mcp     # stdio, untuk klien MCP
npm run test:mcp      # smoke test: seed proyek demo → ekspor MP4
```

Contoh konfigurasi Hermes (`~/.hermes/config.yaml`) — server MCP berjalan di laptop, jadi Hermes
dipanggil lewat SSH supaya proyek dan kuncinya tetap satu folder data:

```yaml
mcp_servers:
  bang-story:
    command: ssh
    args:
      - -o
      - BatchMode=yes
      - -o
      - ServerAliveInterval=30
      - randy@fedora-laptop
      - node /home/randy/bang-story/out/mcp/index.cjs
    timeout: 1800          # ekspor dan generate butuh waktu lama
    connect_timeout: 60
```

Tanpa SSH, jalankan lokal dengan `command: node`, `args: [/path/to/bang-story/out/mcp/index.cjs]`.

### Daftar tools

| Tool | Fungsi |
|---|---|
| `projects_list`, `projects_create`, `projects_get`, `projects_remove` | Proyek |
| `story_script`, `story_visuals`, `story_music_prompt` | Naskah dan storyboard (LLM) |
| `generate_images`, `generate_videos`, `generate_tts` | Aset per adegan (Higgsfield / TTS) |
| `generate_narration`, `sync_captions` | Narasi utuh dan sinkron caption (Whisper) |
| `clips_split`, `assets_import` | Potong klip, impor musik/overlay |
| `export_video` | Render MP4, blokir sampai selesai, balikkan path hasil |
| `jobs_status`, `whisper_status` | Progres dan status |
| `settings_get`, `settings_set`, `settings_set_key`, `settings_keys` | Pengaturan dan kunci API |
| `demo_seed` | Proyek demo 4 adegan dari media sintetis — uji tanpa kunci API |

Tool yang menjalankan job menunggu sampai selesai (default, boleh diatur lewat `timeoutSec`) lalu
mengembalikan file hasil, karena klien MCP tidak bisa berlangganan `event:job`.

Dua proses (web dan MCP) boleh berjalan bersamaan: database memakai WAL.

## Batasan di host non-Windows

- **Whisper**: biner bawaan hanya `whisper-cli.exe`. Di Linux/macOS, `cliPath()` mencari
  `whisper-cli` di `PATH`; bila tidak ada, sinkron caption jatuh ke perkiraan waktu.
- **Dialog berkas**: pilihan folder ekspor di browser selalu memakai folder bawaan server
  (`~/.bang-story/exports`).
- **Ekspor**: `export:reveal` dan `whisper:openFolder` tidak melakukan apa-apa di web.
