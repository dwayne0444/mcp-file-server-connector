import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const project = path.resolve(new URL('..', import.meta.url).pathname);
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-file-server-test-'));
const port = 3400 + Math.floor(Math.random() * 1000);
const token = 'test-token-for-automated-tests';
let child;

async function waitForHealth() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) return; } catch {}
    await delay(100);
  }
  throw new Error('Server did not start');
}

// These tests exercise the actual HTTP MCP endpoint and auth boundary.
test.before(async () => {
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: project,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MCP_AUTH_TOKEN: token, WORKSPACE_ROOT: temp },
    stdio: 'ignore'
  });
  await waitForHealth();
});
test.after(async () => {
  child?.kill('SIGTERM');
  await fs.rm(temp, { recursive: true, force: true });
});

test('health is available and MCP requires bearer auth', async () => {
  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  const denied = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
});

test('rejects a non-initialize request without a session', async () => {
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  });
  assert.equal(response.status, 400);
});
