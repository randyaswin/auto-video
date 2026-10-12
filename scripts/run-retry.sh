#!/bin/sh
# Render ulang Shorts yang belum menghasilkan file (gagal di tengah jalan).
cd ~/bang-story || exit 1
: > /tmp/nx-retry.log
xargs -P 2 -n 3 sh -c 'BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs --project "$0" --name "$1" --scenes 4 --style "$2" --redo-voice --publish --privacy public > "/tmp/nx-$1.log" 2>&1; echo "$1 EXIT=$?" >> /tmp/nx-retry.log' < ~/bang-story/scripts/queue-retry.tsv
echo RETRY_DONE >> /tmp/nx-retry.log
