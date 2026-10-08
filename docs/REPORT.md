# Short Technical Report

## Stack

The connector uses Node.js 20+, Express, the official Model Context Protocol TypeScript/JavaScript SDK, and Zod as a project dependency. It exposes MCP tools over Streamable HTTP. PM2 is the recommended process manager, and Cloudflare Tunnel is the documented path to an HTTPS endpoint without directly opening the application port.

## Tool design

The server provides ten tools: `list_files`, `read_file`, `write_file`, `str_replace`, `delete_file`, `search_files`, `git_lite`, `repo_map`, `checkpoint`, and `get_project_state`. Tool descriptions are task-oriented. File tools operate on UTF-8 text, and the maximum file size is configurable. Text replacement fails when a match is absent and, by default, when the match is ambiguous. Delete is limited to one file or symlink. Git-lite permits only read-only status/diff/log/branch commands and never accepts arbitrary shell input.

## Sandbox and security tradeoffs

Every supplied path is resolved relative to a dedicated workspace root. Absolute paths and traversal outside the root are rejected, existing targets are realpath-checked, and symlink directories are not recursively followed. File writes revalidate the target after creating parent directories. The server supports a shared bearer token and uses timing-safe token comparison. The recommended deployment binds to loopback and places an HTTPS tunnel in front.

This is defense in depth, not a complete hostile multi-tenant sandbox. The process still runs with its OS user's permissions; filesystem races and platform-specific symlink behavior deserve additional hardening for high-risk environments. A shared bearer token does not identify individual users, and the project does not implement per-user ACLs, quotas, or a signed audit trail. Use a restricted OS account/container, do not place secrets in the workspace, rotate the token, and do not expose the local port directly.

## Validation plan

Run `npm test`, then start the service and run `npm run demo`. The demo opens one MCP client session to create and edit a note and write a checkpoint, then opens a second independent client session to read/search the same note and retrieve the saved project state. The resulting `DEMO_TRANSCRIPT.md` is the evidence artifact for the multi-session task. Do not claim a successful live run until the transcript is generated and inspected.
