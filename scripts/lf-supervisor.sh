#!/bin/bash
# Supervisor render ulang 3 long-form: mencoba terus (maks 10 putaran, jeda 10 menit) sampai ketiganya
# sukses — naskah 67 adegan sering bikin endpoint LLM timeout, jadi yang dibutuhkan adalah ketekunan,
# bukan satu percobaan. Jalankan dengan nohup supaya tetap hidup walau sesi SSH putus:
#   setsid nohup bash scripts/lf-supervisor.sh >> /tmp/lf-supervisor.log 2>&1 < /dev/null &
cd ~/bang-story || exit 1
LOG=/tmp/lf-supervisor.log
DONE=/tmp/lf-supervisor.done
: >> "$LOG"
: > "$DONE"
TARGETS=$'e6eeed3e-8924-4648-a29a-6094fe49f232 lf-moon-face photo\nce81431d-47d6-4cb5-ac3f-aeadd0317b1a lf-eyes-sight diagram\n0fbe217c-a781-4620-837b-a1c567720019 lf-magnetic-shield diagram'

for round in $(seq 1 10); do
  sisa=0
  while read -r proj name style; do
    [ -z "$name" ] && continue
    grep -q "^$name\$" "$DONE" && continue
    sisa=1
    echo "[putaran $round] $name mulai $(date '+%F %T')"
    BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs \
      --project "$proj" --name "$name" --style "$style" --rebuild-script > "/tmp/nx-full-$name.log" 2>&1
    rc=$?
    echo "[putaran $round] $name EXIT=$rc $(date '+%F %T')"
    if [ "$rc" = 0 ]; then
      new=$(ls -t "$HOME"/.bang-story/exports/"$name"*.mp4 2>/dev/null | head -1)
      target="$HOME/.bang-story/exports/$name.mp4"
      if [ -n "$new" ] && [ "$new" != "$target" ]; then mv -f "$new" "$target"; fi
      echo "$name" >> "$DONE"
    fi
  done <<< "$TARGETS"
  [ "$sisa" = 0 ] && break
  echo "[putaran $round] istirahat 10 menit sebelum coba lagi"
  sleep 600
done
echo "SUPERVISOR_SELESAI $(date '+%F %T')"
