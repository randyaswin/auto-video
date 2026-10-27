# PERINTAH.md — salinan-tempel untuk agent lain

Semua perintah diasumsikan dijalankan **di laptop** (`randy@fedora-laptop`, repo `~/bang-story`),
kecuali ditandai `[VPS]`.

## Setup dari nol

```bash
# [VPS] clone repo
git clone git@github.com:randyaswin/bang-story.git && cd bang-story
git checkout web-mcp

# [VPS] salin ke laptop
scp -r docs/handoff randy@fedora-laptop:~/bang-story/docs/

# laptop: dependensi + build web
cd ~/bang-story && npm ci && node scripts/build-web.mjs

# laptop: jalankan server web (systemd user)
systemctl --user enable --now bang-story
curl -s http://100.115.185.3:4627/api/health

# laptop: staging di luar tmpfs
mkdir -p ~/.cache/nexabot-produce

# laptop: kredensial (jangan pernah di-commit)
install -m 600 /dev/null ~/.hermes/nexabot.env      # isi x-api-key (fallback saja)
install -m 600 /dev/null ~/.hermes/nexabot-cookie.txt  # nexabot_session=...; nexabot_otp_ticket=...
```

## Alur harian (ringkas)

```bash
# 1. pastikan sesi hidup
node scripts/nexabot-refresh-cookie.mjs

# 2. sinkronkan ledger dari kanal (anti-dobel)
node scripts/sync-uploaded.mjs

# 3. cek topik baru
node scripts/topic-check.mjs "Topik Baru"

# 4. buat + produksi (Shorts)
node scripts/new-topic.mjs --title "Topik Baru" --synopsis "..." --cluster tech --style photo --name topik-baru

# 5. produksi antrean
bash scripts/run-queue.sh

# 6. antrekan hasil
node scripts/queue-pending.mjs

# 7. unggah sesuai slot
node scripts/flush-uploads.mjs
```

## Perintah tunggal yang sering dipakai

```bash
# status server
curl -s http://100.115.185.3:4627/api/health

# daftar proyek + jumlah klip
curl -s http://100.115.185.3:4627/api/call -H 'Content-Type: application/json' \
  -d '{"channel":"projects:list","args":[]}' | python3 -m json.tool | head -40

# detail satu proyek
curl -s http://100.115.185.3:4627/api/call -H 'Content-Type: application/json' \
  -d '{"channel":"projects:get","args":["<uuid>"]}' | python3 -m json.tool

# geser proyek ke 9:16 bila terlanjur landscape
node -e 'const B="http://100.115.185.3:4627";const c=async(ch,a)=>(await(await fetch(B+"/api/call",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channel:ch,args:a})})).json()).result;
(async()=>{const s=await c("projects:get",[process.argv[1]]);await c("projects:save",[{project:{...s.project,aspectRatio:"9:16"},characters:s.characters,clips:s.clips}]);console.log("ok")})()' <uuid>

# ekspor ulang tanpa generate baru (semua aset sudah ada)
node -e 'const B="http://100.115.185.3:4627";const c=async(ch,a)=>(await(await fetch(B+"/api/call",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({channel:ch,args:a})})).json()).result;
(async()=>{console.log(await c("export:start",[process.argv[1],{burnCaptions:false,writeSrt:true}]))})()' <uuid>

# pratinjau antrean unggah
node scripts/queue-pending.mjs --dry

# cek kredit + status unlimited (route API key, hanya info)
curl -s https://nexabot.id/api/auth/me -H "Cookie: $(cat ~/.hermes/nexabot-cookie.txt)"
```

## Supervisor (produksi terus-menerus)

```bash
# jalankan di background, lepas dari sesi SSH
cd ~/bang-story && setsid nohup bash scripts/produce-supervisor.sh >/dev/null 2>&1 < /dev/null &

# lihat log
tail -f /tmp/nx-supervisor.log

# hentikan dengan bersih (urutan penting)
pkill -f produce-supervisor.sh; pkill -f run-queue.sh; pkill -f nexabot-produce
```

## Cron di VPS

```bash
hermes cron list
hermes cron run <job_id>        # jalankan sekali sekarang
hermes cron edit <job_id> --provider custom_nl
```

Job yang penting: `135537a832e1` (flush shorts), `4e2840d4ac85` (flush long-form),
`38eb9dc11759` (refresh cookie), `d9fb6c8c2119` (catat produksi), `f648759e7527` (pantau long-form).

## Git

```bash
git add -A && git commit -m "..." && git push fork HEAD:web-mcp
# laptop:
git fetch fork && git reset --hard fork/web-mcp
```
