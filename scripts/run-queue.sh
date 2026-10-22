#!/bin/sh
# Produksi antrean Shorts: naskah -> media -> ekspor -> (file masuk antrean unggah lewat queue-pending).
# Paralel 2 (batas NexaBot). Sebelum tiap proyek, cek kredit NexaBot: kalau saldo tidak cukup
# untuk satu video penuh, berhenti dan tunggu supervisor (tidak membakar kredit sisa).
cd ~/bang-story || exit 1
LOG=/tmp/nx-queue.log
: > "$LOG"
xargs -P 2 -n 3 sh -c '
  K=$(grep -oE "[A-Za-z0-9_.-]{20,}" ~/.hermes/nexabot.env | head -1)
  C=$(curl -s -m 25 https://nexabot.id/api/v1/api/credit -H "x-api-key: $K" \
      | python3 -c "import sys,json;print(json.load(sys.stdin).get(\"credit\",0))" 2>/dev/null || echo 0)
  if ! python3 -c "import sys;sys.exit(0 if float(\"${C:-0}\")>=0.6 else 1)"; then
    echo "KREDIT HABIS ($C) — $1 menunggu supervisor" >> /tmp/nx-queue.log
    exit 3
  fi
  BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs --project "$0" --name "$1" --style "$2" --scenes 4 --redo-voice > "/tmp/nx-$1.log" 2>&1
  echo "$1 EXIT=$?" >> /tmp/nx-queue.log
' < ~/bang-story/scripts/queue.tsv
echo QUEUE_DONE >> "$LOG"
