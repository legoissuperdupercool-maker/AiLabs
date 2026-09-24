// A fake OpenAI-compatible server for trying the app without an API key.
//   node scripts/mock-llm.js   → add a "Custom" provider with base URL http://localhost:11999/v1
// Each request: it lists the workspace, then writes a notes file (or runs a command if you
// mention "command"), then reports back.
const http = require('http');

const PORT = Number(process.env.PORT || 11999);
const DELAY = Number(process.env.DELAY || 1200);

function reply(messages) {
  const toolTurns = messages.slice(messages.map((m) => m.role).lastIndexOf('user')).filter((m) => m.role === 'tool').length;
  const ask = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const id = `call_${Date.now()}`;
  if (toolTurns === 0) {
    return { role: 'assistant', content: 'On it — let me look around first.', tool_calls: [{ id, type: 'function', function: { name: 'list_directory', arguments: '{"path":"."}' } }] };
  }
  if (toolTurns === 1 && /command/i.test(ask)) {
    return { role: 'assistant', content: 'Running a quick command.', tool_calls: [{ id, type: 'function', function: { name: 'run_command', arguments: JSON.stringify({ command: 'echo Hello from the office' }) } }] };
  }
  if (toolTurns === 1) {
    return { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'write_file', arguments: JSON.stringify({ path: 'mock-notes.md', content: `# Notes\n\nRequest: ${ask.slice(0, 200)}\n` }) } }] };
  }
  return { role: 'assistant', content: `Done! I saved my notes to **mock-notes.md** in the workspace.\n\n- Listed the workspace\n- Wrote the notes file` };
}

http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'mock-1' }, { id: 'mock-2' }] }));
    const { messages = [] } = JSON.parse(body || '{}');
    setTimeout(() => {
      res.end(JSON.stringify({ choices: [{ message: reply(messages) }], usage: { prompt_tokens: 420, completion_tokens: 42 } }));
    }, DELAY);
  });
}).listen(PORT, () => console.log(`mock LLM on http://localhost:${PORT}/v1`));
