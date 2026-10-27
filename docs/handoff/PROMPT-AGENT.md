# PROMPT-AGENT.md — prompt siap tempel untuk agent lain

Ada dua versi. Pakai versi A kalau agent punya akses ke repo; versi B kalau tidak.

---

## Versi A — agent dengan akses repo (Hermes, Claude Code, agy, Kiro)

Salin utuh blok di bawah ini sebagai pesan pertama ke agent tersebut.

```
Kamu akan mengambil alih pipeline produksi video YouTube "Bang Story". Dokumen serah-terimanya ada
di repo git, bukan di chat ini.

LANGKAH 0 — baca dulu, jangan menebak
1. git clone git@github.com:randyaswin/bang-story.git ~/bang-story && cd ~/bang-story
2. git checkout web-mcp
3. Baca berurutan: docs/handoff/README.md, docs/handoff/SPEC.md, docs/handoff/AGENT.md,
   docs/handoff/PERINTAH.md, docs/handoff/TOPIC-BANK.md
4. Ringkas ke saya dalam 10 baris: (a) di mana server web berjalan, (b) bagaimana pass unlimited
   NexaBot dibuka, (c) tiga aturan yang tidak boleh dilanggar, (d) apa yang sedang menunggu di antrean.
   Jangan mulai produksi sebelum ringkasan ini saya setujui.

LANGKAH 1 — verifikasi lingkungan (laporkan apa adanya kalau gagal)
ssh randy@fedora-laptop 'curl -s http://100.115.185.3:4627/api/health'
ssh randy@fedora-laptop 'cd ~/bang-story && node scripts/nexabot-refresh-cookie.mjs'
Hasil yang benar: health {"ok":true,...} dan "Sesi hidup · unlimited AKTIF".
Kalau refresh gagal, sesi NexaBot mati: ikuti docs/handoff/AGENT.md bagian 5 (login OTP sekali).
Jangan pernah meminta, menampilkan, atau menulis API key/cookie di chat, log, atau commit.

LANGKAH 2 — pulihkan keadaan yang sebenarnya
node scripts/sync-uploaded.mjs --dry     # ledger vs kanal YouTube (sumber kebenaran)
curl -s http://100.115.185.3:4627/api/call -H 'Content-Type: application/json' \
  -d '{"channel":"projects:list","args":[]}'
Bandingkan dengan docs/handoff/TOPIC-BANK.md dan koreksi kalau ada yang tidak cocok — file itu
catatan, bukan kebenaran. Lapor selisihnya.

LANGKAH 3 — produksi (hanya setelah langkah 1-2 bersih)
Shorts : bash scripts/run-queue.sh
Long-form (bertahap, resume):
  BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs \
    --project <uuid> --name lf-<nama> --style photo --scenes 12
Jalankan ulang perintah yang sama kalau proses mati — klip yang sudah jadi dilewati, tidak dari nol.
Jangan pernah menjalankan dua produksi bersamaan: pass unlimited hanya mengizinkan satu job per akun.

LANGKAH 4 — topik baru (selalu lewat gerbang)
node scripts/topic-check.mjs "Judul Baru"    # exit 1 = mirip (skor >= 0,35) -> ganti topik
node scripts/new-topic.mjs --title "..." --synopsis "..." --cluster tech --style photo --name <slug>
--style hanya photo | animation | 3d | diagram.

LANGKAH 5 — unggah (jeda wajib)
node scripts/queue-pending.mjs     # ekspor jadi -> pending-uploads.json
Cron di VPS yang mengirim: 1 Shorts per slot (07:30/11:30/15:30/19:30/23:30), 1 long-form per slot
(13:45/21:45). Jangan menembak semua video sekaligus di jam yang sama. Upload selalu public.

ATURAN KERAS
- Semua scene video penuh: tanpa loop, tanpa frame beku, maksimal 10 detik per adegan.
- Shorts 9:16, long-form 16:9. Proyek baru tanpa aspectRatio akan jadi landscape — periksa.
- Satu video per slot unggah. Tidak pernah menumpuk.
- Topik baru wajib skor < 0,35 terhadap 36 topik lama.
- Ledger uploaded-names.json harus disinkronkan dari kanal sebelum dipercaya.
- Lapor dengan bukti: path file, durasi ffprobe, id job, status HTTP. Jangan bilang "selesai"
  tanpa keluaran nyata.
```

---

## Versi B — agent tanpa akses repo (chat saja)

Tempel berkas `README.md`, `SPEC.md`, `AGENT.md`, `PERINTAH.md`, `TOPIC-BANK.md` sebagai lampiran,
lalu kirim pesan ini:

```
Lima dokumen terlampir adalah serah-terima pipeline "Bang Story" (produksi video YouTube otomatis
dari ide sampai unggah). Tugasmu: pahami lalu jalankan.

1. Baca kelima dokumen. Ringkas dalam 10 baris: di mana server web berjalan, bagaimana pass
   unlimited NexaBot dibuka, tiga aturan yang tidak boleh dilanggar, dan apa yang menunggu di antrean.
   Tunggu persetujuan saya sebelum eksekusi.
2. Setelah disetujui, jalankan sesuai AGENT.md bagian 0-2: cek health server, segarkan cookie,
   sinkronkan ledger, lalu laporkan selisih antara TOPIC-BANK.md dan keadaan sebenarnya.
3. Baru kemudian produksi (run-queue.sh untuk Shorts, nexabot-produce.mjs --scenes 12 untuk
   long-form dengan resume). Satu job pada satu waktu.
4. Unggah hanya lewat queue-pending.mjs + cron slot. Satu video per slot, public.

Jangan pernah menulis API key atau cookie di chat, log, atau commit. Kalau ada langkah gagal,
laporkan error aslinya, jangan mengarang hasil.
```

---

## Yang harus dicek dari jawaban agent

Kalau agent menjawab salah satu dari ini, serah-terimanya belum berhasil:

| Salah | Seharusnya |
|---|---|
| "Saya pakai API key NexaBot untuk generate" | API key 402; yang jalan cookie sesi web + `use_unlimited` |
| "Saya jalankan dua render paralel biar cepat" | Satu job per akun; paralel = 429 semua |
| "Semua video saya unggah sekarang" | 1 per slot, jadwal 5 Shorts + 2 long-form |
| "Topik ini mirip tapi saya lanjutkan" | Gate 0,35 menolak; ganti topik |
| "Selesai" tanpa path/durasi/id job | Wajib bukti: ffprobe, job id, status HTTP |
