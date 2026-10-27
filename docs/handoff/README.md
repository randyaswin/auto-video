# Start here

Folder ini adalah serah-terima pipeline Bang Story untuk agent lain.

| Berkas | Isi |
|---|---|
| `SPEC.md` | Arsitektur, aturan produksi, jalur unlimited via cookie, jebakan |
| `AGENT.md` | Urutan kerja agent: prasyarat, alur, diagnosa, aturan keras |
| `PERINTAH.md` | Salinan-tempel perintah siap pakai (setup, harian, diagnosa, cron, git) |
| `TOPIC-BANK.md` | Daftar topik: sudah produksi / belum / ide baru yang lolos gerbang |
| `PROMPT-AGENT.md` | Prompt siap tempel untuk agent lain (versi repo & versi chat) |

Urutan baca: `SPEC.md` → `AGENT.md` → `PERINTAH.md` → `TOPIC-BANK.md` → `PROMPT-AGENT.md`.

Aturan paling penting, kalau hanya satu yang diingat:
**satu job NexaBot pada satu waktu, satu video unggah per slot, topik wajib lolos `topic-check.mjs` dulu.**