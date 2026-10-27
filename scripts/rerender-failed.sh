#!/bin/sh
# Render ulang 4 video yang gagal pada render ulang massal (naskah LLM timeout + 1 langkah gambar).
# Kolom ke-4: `rebuild` = tulis ulang naskah (long-form), `keep` = pakai naskah yang ada (Shorts).
# Jalankan dari folder repo: sh scripts/rerender-failed.sh
cd ~/auto-video || exit 1
: > /tmp/nx-retry2.log
cat <<'EOF' | xargs -P 2 -n 4 sh -c '
  proj="$0"; name="$1"; style="$2"; mode="$3"
  extra=""; [ "$mode" = rebuild ] && extra="--rebuild-script"
  BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs \
    --project "$proj" --name "$name" --style "$style" $extra > "/tmp/nx-full-$name.log" 2>&1
  echo "$name EXIT=$?" >> /tmp/nx-retry2.log
'
b76253a4-ece4-44f0-9841-4ba554b41f11 magnets diagram keep
0fbe217c-a781-4620-837b-a1c567720019 lf-magnetic-shield diagram rebuild
ce81431d-47d6-4cb5-ac3f-aeadd0317b1a lf-eyes-sight diagram rebuild
e6eeed3e-8924-4648-a29a-6094fe49f232 lf-moon-face photo rebuild
EOF
echo RETRY2_DONE >> /tmp/nx-retry2.log
