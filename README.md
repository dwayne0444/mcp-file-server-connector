# Sandboxed MCP File-Server Connector

A small, self-hostable Model Context Protocol (MCP) server that gives compatible AI clients controlled access to a dedicated workspace. It includes file operations, exact text replacement, full-text search, read-only Git-lite tools, a repository map, and persistent handoff/checkpoint tools.

## Features and rubric mapping

| Requirement | Implementation |
|---|---|
| 1. Sandboxed workspace root; reject escapes | `src/server.js`: all paths resolve against `WORKSPACE_ROOT`; absolute paths, `..` traversal, and symlink escapes are rejected. Symlink directories are not traversed. |
| 2. At least 8 tools | `list_files`, `read_file`, `write_file`, `str_replace`, `delete_file`, `search_files`, `git_lite`, `repo_map`, `checkpoint`, `get_project_state` (10 tools). |
| 3. HTTPS tunnel + process manager | Cloudflare Tunnel instructions in `docs/DEPLOYMENT.md`; PM2 configuration in `ecosystem.config.cjs`. |
| 4. Handoff protocol | `PROJECT_STATE.md`, `PLAN_LOG.md`, `CHECKPOINTS.md`, and `DECISIONS.md` are initialized in the workspace; `checkpoint` and `get_project_state` tools preserve cross-session context. |
| 5. Real MCP client + multi-session task | `scripts/demo-client.js` uses the official MCP SDK client, opens two separate client sessions, and creates/edits/reads/searches durable files. Transcript is saved as `DEMO_TRANSCRIPT.md`. |
| 6. Short report | `docs/REPORT.md` documents the stack, tool design, and security tradeoffs. |

## Quick start

Requirements: Node.js 20+ and npm. Git is optional, but needed for `git_lite`.

```bash
npm install
cp .env.example .env
# Set MCP_AUTH_TOKEN in .env to a long random secret before exposing the server.
npm start
```

The server listens at `http://127.0.0.1:3333/mcp`. Health check: `http://127.0.0.1:3333/health`.

For local development without a `.env` loader, export the variables in your shell, or use the process manager with an environment file loaded by your shell. The server reads `MCP_AUTH_TOKEN`, `WORKSPACE_ROOT`, `HOST`, `PORT`, and `MAX_FILE_BYTES` directly from the environment.

Run the two-session demo in another terminal:

```bash
MCP_AUTH_TOKEN='your-token' npm run demo
```

If you have not enabled auth locally, run `npm run demo` without the token. The demo writes `workspace/demo/meeting-notes.md`, updates the handoff checkpoint, verifies the content from a fresh client session, and produces `DEMO_TRANSCRIPT.md`.

## Security notes

- Treat the workspace as the only file area the agent should be able to touch. Do not place secrets in it.
- Set a strong `MCP_AUTH_TOKEN` before exposing the service. Keep `.env` out of version control.
- Bind to loopback (`127.0.0.1`) and put an HTTPS tunnel in front of it; do not bind directly to a public interface by default.
- File operations are limited to UTF-8 text and a configurable maximum file size. Delete cannot remove directories. Git-lite is read-only and accepts only a fixed set of commands.
- The process runs with the operating-system permissions of its user. Run it as an unprivileged account/container for defense in depth.
- This project does not implement per-user authorization, audit signing, or quotas. A bearer token is a shared secret, not a full identity system.

See `docs/DEPLOYMENT.md`, `docs/HANDOFF_PROTOCOL.md`, and `docs/REPORT.md`.
