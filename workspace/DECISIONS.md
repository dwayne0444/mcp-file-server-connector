# Decisions

1. **Node.js + official MCP SDK:** Uses the standard MCP Streamable HTTP transport and SDK client for the demo.
2. **Workspace sandbox:** All file operations are relative to `WORKSPACE_ROOT`; path traversal and symlink escapes are rejected.
3. **Small tool surface:** Git-lite is read-only; delete removes files only, not directories.
4. **Persistent handoff:** Markdown state files survive independent MCP client sessions.
5. **Deployment:** Keep the app bound to loopback and expose it via an HTTPS tunnel, protected by a bearer token.
