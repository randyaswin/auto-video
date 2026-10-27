#!/bin/bash
# Supervisor produksi: menunggu kredit NexaBot cukup, lalu menjalankan antrean Shorts + long-form.
# Loop tanpa henti: begitu kredit tersedia (Randy top up / unlimited aktif), produksi jalan lagi.
# Karena file yang sudah ada dilewati, pekerjaan yang gagal sebelumnya dilanjutkan dari titik gagal.
cd ~/auto-video || exit 1
LOG=/tmp/nx-supervisor.log
DONE=/tmp/nx-supervisor.done
: >> "$LOG"
credit() {
  K=$(grep -oE "[A-Za-z0-9_.-]{20,}" ~/.hermes/nexabot.env | head -1)
  curl -s -m 25 https://nexabot.id/api/v1/api/credit -H "x-api-key: $K" \
    | python3 -c "import sys,json;print(json.load(sys.stdin).get('credit',0))" 2>/dev/null || echo 0
}
# Cookie sesi web (bukan API key) yang membuka pass unlimited. JWT-nya berumur 30 hari dan diperbarui
# setiap kali dipakai, jadi OTP hanya perlu kalau sesi benar-benar mati (dilaporkan lalu supervisor berhenti).
for round in $(seq 1 9999); do
  echo "[putaran $round] mulai $(date '+%F %T')" >> "$LOG"
  refresh=$(node scripts/nexabot-refresh-cookie.mjs 2>&1)
  rc=$?
  echo "[putaran $round] cookie: $refresh" >> "$LOG"
  if [ "$rc" -ne 0 ]; then
    echo "[putaran $round] SESI MATI — perlu login OTP sekali; supervisor berhenti" >> "$LOG"
    break
  fi
  C=$(credit)
  echo "[putaran $round] kredit=$C (tidak dipakai saat unlimited)" >> "$LOG"
  if true; then
    bash scripts/run-queue.sh >> "$LOG" 2>&1
    [ -f scripts/queue-longform.tsv ] && [ -s scripts/queue-longform.tsv ] && xargs -P 1 -n 3 sh -c 'BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs --project "$0" --name "$1" --style "$2" > "/tmp/nx-$1.log" 2>&1; echo "$1 EXIT=$?" >> '"$LOG"'' < scripts/queue-longform.tsv
    echo "[putaran $round] produksi selesai $(date '+%F %T')" >> "$LOG"
  else
    echo "[putaran $round] kredit belum cukup — tunggu 15 menit" >> "$LOG"
    sleep 900
  fi
  # Kalau antrean sudah kosong dan semua file ada, berhenti (tidak perlu spin terus).
  if [ ! -s scripts/queue.tsv ]; then echo "ANTREAN KOSONG" >> "$LOG"; break; fi
  sleep 120
done
