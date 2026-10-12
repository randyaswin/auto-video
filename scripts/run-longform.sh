#!/bin/sh
# Long-form menyusul setelah antrean Shorts beres, lalu jalan dua pekerja seperti antrean Shorts.
cd ~/bang-story || exit 1
for i in $(seq 1 240); do
  pgrep -f '[n]exabot-produce' >/dev/null || break
  sleep 30
done
: > /tmp/nx-queue-longform.log
xargs -P 2 -n 3 sh -c 'BANG_STORY_URL=http://100.115.185.3:4627 node scripts/nexabot-produce.mjs --project "$0" --name "$1" --scenes 16 --style "$2" --publish --privacy public > "/tmp/nx-$1.log" 2>&1; echo "$1 EXIT=$?" >> /tmp/nx-queue-longform.log' < ~/bang-story/scripts/queue-longform.tsv
echo LONGFORM_DONE >> /tmp/nx-queue-longform.log
