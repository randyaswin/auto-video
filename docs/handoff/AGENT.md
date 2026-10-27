# AGENT.md — cara menjalankan pipeline Bang Story

Bacalah `SPEC.md` di folder ini sebelum menyentuh apa pun. Dokumen ini hanya berisi **perintah**
dan urutan kerja, bukan penjelasan konsep.

## 0. Prasyarat

| Hal | Nilai |
|---|---|
| Repo | `git@github.com:randyaswin/bang-story.git`, branch `web-mcp` |
| Laptop | `randy@fedora-laptop` (Tailscale `100.115.185.3`) |
| Server web | `http://100.115.185.3:4627` (`/api/call`, `/api/health`) |
| Node | 22+ |
| Cookie NexaBot | `~/.hermes/nexabot-cookie.txt` (600) di VPS **dan** laptop |
| Ledger | `~/.bang-story/uploaded-names.json` |
| Antrean unggah | `~/.bang-story/pending-uploads.json` |

Cek kesehatan dasar sebelum bekerja:

```bash
ssh randy@fedora-laptop 'curl -s http://100.115.185.3:4627/api/health'
ssh randy@fedora-laptop 'cd ~/bang-story && node scripts/nexabot-refresh-cookie.mjs'
```

Keduanya harus sukses. Kalau refresh cookie gagal → sesi mati, perlu login OTP sekali (bagian 5).

## 1. Menambah topik baru (wajib gerbang dulu)

```bash
cd ~/bang-story
node scripts/topic-check.mjs "Judul Topik Baru"
# exit 0 = lolos, exit 1 = mirip (skor >= 0,35) -> ganti topik
```

Baru setelah lolos:

```bash
node scripts/new-topic.mjs \
  --title "Judul" \
  --synopsis "Satu paragraf penjelasan." \
  --cluster tech \
  --style photo \
  --name nama-pendek-unik
```

`--style` hanya boleh `photo | animation | 3d | diagram`.

## 2. Memproduksi antrean (Shorts)

```bash
bash scripts/run-queue.sh          # serial, tanpa jeda, resume otomatis
```

Pantau:

```bash
tail -f /tmp/nx-queue.log
tail -f /tmp/nx-<nama>.log
```

Satu proyek 4 adegan ≈ 5–8 menit. Jangan jalankan dua proses produksi bersamaan —
unlimited hanya mengizinkan **satu job** per akun.

## 3. Memproduksi long-form (12 adegan, bertahap)

```bash
BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs \
  --project <uuid> --name lf-nama --style photo --scenes 12
```

Resume otomatis: klip yang sudah punya gambar/video/suara dilewati. Kalau proses mati,
jalankan ulang perintah yang sama — tidak mengulang dari nol.

Long-form butuh sekitar 36 slot media berurutan (1,5–2 jam). Jalankan malam supaya tidak
bereebutan slot dengan Shorts.

## 4. Mengantrekan hasil dan mengunggah

```bash
node scripts/queue-pending.mjs          # ekspor jadi -> pending-uploads.json
node scripts/queue-pending.mjs --dry    # lihat dulu tanpa menulis
node scripts/flush-uploads.mjs 5 2      # kirim 5 Shorts + 2 long-form (atau sesuai jadwal)
```

Cron di VPS yang mengirim otomatis:

| Job | Jadwal | Peran |
|---|---|---|
| `flush-shorts-harian` | 07:30 11:30 15:30 19:30 23:30 | 1 Shorts per slot |
| `flush-longform-harian` | 13:45 21:45 | 1 long-form per slot |
| `nexabot-cookie-refresh` | 03:00 | segarkan cookie |
| `catat-produksi` | 07:10 | tulis jurnal |

## 5. Kalau cookie mati (perlu OTP sekali)

1. Buka `https://nexabot.id/login` di browser Hermes.
2. Isi User ID Telegram `607315970`, klik **Kirim OTP**.
3. Kode 6 digit masuk ke Telegram. Form-nya **6 input satu digit** — `browser_vault_enter_code`
   tidak bisa dipakai (bukan field tunggal). Isi lewat JS dengan setter native + event
   `input`/`keydown` per kotak, lalu klik **Verifikasi**.
4. Ambil cookie: `cdp('Network.getAllCookies')`, saring domain `nexabot.id`,
   tulis `nexabot_session=...; nexabot_otp_ticket=...` ke `~/.hermes/nexabot-cookie.txt` (600).
5. Salin ke laptop: `scp ~/.hermes/nexabot-cookie.txt randy@fedora-laptop:~/.hermes/`.
6. Verifikasi: `node scripts/nexabot-refresh-cookie.mjs` → harus "Sesi hidup · unlimited AKTIF".

## 6. Anti-dobel (jalankan berkala)

```bash
node scripts/sync-uploaded.mjs --dry   # lihat selisih ledger vs kanal
node scripts/sync-uploaded.mjs         # tulis ledger dari kanal (ground truth)
```

Ledger **harus** disinkronkan dari kanal sebelum percaya hitungan apa pun.

## 7. Diagnosa cepat

| Gejala | Penyebab umum | Tindakan |
|---|---|---|
| `429 Generate sedang berjalan` | job lain masih hidup | tunggu; skrip `waitForFreeSlot` menangani |
| `API key tidak valid` | jatuh ke route `/api` | pastikan cookie ada di laptop |
| `Unknown system error -122` | staging di `/tmp` penuh | pakai `~/.cache/nexabot-produce` |
| `Klip 0X belum punya gambar` | scene gagal di tengah | jalankan ulang perintah yang sama (resume) |
| Video landscape 16:9 | proyek tanpa `aspectRatio` | set 9:16 lalu render ulang |
| Tidak ada yang terunggah | `pending-uploads.json` kosong | `node scripts/queue-pending.mjs` |

## 8. Aturan yang tidak boleh dilanggar

- Satu video per slot unggah. Tidak pernah menumpuk.
- Upload selalu **public**.
- Semua scene video penuh: tanpa loop, tanpa frame beku.
- Topik baru selalu lewat `topic-check.mjs` lebih dulu.
- Jangan pernah menaruh API key atau cookie di commit, log, atau chat.
- Jangan menjalankan dua produksi NexaBot bersamaan.
