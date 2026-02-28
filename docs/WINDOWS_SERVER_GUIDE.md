# Windows Server Guide (E-katalog)

## 1) Run project as a server on your PC

From repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy_windows_server.ps1
```

This will:
- create `.env` from `.env.example` if missing,
- build and start production containers from `infra/docker/docker-compose.prod.yml`,
- apply Alembic migrations,
- check `http://localhost/api/v1/health`.

## 2) Mandatory security changes before internet exposure

Edit `.env` and change at minimum:
- `CURSOR_SECRET`
- `ADMIN_PASSWORD`
- `OPENAI_API_KEY` (if AI features are used)
- `NEXT_PUBLIC_APP_URL` to your public URL
- `CORS_ORIGINS` to your public domain(s)

Then rebuild:

```powershell
docker compose -f infra/docker/docker-compose.prod.yml up -d --build
```

## 3) Publish to internet (recommended: Cloudflare Tunnel)

This method does not require opening port `80` on your router.

1. Install `cloudflared` on Windows.
2. Authenticate:
```powershell
cloudflared tunnel login
```
3. Quick public URL for testing:
```powershell
cloudflared tunnel --url http://localhost:80
```
4. For permanent domain, create named tunnel and DNS route in Cloudflare Zero Trust.

### Permanent URL (named tunnel + domain)

Requirements:
- Your domain is added to Cloudflare.
- You know target hostname, for example `app.example.com`.

Run:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup_named_tunnel.ps1 -Hostname app.example.com
```

The script will:
- run `cloudflared tunnel login` if `cert.pem` is missing,
- create (or reuse) tunnel `e-katalog`,
- map DNS hostname to that tunnel,
- write `%USERPROFILE%\.cloudflared\config.yml`,
- install and start `cloudflared` Windows service.

Check:

```powershell
https://app.example.com
https://app.example.com/api/v1/health
```

## 4) Alternative: direct port forwarding (less safe)

1. Give this PC a static LAN IP (for example `192.168.1.50`).
2. On your router forward WAN `80 -> 192.168.1.50:80`.
3. Allow inbound TCP 80 in Windows Firewall.
4. Point your domain `A` record to your public IP.
5. Add HTTPS (for example, move TLS termination to Cloudflare proxy or a reverse proxy with certificates).

## 5) Useful operations

```powershell
docker compose -f infra/docker/docker-compose.prod.yml ps
docker compose -f infra/docker/docker-compose.prod.yml logs -f nginx
docker compose -f infra/docker/docker-compose.prod.yml logs -f api
docker compose -f infra/docker/docker-compose.prod.yml down
```


