#!/bin/sh
# Render ulang seluruh antrean (Shorts + long-form) dengan aturan "full video": hitungan adegan kini
# mengikuti durasi target (±9 detik per adegan), jadi satu klip video NexaBot — yang selalu 10,01 detik —
# menutup adegan utuh. Tidak ada loop, tidak ada ekor frame beku. Naskah ditulis ulang (--rebuild-script).
# Jalankan dari folder repo: sh scripts/rerender-full.sh
cd ~/bang-story || exit 1
: > /tmp/nx-full.log
cat scripts/queue.tsv scripts/queue-longform.tsv 2>/dev/null | awk 'NF >= 2 {print $1, $2, $3}' |
  xargs -P 2 -n 3 sh -c '
    proj="$0"; name="$1"; style="${2:-photo}"
    BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs \
      --project "$proj" --name "$name" --style "$style" --rebuild-script > "/tmp/nx-full-$name.log" 2>&1
    rc=$?
    new=$(ls -t "$HOME"/.bang-story/exports/"$name"*.mp4 2>/dev/null | head -1)
    target="$HOME/.bang-story/exports/$name.mp4"
    if [ -n "$new" ] && [ "$new" != "$target" ]; then mv -f "$new" "$target"; fi
    echo "$name EXIT=$rc" >> /tmp/nx-full.log
  '
echo FULL_DONE >> /tmp/nx-full.log
