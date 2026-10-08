# Handoff Protocol

The connector stores context in four Markdown files under the workspace root so a new agent/client session can continue work without relying on conversation memory.

- `PROJECT_STATE.md`: current objective, status, milestone, known limitations.
- `PLAN_LOG.md`: ordered work plan and completion checkboxes.
- `CHECKPOINTS.md`: timestamped summaries, next steps, and decisions at handoff boundaries.
- `DECISIONS.md`: durable design choices and rationale.

## Protocol

1. **Start of session:** call `get_project_state`, then `list_files` or `repo_map` as needed.
2. **Before editing:** identify the next unchecked task in `PLAN_LOG.md`; read the relevant files.
3. **During work:** use `write_file` or `str_replace`; use `search_files` to verify assumptions.
4. **Before handoff:** call `checkpoint` with a concise summary, explicit next steps, and important decisions. Update the plan/state files if the milestone changed.
5. **Next session:** open a new MCP client session, call `get_project_state`, and verify the checkpoint against the actual workspace.

A checkpoint is durable but not cryptographically signed. Treat workspace contents as untrusted if multiple people or services can write to it.
