#!/bin/bash
# Supervisor render ulang 3 long-form: mencoba terus (maks 10 putaran, jeda 10 menit) sampai ketiganya
# sukses — naskah 67 adegan sering bikin endpoint LLM timeout, jadi yang dibutuhkan adalah ketekunan,
# bukan satu percobaan. Jalankan dengan nohup supaya tetap hidup walau sesi SSH putus:
#   setsid nohup bash scripts/lf-supervisor.sh >> /tmp/lf-supervisor.log 2>&1 < /dev/null &
cd ~/auto-video || exit 1
LOG=/tmp/lf-supervisor.log
DONE=/tmp/lf-supervisor.done
: >> "$LOG"
# LF_KEEP_DONE=1 keeps the finished list (a second run then only picks up what is still missing).
[ -z "${LF_KEEP_DONE:-}" ] && : > "$DONE"
# LF_ONLY=<nama> narik satu proyek saja, untuk melanjutkan tanpa mengulang yang sudah selesai.
TARGETS=$'e6eeed3e-8924-4648-a29a-6094fe49f232 lf-moon-face photo\nce81431d-47d6-4cb5-ac3f-aeadd0317b1a lf-eyes-sight diagram\n0fbe217c-a781-4620-837b-a1c567720019 lf-magnetic-shield diagram'

# Rounds are effectively endless and there is no rest between them: with the unlimited NexaBot pass
# the pipeline should keep generating, and only a failure costs a short wait before the next try.
for round in $(seq 1 999); do
  sisa=0
  while read -r proj name style; do
    [ -z "$name" ] && continue
    [ -n "${LF_ONLY:-}" ] && [ "$name" != "$LF_ONLY" ] && continue
    grep -q "^$name\$" "$DONE" && continue
    sisa=1
    echo "[putaran $round] $name mulai $(date '+%F %T')"
    # No --rebuild-script: a 67-scene long-form script is already stored scene by scene, and produce
    # resumes from whatever exists — only the missing media is generated again.
    BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs \
      --project "$proj" --name "$name" --style "$style" > "/tmp/nx-full-$name.log" 2>&1
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
  echo "[putaran $round] lanjut putaran berikutnya (jeda 30 dtk)"
  sleep 30
done
echo "SUPERVISOR_SELESAI $(date '+%F %T')"
