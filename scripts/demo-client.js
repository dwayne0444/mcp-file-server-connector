import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const transcriptPath = path.resolve(__dirname, '../DEMO_TRANSCRIPT.md');
const url = process.env.MCP_URL || 'http://127.0.0.1:3333/mcp';
const token = process.env.MCP_AUTH_TOKEN || '';
const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
const transcript = [`# Demo tool-call transcript`, ``, `Target: ${url}`, `Started: ${new Date().toISOString()}`, ``];

async function session(label, task) {
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: `mcp-demo-${label}`, version: '1.0.0' });
  await client.connect(transport);
  transcript.push(`## ${label}`, '');
  try { await task(client); }
  finally { await client.close(); }
}
function logCall(name, args, result) {
  transcript.push(`### ${name}`, '', 'Arguments:', '```json', JSON.stringify(args, null, 2), '```', '', 'Result:', '```text', result, '```', '');
  console.log(`\n[${name}]\n${result}`);
}
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const value = (result.content || []).map(c => c.text || '').join('\n');
  logCall(name, args, value);
  if (result.isError) throw new Error(`${name} failed: ${value}`);
  return value;
}

try {
  // Session A creates a durable file and records a checkpoint.
  await session('Session A — create project notes', async client => {
    await call(client, 'write_file', { path: 'demo/meeting-notes.md', content: '# Meeting Notes\n\nStatus: draft\nOwner: project team\n\nNext: review the plan.\n' });
    await call(client, 'str_replace', { path: 'demo/meeting-notes.md', old_text: 'Status: draft', new_text: 'Status: reviewed' });
    await call(client, 'checkpoint', { summary: 'Created and reviewed the meeting notes.', next_steps: 'Session B should verify the saved file, then search for the word reviewed.', decisions: 'Keep notes in Markdown under demo/.' });
  });
  // Session B is a completely new MCP client session. It reads persisted workspace state.
  await session('Session B — verify handoff and continue', async client => {
    await call(client, 'read_file', { path: 'demo/meeting-notes.md' });
    await call(client, 'search_files', { query: 'reviewed', path: 'demo' });
    await call(client, 'get_project_state', {});
    await call(client, 'list_files', { path: '.', recursive: true });
  });
  transcript.push('## Result', '', 'PASS: a task was started in one MCP client session and continued in a separate session using durable workspace files and handoff checkpoints.', '');
  await fs.writeFile(transcriptPath, transcript.join('\n'), 'utf8');
  console.log(`\nPASS. Transcript saved to ${transcriptPath}`);
} catch (error) {
  transcript.push('## Result', '', `FAIL: ${error.stack || error.message}`, '');
  await fs.writeFile(transcriptPath, transcript.join('\n'), 'utf8');
  console.error(error);
  process.exitCode = 1;
}
