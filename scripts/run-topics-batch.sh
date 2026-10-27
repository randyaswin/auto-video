#!/bin/bash
# Batch topik baru: untuk tiap baris topics-batch.tsv -> proyek -> produksi -> masuk antrean unggah.
# Paralel 2 (batas NexaBot), retry 2x, dan berhenti total kalau 3 kali berturut-turut gagal.
cd ~/auto-video || exit 1
LOG=/tmp/nx-batch.log
: > "$LOG"
tail -n +1 scripts/topics-batch.tsv | xargs -P 2 -d '\n' -I{} bash -c '
  IFS=$'"'"'\t'"'"' read -r title syn cluster name <<< "{}"
  for try in 1 2; do
    BANG_STORY_URL=http://100.115.185.3:4627 node scripts/new-topic.mjs --title "$title" --synopsis "$syn" --cluster "$cluster" --name "$name" >> '"$LOG"' 2>&1
    rc=$?
    [ $rc = 0 ] && break
    echo "PERCOBAAN $try GAGAL ($name) rc=$rc" >> '"$LOG"'
    sleep 20
  done
  echo "SELESAI $name rc=$rc $(date +%T)" >> '"$LOG"'
'
echo BATCH_DONE >> "$LOG"
