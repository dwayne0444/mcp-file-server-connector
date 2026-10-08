import 'dotenv/config';
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest, ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(projectRoot, process.env.WORKSPACE_ROOT || './workspace');
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3333);
const maxFileBytes = Number(process.env.MAX_FILE_BYTES || 1_048_576);
const authToken = process.env.MCP_AUTH_TOKEN || '';
const transports = new Map();

await fs.mkdir(workspaceRoot, { recursive: true });

function insideRoot(candidate) {
  const rel = path.relative(workspaceRoot, candidate);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

async function safePath(input, { mustExist = false } = {}) {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Path must be a non-empty relative path.');
  if (path.isAbsolute(input)) throw new Error('Absolute paths are not allowed. Use a path relative to the workspace root.');
  const candidate = path.resolve(workspaceRoot, input);
  if (!insideRoot(candidate)) throw new Error('Path escapes the sandboxed workspace root.');
  // Resolve existing targets to prevent symlink escapes.
  try {
    const real = await fs.realpath(candidate);
    if (!insideRoot(real)) throw new Error('Symlink escapes the sandboxed workspace root.');
    return real;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (mustExist) throw new Error(`Path does not exist: ${input}`);
    let parent = path.dirname(candidate);
    while (true) {
      try {
        const realParent = await fs.realpath(parent);
        if (!insideRoot(realParent)) throw new Error('Parent symlink escapes the sandboxed workspace root.');
        break;
      } catch (parentError) {
        if (parentError.code !== 'ENOENT') throw parentError;
        const next = path.dirname(parent);
        if (next === parent) throw new Error('Could not resolve a safe parent directory.');
        parent = next;
      }
    }
    return candidate;
  }
}

function textResult(text, extra = {}) {
  return { content: [{ type: 'text', text: String(text) }], ...extra };
}

async function listFiles(relativePath = '.', recursive = false) {
  const dir = await safePath(relativePath, { mustExist: true });
  const stat = await fs.stat(dir);
  if (!stat.isDirectory()) throw new Error('list_files requires a directory.');
  const output = [];
  async function walk(abs, rel) {
    const entries = await fs.readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const childAbs = path.join(abs, entry.name);
      const childRel = path.posix.join(rel === '.' ? '' : rel.split(path.sep).join('/'), entry.name);
      // Do not follow symlink directories; report them as links only.
      const childStat = await fs.lstat(childAbs);
      output.push({ path: childRel, type: childStat.isSymbolicLink() ? 'symlink' : childStat.isDirectory() ? 'directory' : 'file', size: childStat.isFile() ? childStat.size : undefined });
      if (recursive && childStat.isDirectory() && !childStat.isSymbolicLink()) await walk(childAbs, childRel);
    }
  }
  await walk(dir, relativePath === '.' ? '.' : relativePath);
  return output;
}

async function readFile(relativePath) {
  const abs = await safePath(relativePath, { mustExist: true });
  const stat = await fs.stat(abs);
  if (!stat.isFile()) throw new Error('read_file requires a file.');
  if (stat.size > maxFileBytes) throw new Error(`File exceeds MAX_FILE_BYTES (${maxFileBytes}).`);
  return await fs.readFile(abs, 'utf8');
}

async function writeFile(relativePath, content) {
  if (typeof content !== 'string') throw new Error('content must be a string.');
  if (Buffer.byteLength(content, 'utf8') > maxFileBytes) throw new Error(`Content exceeds MAX_FILE_BYTES (${maxFileBytes}).`);
  const abs = await safePath(relativePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  // Revalidate after creating parents, before writing.
  const verified = await safePath(relativePath);
  await fs.writeFile(verified, content, { encoding: 'utf8', flag: 'w' });
  return `Wrote ${Buffer.byteLength(content, 'utf8')} bytes to ${path.relative(workspaceRoot, verified).split(path.sep).join('/')}.`;
}

async function strReplace(relativePath, oldText, newText, replaceAll = false) {
  if (!oldText) throw new Error('old_text must not be empty.');
  const abs = await safePath(relativePath, { mustExist: true });
  const current = await readFile(relativePath);
  const count = current.split(oldText).length - 1;
  if (!count) throw new Error('old_text was not found; file was not changed.');
  if (!replaceAll && count > 1) throw new Error(`old_text appears ${count} times. Set replace_all=true or provide a more specific match.`);
  const updated = replaceAll ? current.split(oldText).join(newText) : current.replace(oldText, newText);
  if (Buffer.byteLength(updated, 'utf8') > maxFileBytes) throw new Error(`Updated file exceeds MAX_FILE_BYTES (${maxFileBytes}).`);
  await fs.writeFile(abs, updated, 'utf8');
  return `Replaced ${replaceAll ? count : 1} occurrence(s) in ${relativePath}.`;
}

async function deleteFile(relativePath) {
  const abs = await safePath(relativePath, { mustExist: true });
  const stat = await fs.lstat(abs);
  if (stat.isDirectory()) throw new Error('delete_file only deletes files, not directories.');
  await fs.unlink(abs);
  return `Deleted ${relativePath}.`;
}

async function searchFiles(query, relativePath = '.', caseSensitive = false) {
  if (!query) throw new Error('query must not be empty.');
  const files = await listFiles(relativePath, true);
  const matches = [];
  const needle = caseSensitive ? query : query.toLowerCase();
  for (const entry of files) {
    if (entry.type !== 'file' || matches.length >= 100) continue;
    if (entry.size > maxFileBytes) continue;
    const content = await readFile(entry.path);
    const lines = content.split(/\r?\n/);
    lines.forEach((line, i) => {
      const haystack = caseSensitive ? line : line.toLowerCase();
      if (haystack.includes(needle)) matches.push({ path: entry.path, line: i + 1, text: line.slice(0, 500) });
    });
  }
  return matches;
}

async function gitLite(args) {
  // Git-lite commands are read-only and run only inside the workspace.
  const allowed = new Set(['status', 'diff', 'log', 'branch']);
  if (!allowed.has(args.command)) throw new Error('git_lite supports only status, diff, log, and branch (read-only).');
  const dir = await safePath(args.path || '.', { mustExist: true });
  const argv = args.command === 'status' ? ['status', '--short', '--branch']
    : args.command === 'diff' ? ['diff', '--', '.']
    : args.command === 'log' ? ['log', '-5', '--oneline', '--decorate']
    : ['branch', '--show-current'];
  try {
    const { stdout, stderr } = await execFileAsync('git', argv, { cwd: dir, timeout: 5000, maxBuffer: 256 * 1024 });
    return (stdout || stderr || '(no output)').slice(0, 20_000);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Git is not installed on this host.');
    throw new Error(`git_lite failed: ${(error.stderr || error.message).slice(0, 1000)}`);
  }
}

function createMcpServer() {
  const server = new Server({ name: 'sandboxed-mcp-file-server', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      { name: 'list_files', description: 'List files and directories inside the sandbox. Symlink directories are not followed.', inputSchema: { type: 'object', properties: { path: { type: 'string', default: '.' }, recursive: { type: 'boolean', default: false } } } },
      { name: 'read_file', description: 'Read a UTF-8 text file in the sandbox.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      { name: 'write_file', description: 'Create or overwrite a UTF-8 text file in the sandbox.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
      { name: 'str_replace', description: 'Replace exact text in a file. By default, ambiguous multiple matches are rejected.', inputSchema: { type: 'object', properties: { path: { type: 'string' }, old_text: { type: 'string' }, new_text: { type: 'string' }, replace_all: { type: 'boolean', default: false } }, required: ['path', 'old_text', 'new_text'] } },
      { name: 'delete_file', description: 'Delete one file or symlink inside the sandbox; directories cannot be deleted.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
      { name: 'search_files', description: 'Search text in workspace files and return matching lines (up to 100).', inputSchema: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string', default: '.' }, case_sensitive: { type: 'boolean', default: false } }, required: ['query'] } },
      { name: 'git_lite', description: 'Read-only git status, diff, log, or current branch inside the sandbox.', inputSchema: { type: 'object', properties: { command: { type: 'string', enum: ['status', 'diff', 'log', 'branch'] }, path: { type: 'string', default: '.' } }, required: ['command'] } },
      { name: 'repo_map', description: 'Return a compact file tree for the workspace.', inputSchema: { type: 'object', properties: { path: { type: 'string', default: '.' } } } },
      { name: 'checkpoint', description: 'Write a durable handoff checkpoint to CHECKPOINTS.md in the workspace.', inputSchema: { type: 'object', properties: { summary: { type: 'string' }, next_steps: { type: 'string' }, decisions: { type: 'string', default: '' } }, required: ['summary', 'next_steps'] } },
      { name: 'get_project_state', description: 'Read the durable project handoff state files if present.', inputSchema: { type: 'object', properties: {} } }
    ]
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const a = request.params.arguments || {};
    try {
      let result;
      switch (request.params.name) {
        case 'list_files': result = JSON.stringify(await listFiles(a.path || '.', Boolean(a.recursive)), null, 2); break;
        case 'read_file': result = await readFile(a.path); break;
        case 'write_file': result = await writeFile(a.path, a.content); break;
        case 'str_replace': result = await strReplace(a.path, a.old_text, a.new_text, Boolean(a.replace_all)); break;
        case 'delete_file': result = await deleteFile(a.path); break;
        case 'search_files': result = JSON.stringify(await searchFiles(a.query, a.path || '.', Boolean(a.case_sensitive)), null, 2); break;
        case 'git_lite': result = await gitLite(a); break;
        case 'repo_map': result = JSON.stringify((await listFiles(a.path || '.', true)).map(x => `${x.type === 'directory' ? '📁' : x.type === 'symlink' ? '🔗' : '📄'} ${x.path}`), null, 2); break;
        case 'checkpoint': {
          const stamp = new Date().toISOString();
          const entry = `\n## Checkpoint — ${stamp}\n\n### Summary\n${a.summary}\n\n### Next steps\n${a.next_steps}\n\n### Decisions\n${a.decisions || 'None recorded.'}\n`;
          const p = await safePath('CHECKPOINTS.md');
          const old = await fs.readFile(p, 'utf8').catch(() => '# Checkpoints\n');
          result = await writeFile('CHECKPOINTS.md', old + entry);
          break;
        }
        case 'get_project_state': {
          const names = ['PROJECT_STATE.md', 'PLAN_LOG.md', 'CHECKPOINTS.md', 'DECISIONS.md'];
          const state = {};
          for (const name of names) state[name] = await fs.readFile(await safePath(name), 'utf8').catch(() => '(not created yet)');
          result = Object.entries(state).map(([k, v]) => `===== ${k} =====\n${v}`).join('\n\n');
          break;
        }
        default: throw new Error(`Unknown tool: ${request.params.name}`);
      }
      return textResult(result);
    } catch (error) {
      return { ...textResult(`Error: ${error.message}`), isError: true };
    }
  });
  return server;
}

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use((req, res, next) => {
  if (req.path !== '/health' && authToken) {
    const provided = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
    const a = Buffer.from(provided); const b = Buffer.from(authToken);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'sandboxed-mcp-file-server', version: '1.0.0' }));
app.post('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  try {
    let transport;
    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId);
    } else if (!sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: id => transports.set(id, transport),
        onsessionclosed: id => transports.delete(id)
      });
      const server = createMcpServer();
      await server.connect(transport);
      transport.onclose = () => { const id = transport.sessionId; if (id) transports.delete(id); };
      await transport.handleRequest(req, res, req.body);
      return;
    } else {
      return res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: missing or invalid MCP session. Initialize first.' }, id: null });
    }
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('MCP request failed:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});
app.get('/mcp', async (req, res) => {
  const id = req.headers['mcp-session-id'];
  const transport = transports.get(id);
  if (!transport) return res.status(400).send('Unknown MCP session');
  await transport.handleRequest(req, res);
});
app.delete('/mcp', async (req, res) => {
  const id = req.headers['mcp-session-id'];
  const transport = transports.get(id);
  if (!transport) return res.status(400).send('Unknown MCP session');
  await transport.handleRequest(req, res);
});

app.listen(port, host, () => {
  console.log(`MCP file-server listening at http://${host}:${port}/mcp`);
  console.log(`Sandbox root: ${workspaceRoot}`);
  console.log(`Bearer auth: ${authToken ? 'enabled' : 'DISABLED (set MCP_AUTH_TOKEN for production)'}`);
});
