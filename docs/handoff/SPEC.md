# Bang Story — Spesifikasi Pipeline Produksi Video Otomatis

Dokumen ini menjelaskan sistem yang berjalan sekarang (Oktober 2026): fork `bangtutorial/bang-story`
yang diubah menjadi server web + server MCP, dengan produksi video YouTube otomatis untuk audiens AS.
Tujuan dokumen: **agent lain bisa menjalankan ulang pipeline yang serupa tanpa menebak-nebak**.

## 1. Arsitektur

```
Hermes (VPS)                        Laptop (Fedora, Tailscale)
├── cron jadwal unggah              ├── server web Bang Story :4627 (/api/call)
├── cron refresh cookie NexaBot     │     └── studio.db, projects/, exports/
├── gerbang topik (topic-check)     ├── MCP server (25 tools)
└── repo git (fork web-mcp)         ├── supervisor produksi (run-queue.sh)
                                    └── ledger anti-dobel + pending-uploads.json
                                          │
                                          ▼
                              YouTube Data API (upload + captions)
                              NexaBot (gambar, video, TTS) lewat cookie sesi web
```

Pemisahan peran: **VPS** memegang jadwal, gerbang topik, dan sumber kebenaran dokumen.
**Laptop** memegang media dan render (file besar tidak menyeberang jaringan).

## 2. Aturan produksi (tidak bisa dinegosiasikan)

1. **Tanpa loop, tanpa frame beku, semua scene video penuh.** Klip NexaBot selalu 10,01 dtk; scene
   tidak boleh lebih panjang dari itu. Jumlah scene mengikuti durasi target (~9 dtk/scene).
2. **Ritme unggah**: 5 Shorts + 2 long-form per hari, dijeda.
   Shorts 08:30 / 12:30 / 16:30 / 20:30 / 00:30 JST; long-form 14:45 / 22:45 JST.
3. **Satu video per slot.** Tidak pernah menumpuk di jam yang sama.
4. **Upload public**, bukan private/unlisted.
5. **Naskah 19 kata maksimum per scene** (Schedar voice ≈ 2,33 kata/dtk, 19 kata ≈ 8,2 dtk).
6. **Topik harus baru.** Gerbang `topic-check.mjs` menolak skor kemiripan ≥ 0,35.
7. **Anti-dobel.** Ledger `uploaded-names.json` adalah cermin kanal YouTube, bukan tebakan.
8. **Caption tidak dibakar** (`burnCaptions:false`), tapi SRT ditulis (`writeSrt:true`).
9. Shorts **9:16**, long-form **16:9**.
10. Selalu deskripsi + chapter + ~30 tag.

## 3. Jalur media: unlimited lewat cookie (bukan API key)

Ini bagian yang paling sering salah dipahami.

- API key **tidak** mendapat pass unlimited: `/api/v1/api` dan `/api/v1/generate` membalas **402**
  selama saldo kredit < 0,15 (saldo akun ini 0,1).
- Yang membuka pass adalah **cookie sesi web**:
  `POST https://nexabot.id/api/v1/generate` dengan header
  `Cookie: nexabot_session=…; nexabot_otp_ticket=…`, `Origin`/`Referer: https://nexabot.id`,
  body menyertakan `use_unlimited: true` dan `telegram_id`.
  Balasan **202** dengan `mode_type: "unlimited"`; kredit tidak berkurang.
- Cookie disimpan `~/.hermes/nexabot-cookie.txt` (mode 600) di VPS **dan** laptop.
- JWT `nexabot_session` berumur **30 hari** dan diperbarui setiap kali dipakai.
  `scripts/nexabot-refresh-cookie.mjs` menyegarkan + memverifikasi; cron harian 03:00 menjalankannya.
  OTP hanya diperlukan bila sesi benar-benar mati (laptop mati > 30 hari).
- **Satu job berjalan per akun.** Submit kedua dibalas 429 "Generate sedang berjalan".
  Karena itu produksi **serial**, bukan paralel.
- Selama cookie ada, `/generate` adalah **satu-satunya** route yang dicoba. Jatuh ke `/api`
  (API key) selalu gagal dengan "API key tidak valid" dan membuat scene kehilangan gambar.

## 4. Alur produksi

```
topik baru
  └─ topic-check.mjs            skor < 0,35 (wajib)
      └─ projects:create        9:16 untuk Shorts, 16:9 untuk long-form
          └─ nexabot-produce.mjs
              ├─ [1/4] story:script / story:scriptChunk (12 adegan per potong) → cap 19 kata
              ├─ [2/4] media per klip: gambar → video → suara (resume: yang ada dilewati)
              ├─ [3/4] ekspor MP4 (FFmpeg, caption tidak dibakar) + SRT
              └─ [4/4] selesai → ~/.bang-story/exports/<nama>.mp4
                  └─ queue-pending.mjs  → pending-uploads.json
                      └─ flush-uploads.mjs (cron)  → 1 video per slot, public
```

## 5. Komponen dan tanggung jawabnya

| Berkas | Peran |
|---|---|
| `scripts/topic-check.mjs` | Gerbang topik: skor kemiripan 0–1, exit 1 bila ≥ 0,35 |
| `scripts/topics-used.tsv` | Daftar topik sudah terpakai (36) |
| `scripts/new-topic.mjs` | Gerbang → buat proyek → produksi → antre |
| `scripts/nexabot-produce.mjs` | Mesin produksi: naskah, media, ekspor, resume |
| `scripts/nexabot-refresh-cookie.mjs` | Segarkan + verifikasi cookie sesi NexaBot |
| `scripts/run-queue.sh` | Produksi antrean **serial** tanpa jeda |
| `scripts/produce-supervisor.sh` | Poll: refresh cookie → jalankan antrean |
| `scripts/queue-pending.mjs` | Ekspor jadi → `pending-uploads.json` |
| `scripts/flush-uploads.mjs` | Kirim 1 video per slot ke YouTube |
| `scripts/sync-uploaded.mjs` | Sinkronkan ledger dari kanal (ground truth) |

## 6. Data di laptop

```
~/.bang-story/
├── studio.db                 proyek + klip (SQLite)
├── exports/                  <nama>.mp4 + <nama>.srt
├── projects/                 aset per proyek (gambar, video, suara)
├── uploaded-names.json       ledger anti-dobel
├── pending-uploads.json      antrean unggah
└── production-log.jsonl      jurnal produksi
~/.cache/nexabot-produce/     staging media (BUKAN /tmp — tmpfs penuh)
~/.hermes/nexabot-cookie.txt  cookie sesi (600)
```

## 7. Jebakan yang sudah memakan korban

- **Proyek tanpa `aspectRatio`** → render landscape 16:9, tidak layak Shorts. Selalu set 9:16.
- **`--scenes` dulu hanya batas bawah** → proyek 60 dtk menghasilkan 11 klip untuk Shorts.
  Sekarang `--scenes` adalah batas atas juga.
- **Staging di `/tmp`** (tmpfs Fedora) penuh → `Unknown system error -122, write`.
- **Paralel 2** → semua kena 429. Unlimited hanya 1 job per akun.
- **Ledger basi** (6 nama padahal 31 tayang) → video dobel. Sinkronkan dengan `sync-uploaded.mjs`.
- **Prompt medis** (luka, darah) kadang ditolak filter video → skrip ulang dengan prompt netral.
- **Style valid hanya** `photo | animation | 3d | diagram`. `cinematic` membuat batch gagal.
