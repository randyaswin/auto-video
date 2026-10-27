# PROMPT-SINGKAT.md - prompt pendek, tanpa git

Tempel dokumen `SPEC.md`, `AGENT.md`, `PERINTAH.md`, `TOPIC-BANK.md` sebagai lampiran, lalu kirim
blok berikut.

```
Empat dokumen terlampir adalah pipeline "Auto Video" (dulu Bang Story): produksi video YouTube
otomatis (ide -> naskah -> media -> MP4 -> unggah). Pahami lalu jalankan.

1. Baca dokumen. Ringkas 5 baris: di mana server web, cara membuka pass unlimited, tiga aturan
   yang tidak boleh dilanggar, isi antrean. Tunggu persetujuan saya.
2. Cek `curl -s http://100.115.185.3:4627/api/health` lewat SSH ke randy@fedora-laptop, lalu
   `cd ~/auto-video && node scripts/nexabot-refresh-cookie.mjs`. Harus "Sesi hidup - unlimited
   AKTIF". Kalau gagal, ikuti AGENT.md bagian 5 (login OTP sekali). Jangan pernah tulis API key
   atau cookie di chat/log.
3. Produksi: `cd ~/auto-video && bash scripts/run-queue.sh` untuk Shorts;
   `node scripts/nexabot-produce.mjs --project <uuid> --name lf-<nama> --scenes 12` untuk long-form
   (resume otomatis bila diulang). Satu produksi pada satu waktu - unlimited hanya satu job per akun.
4. Topik baru wajib lolos `node scripts/topic-check.mjs "Judul"` (skor < 0,35) sebelum dibuat.
5. Unggah: `node scripts/queue-pending.mjs`, lalu biarkan cron mengirim 1 video per slot.
   Upload selalu public.

Aturan keras: semua scene video penuh (tanpa loop, tanpa frame beku, maks 10 dtk);
Shorts 9:16, long-form 16:9; satu video per slot; lapor dengan bukti (path file, durasi
ffprobe, id job), bukan klaim.
```

Kalau agent menjawab "pakai API key NexaBot", "render paralel biar cepat", "unggah semua sekarang",
atau "selesai" tanpa bukti - serah-terimanya gagal, hentikan dan koreksi.

Catatan nama: repo dan folder kini `auto-video`. Nama `BANG_STORY_URL`, folder data `~/.bang-story/`,
dan unit `bang-story.service` sengaja tetap - itu nama aplikasi dan data, bukan nama repo.
