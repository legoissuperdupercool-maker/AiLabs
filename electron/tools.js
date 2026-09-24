// Tools agents can use on the user's computer.
// risk: 'read'  -> always allowed
//       'write' -> needs approval in "ask" mode unless the path is inside the workspace
//       'exec'  -> needs approval in "ask" mode
//       'office'-> talks to other agents / the task board, always allowed
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { shell, clipboard, Notification } = require('electron');

const MAX_OUTPUT = 12000;
const IS_WIN = process.platform === 'win32';

const clip = (s, n = MAX_OUTPUT) => {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s;
};

function expandHome(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(1));
  return p.replace(/%USERPROFILE%/gi, os.homedir());
}

function resolvePath(ctx, p) {
  p = expandHome(String(p || '.'));
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(ctx.workspace, p);
}

function insideWorkspace(ctx, p) {
  const rel = path.relative(ctx.workspace, p);
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

const DEFINITIONS = [
  {
    name: 'run_command',
    risk: 'exec',
    description: `Run a shell command on the user's computer (${IS_WIN ? 'PowerShell on Windows' : 'bash'}) and return stdout/stderr. Use for installing packages, running scripts, git, builds, file management, etc. Runs in the workspace folder unless cwd is given.`,
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The command line to execute.' },
        cwd: { type: 'string', description: 'Working directory (optional).' },
        timeout_sec: { type: 'number', description: 'Timeout in seconds (default 120, max 900).' },
      },
      required: ['command'],
    },
    summarize: (a) => a.command,
  },
  {
    name: 'read_file',
    risk: 'read',
    description: 'Read a text file. Relative paths are resolved against the workspace folder. Returns numbered lines.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'number', description: 'First line to read (1-based, optional).' },
        limit: { type: 'number', description: 'Max lines to read (default 400).' },
      },
      required: ['path'],
    },
    summarize: (a) => a.path,
  },
  {
    name: 'write_file',
    risk: 'write',
    description: 'Create or overwrite a text file (parent folders are created). Set append=true to append instead.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
        append: { type: 'boolean' },
      },
      required: ['path', 'content'],
    },
    summarize: (a) => `${a.append ? 'append → ' : ''}${a.path} (${String(a.content || '').length} chars)`,
  },
  {
    name: 'edit_file',
    risk: 'write',
    description: 'Replace an exact snippet of text in a file. old_text must appear exactly once.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string' },
        new_text: { type: 'string' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
    summarize: (a) => a.path,
  },
  {
    name: 'list_directory',
    risk: 'read',
    description: 'List files and folders in a directory with sizes.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: [] },
    summarize: (a) => a.path || '.',
  },
  {
    name: 'search_files',
    risk: 'read',
    description: 'Recursively search a folder for files whose name contains `name`, and/or whose contents contain `text`.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Folder to search (default: workspace).' },
        name: { type: 'string', description: 'Case-insensitive filename substring.' },
        text: { type: 'string', description: 'Case-insensitive text to find inside files.' },
      },
      required: [],
    },
    summarize: (a) => `${a.name || ''} ${a.text ? `"${a.text}"` : ''} in ${a.path || '.'}`,
  },
  {
    name: 'fetch_url',
    risk: 'read',
    description: 'HTTP GET a web page or API and return its text (HTML tags stripped).',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    summarize: (a) => a.url,
  },
  {
    name: 'open_on_computer',
    risk: 'exec',
    description: 'Open a URL in the default browser, or a file/folder/app with its default program.',
    parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
    summarize: (a) => a.target,
  },
  {
    name: 'system_info',
    risk: 'read',
    description: 'Get OS, user, home folder, workspace path, CPU and memory info.',
    parameters: { type: 'object', properties: {}, required: [] },
    summarize: () => '',
  },
  {
    name: 'clipboard',
    risk: 'write',
    description: 'Read or write the system clipboard text.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['read', 'write'] }, text: { type: 'string' } },
      required: ['action'],
    },
    summarize: (a) => a.action,
  },
  {
    name: 'notify_user',
    risk: 'office',
    description: 'Show a desktop notification to the user.',
    parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    summarize: (a) => a.message,
  },
  {
    name: 'delegate_task',
    risk: 'office',
    description: 'Create a task on the office task board and assign it to a coworker (by name). Use it to hand off work to other departments.',
    parameters: {
      type: 'object',
      properties: {
        coworker: { type: 'string', description: 'Coworker name, exactly as listed in the team roster.' },
        title: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['coworker', 'title', 'description'],
    },
    summarize: (a) => `${a.coworker}: ${a.title}`,
  },
];

const BY_NAME = Object.fromEntries(DEFINITIONS.map((d) => [d.name, d]));

// Decide whether a call needs the user's approval for an agent's permission mode.
function needsApproval(mode, def, args, ctx) {
  if (mode === 'auto') return false;
  if (def.risk === 'read' || def.risk === 'office') return false;
  if (mode === 'readonly') return 'blocked';
  if (def.risk === 'write' && args?.path && insideWorkspace(ctx, resolvePath(ctx, args.path))) return false;
  if (def.name === 'clipboard' && args?.action === 'read') return false;
  return true;
}

function toolsForMode(mode) {
  return DEFINITIONS.filter((d) => mode !== 'readonly' || d.risk === 'read' || d.risk === 'office');
}

// ---------- implementations ----------

function runCommand(ctx, { command, cwd, timeout_sec }, signal) {
  return new Promise((resolve) => {
    const dir = cwd ? resolvePath(ctx, cwd) : ctx.workspace;
    const timeout = Math.min(Math.max(Number(timeout_sec) || 120, 1), 900) * 1000;
    const child = IS_WIN
      ? spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`], { cwd: dir, windowsHide: true })
      : spawn('/bin/bash', ['-lc', command], { cwd: dir });
    let out = '';
    const onData = (d) => { out += d.toString(); if (out.length > MAX_OUTPUT * 4) out = out.slice(-MAX_OUTPUT * 2); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const kill = () => { try { IS_WIN ? spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']) : child.kill('SIGKILL'); } catch {} };
    const timer = setTimeout(() => { out += `\n[timed out after ${timeout / 1000}s]`; kill(); }, timeout);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, output: `Failed to start: ${e.message}` }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: clip(`exit code ${code}\n${out.trim() || '(no output)'}`) });
    });
  });
}

async function readFile(ctx, { path: p, offset, limit }) {
  const file = resolvePath(ctx, p);
  const stat = await fsp.stat(file);
  if (stat.isDirectory()) return listDirectory(ctx, { path: p });
  if (stat.size > 20 * 1024 * 1024) throw new Error('File is larger than 20 MB.');
  const lines = (await fsp.readFile(file, 'utf8')).split(/\r?\n/);
  const start = Math.max(1, Number(offset) || 1);
  const count = Math.min(Number(limit) || 400, 2000);
  const slice = lines.slice(start - 1, start - 1 + count).map((l, i) => `${String(start + i).padStart(5)}  ${l}`);
  const more = start - 1 + count < lines.length ? `\n…(${lines.length} lines total; use offset to read more)` : '';
  return clip(`${file}\n${slice.join('\n')}${more}`);
}

async function writeFile(ctx, { path: p, content, append }) {
  const file = resolvePath(ctx, p);
  await fsp.mkdir(path.dirname(file), { recursive: true });
  if (append) await fsp.appendFile(file, content ?? '');
  else await fsp.writeFile(file, content ?? '');
  return `${append ? 'Appended to' : 'Wrote'} ${file} (${String(content ?? '').length} chars)`;
}

async function editFile(ctx, { path: p, old_text, new_text }) {
  const file = resolvePath(ctx, p);
  const text = await fsp.readFile(file, 'utf8');
  const count = text.split(old_text).length - 1;
  if (count === 0) throw new Error('old_text not found in file.');
  if (count > 1) throw new Error(`old_text appears ${count} times; include more context so it is unique.`);
  await fsp.writeFile(file, text.replace(old_text, () => new_text));
  return `Edited ${file}`;
}

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

async function listDirectory(ctx, { path: p }) {
  const dir = resolvePath(ctx, p || '.');
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const rows = await Promise.all(entries.slice(0, 500).map(async (e) => {
    if (e.isDirectory()) return `[dir]  ${e.name}/`;
    try { return `       ${e.name}  (${fmtSize((await fsp.stat(path.join(dir, e.name))).size)})`; } catch { return `       ${e.name}`; }
  }));
  rows.sort((a, b) => (a.startsWith('[dir]') === b.startsWith('[dir]') ? a.localeCompare(b) : a.startsWith('[dir]') ? -1 : 1));
  return clip(`${dir}\n${rows.join('\n') || '(empty)'}${entries.length > 500 ? `\n…${entries.length - 500} more` : ''}`);
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'AppData', '$Recycle.Bin', 'Windows', 'Program Files', 'Program Files (x86)', '__pycache__', '.venv']);

async function searchFiles(ctx, { path: p, name, text }, signal) {
  const root = resolvePath(ctx, p || '.');
  const nameQ = (name || '').toLowerCase();
  const textQ = (text || '').toLowerCase();
  const hits = [];
  let scanned = 0;
  const stack = [root];
  while (stack.length && hits.length < 200 && scanned < 20000 && !signal?.aborted) {
    const dir = stack.pop();
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(full); continue; }
      scanned++;
      if (nameQ && !e.name.toLowerCase().includes(nameQ)) continue;
      if (textQ) {
        try {
          const st = await fsp.stat(full);
          if (st.size > 2 * 1024 * 1024) continue;
          const lines = (await fsp.readFile(full, 'utf8')).split(/\r?\n/);
          const idx = lines.findIndex((l) => l.toLowerCase().includes(textQ));
          if (idx >= 0) hits.push(`${full}:${idx + 1}: ${lines[idx].trim().slice(0, 160)}`);
        } catch {}
      } else hits.push(full);
      if (hits.length >= 200) break;
    }
  }
  return clip(hits.length ? hits.join('\n') : `No matches (scanned ${scanned} files under ${root}).`);
}

async function fetchUrl(_ctx, { url }, signal) {
  if (!/^https?:\/\//i.test(url)) throw new Error('Only http(s) URLs are supported.');
  const res = await fetch(url, { signal, headers: { 'User-Agent': 'Mozilla/5.0 AI-Labs-Office' } });
  let body = await res.text();
  if (/html/i.test(res.headers.get('content-type') || '')) {
    body = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
  }
  return clip(`HTTP ${res.status}\n${body.trim()}`);
}

async function openOnComputer(ctx, { target }) {
  if (/^(https?|mailto):/i.test(target)) { await shell.openExternal(target); return `Opened ${target}`; }
  const err = await shell.openPath(resolvePath(ctx, target));
  if (err) throw new Error(err);
  return `Opened ${resolvePath(ctx, target)}`;
}

function systemInfo(ctx) {
  return JSON.stringify({
    platform: `${os.type()} ${os.release()} (${process.platform} ${os.arch()})`,
    user: os.userInfo().username,
    home: os.homedir(),
    workspace: ctx.workspace,
    desktop: path.join(os.homedir(), 'Desktop'),
    cpus: `${os.cpus().length}x ${os.cpus()[0]?.model || ''}`.trim(),
    memory: `${fmtSize(os.freemem())} free of ${fmtSize(os.totalmem())}`,
    shell: IS_WIN ? 'PowerShell' : 'bash',
    time: new Date().toString(),
  }, null, 2);
}

async function execute(name, args, ctx, signal) {
  args = args || {};
  if (args._invalid_json) return { ok: false, output: 'Arguments were not valid JSON. Retry the call with valid JSON arguments.' };
  try {
    switch (name) {
      case 'run_command': return await runCommand(ctx, args, signal);
      case 'read_file': return { ok: true, output: await readFile(ctx, args) };
      case 'write_file': return { ok: true, output: await writeFile(ctx, args) };
      case 'edit_file': return { ok: true, output: await editFile(ctx, args) };
      case 'list_directory': return { ok: true, output: await listDirectory(ctx, args) };
      case 'search_files': return { ok: true, output: await searchFiles(ctx, args, signal) };
      case 'fetch_url': return { ok: true, output: await fetchUrl(ctx, args, signal) };
      case 'open_on_computer': return { ok: true, output: await openOnComputer(ctx, args) };
      case 'system_info': return { ok: true, output: systemInfo(ctx) };
      case 'clipboard':
        if (args.action === 'write') { clipboard.writeText(String(args.text ?? '')); return { ok: true, output: 'Copied to clipboard.' }; }
        return { ok: true, output: clip(clipboard.readText() || '(clipboard is empty)') };
      case 'notify_user':
        if (Notification.isSupported()) new Notification({ title: ctx.agentName, body: String(args.message).slice(0, 250) }).show();
        return { ok: true, output: 'Notification shown.' };
      case 'delegate_task': return { ok: true, output: ctx.delegate(args) };
      default: return { ok: false, output: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, output: `Error: ${e.message}` };
  }
}

module.exports = { DEFINITIONS, BY_NAME, toolsForMode, needsApproval, execute };
