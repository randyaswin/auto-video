#!/bin/sh
# Produksi antrean Shorts: naskah -> media -> ekspor -> (file masuk antrean unggah lewat queue-pending).
#
# SATU proyek pada satu waktu, tanpa jeda di antaranya. Ini bukan pilihan gaya: pass unlimited menolak
# job kedua selama masih ada satu job berjalan ("Generate sedang berjalan … mode unlimited", HTTP 429),
# jadi paralel justru membuat semuanya gagal. Dengan urutan begini akun terus menghasilkan selama
# batas harian belum tercapai — stok video menumpuk walau unggahannya dijeda sesuai jadwal.
cd ~/auto-video || exit 1
LOG=/tmp/nx-queue.log
: > "$LOG"
while read -r project name style; do
  [ -z "$name" ] && continue
  BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs \
    --project "$project" --name "$name" --style "$style" --scenes 4 --redo-voice > "/tmp/nx-$name.log" 2>&1
  echo "$name EXIT=$?" >> "$LOG"
  # Satu kegagalan tidak boleh menghentikan antrean; proyek berikutnya langsung jalan.
done < ~/auto-video/scripts/queue.tsv
echo QUEUE_DONE >> "$LOG"
