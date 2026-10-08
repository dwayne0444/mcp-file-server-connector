# HTTPS deployment with PM2 and Cloudflare Tunnel

This guide keeps the MCP server on loopback and uses a tunnel for HTTPS. Never expose port 3333 directly to the public internet.

## 1. Configure authentication

```bash
cp .env.example .env
```

Generate a strong secret, for example with `openssl rand -hex 32`, and set `MCP_AUTH_TOKEN` in `.env`. Do not commit `.env`. The health endpoint is intentionally unauthenticated for basic monitoring; `/mcp` requires the bearer token when configured.

## 2. Install and run under PM2

```bash
npm install
npm install --global pm2
```

Load environment variables before starting PM2. On Linux/macOS:

```bash
set -a; . ./.env; set +a
pm2 start ecosystem.config.cjs --update-env
pm2 save
pm2 status
pm2 logs mcp-file-server
```

For a production host, configure PM2 startup using `pm2 startup` and follow the exact command it prints. On Windows, use a process manager appropriate to your environment or run under WSL; PM2's ecosystem file is included for Linux-style deployment.

## 3. Publish HTTPS using Cloudflare Tunnel

Install `cloudflared` from Cloudflare's official installation instructions and authenticate it with your Cloudflare account. For a quick temporary tunnel for testing:

```bash
cloudflared tunnel --url http://127.0.0.1:3333
```

Cloudflare prints a temporary `https://...trycloudflare.com` URL. The MCP endpoint is that URL plus `/mcp`. Keep the process running. Temporary tunnel hostnames can change and are not intended as a stable production address.

For a stable deployment, create a named Cloudflare Tunnel in the Cloudflare dashboard/CLI, route a hostname you control to `http://127.0.0.1:3333`, and configure the tunnel as a managed service. Follow Cloudflare's current docs for DNS and service installation because the commands vary by OS/account setup.

## 4. Connect a client

Use the full HTTPS endpoint, e.g. `https://your-host.example.com/mcp`, and configure an HTTP bearer token with the same value as `MCP_AUTH_TOKEN`. Keep the token private. To test with the included client:

```bash
MCP_URL='https://your-host.example.com/mcp' MCP_AUTH_TOKEN='your-token' npm run demo
```

## 5. Operational checks

- `GET /health` should return JSON with `status: ok`.
- The server logs its workspace root and whether bearer auth is enabled.
- Keep `WORKSPACE_ROOT` on a dedicated directory, not your home directory or a source tree containing secrets.
- Set an OS-level service account with minimal permissions and restrict access to logs.
- HTTPS encrypts traffic to the tunnel edge; the bearer token still needs to be protected and rotated.
