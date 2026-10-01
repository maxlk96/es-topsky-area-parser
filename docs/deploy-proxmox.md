# Deploy on Proxmox (Docker)

Self-host **ES-TopSky Area Parser** on a Proxmox LXC or VM. No Vercel account required. The app needs outbound HTTPS to LFV eAIP (`aro.lfv.se`), GitHub raw (TopSky baseline), and optionally CARTO / vatiris.

## Requirements

- Proxmox **LXC** (nesting + keyctl if Docker-in-LXC) or a **VM** with Docker Engine + Compose plugin
- Node is **not** required on the host when using Docker
- Open / forward host port **43127** (or set `PORT` in `.env`)

## Quick start

```bash
git clone https://github.com/maxlk96/es-topsky-area-parser.git
cd es-topsky-area-parser
git checkout main

cp .env.example .env
# optional: edit .env → CARTO_API_KEY=...

docker compose up -d --build
```

Open `http://<proxmox-or-vm-ip>:43127`.

```bash
docker compose logs -f app    # follow logs
docker compose pull && docker compose up -d --build   # update after git pull
docker compose down
```

## Without Docker

On a Debian/Ubuntu VM with Node 22+:

```bash
npm ci
npm run build
npm start   # 0.0.0.0:43127
```

Use systemd or similar to keep it running; put secrets in `.env.local` (not committed).

## Cursor agent deploy (optional)

Cloud agents cannot SSH into Proxmox by themselves. On a machine that can reach the Proxmox host (or on the VM itself), start a Cursor self-hosted worker:

```bash
cursor worker start
```

While that worker is connected, ask the agent to deploy/pull and `docker compose up` for you.

## Reverse proxy (optional)

Put nginx/Caddy in front for HTTPS on your LAN/VPN. Proxy to `http://127.0.0.1:43127`. Keep the app off the public internet unless you add your own auth.
