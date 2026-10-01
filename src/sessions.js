import { readFile, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

export function parseJSONL(source, path = 'transcript') {
  const lines = source.split('\n');
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { records.push(JSON.parse(lines[i])); }
    catch {
      // A running agent may still be writing its final line.
      if (i === lines.length - 1 && !source.endsWith('\n')) break;
      throw new Error(`Invalid JSON in ${path}, line ${i + 1}.`);
    }
  }
  return records;
}

const contentText = (content, type) => Array.isArray(content)
  ? content.filter(block => block?.type === type && typeof block.text === 'string').map(block => block.text).join('\n\n')
  : '';

export function parseCodex(records) {
  const meta = records.find(r => r.type === 'session_meta')?.payload;
  if (!meta) return null;
  if (meta.source === 'subagent' || meta.source?.subagent || meta.thread_source?.subagent) return null;
  let cwd = meta.cwd;
  let lastAnswer = null;
  let candidate = null;
  let hasLifecycle = false;
  for (const row of records) {
    const p = row.payload || {};
    if (row.type === 'turn_context' && p.cwd) cwd = p.cwd;
    if (row.type === 'event_msg' && p.type === 'task_started') {
      hasLifecycle = true;
      candidate = null;
    }
    if (row.type === 'response_item' && p.type === 'message' && p.role === 'assistant' && p.phase === 'final_answer') {
      const text = contentText(p.content, 'output_text');
      if (text.trim()) {
        candidate = { text, timestamp: row.timestamp };
        if (!hasLifecycle) lastAnswer = candidate;
      }
    }
    if (row.type === 'event_msg' && p.type === 'task_complete') {
      const text = typeof p.last_agent_message === 'string' && p.last_agent_message.trim()
        ? p.last_agent_message : candidate?.text;
      if (text?.trim()) lastAnswer = { text, timestamp: row.timestamp || candidate?.timestamp };
      candidate = null;
    }
    if (row.type === 'event_msg' && p.type === 'turn_aborted') candidate = null;
  }
  return { tool: 'codex', id: meta.id || meta.session_id, cwd, lastAnswer };
}

export function parseClaude(records) {
  const main = records.filter(r => !r.isSidechain);
  const meta = main.find(r => r.sessionId && r.cwd);
  if (!meta) return null;
  // Follow the active leaf's parent chain, excluding abandoned conversation branches.
  const nodes = main.filter(r => r.uuid && Object.hasOwn(r, 'parentUuid'));
  const byId = new Map(nodes.map(r => [r.uuid, r]));
  const chain = [];
  const seen = new Set();
  let node = nodes.at(-1);
  while (node && !seen.has(node.uuid)) {
    chain.push(node);
    seen.add(node.uuid);
    node = byId.get(node.parentUuid);
  }
  chain.reverse();
  let lastAnswer = null;
  let group = null;
  const finish = timestamp => {
    if (!group || group.toolUse) return;
    const text = [...group.blocks.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).filter(Boolean).join('\n\n');
    if (text.trim()) lastAnswer = { text, timestamp: timestamp || group.timestamp };
  };
  for (const row of chain) {
    const message = row.message;
    if (row.type === 'assistant' && message?.role === 'assistant') {
      const id = message.id || row.uuid;
      if (!group || group.id !== id) group = { id, blocks: new Map(), toolUse: false };
      group.blocks.set(row.apiBlockIndex ?? 0, contentText(message.content, 'text'));
      group.timestamp = row.timestamp;
      group.toolUse ||= message.stop_reason === 'tool_use' || message.content?.some?.(c => c.type === 'tool_use');
      if (message.stop_reason === 'end_turn' || message.stop_reason === 'stop_sequence') finish(row.timestamp);
    } else if (row.type === 'system' && row.subtype === 'turn_duration') {
      finish(row.timestamp);
      group = null;
    } else if (row.type === 'user') {
      group = null;
    }
  }
  return { tool: 'claude', id: meta.sessionId, cwd: chain.at(-1)?.cwd || meta.cwd, lastAnswer };
}

export async function readTranscript(path, expectedTool) {
  const records = parseJSONL(await readFile(path, 'utf8'), path);
  const tool = records.some(r => r.type === 'session_meta') ? 'codex' : 'claude';
  if (expectedTool && tool !== expectedTool) throw new Error(`Transcript is ${tool}, not ${expectedTool}: ${path}`);
  const session = tool === 'codex' ? parseCodex(records) : parseClaude(records);
  if (!session?.id) {
    const error = new Error(`Unsupported or subagent transcript: ${path}`);
    if (tool === 'codex' && !session) error.code = 'SKIP_SUBAGENT';
    throw error;
  }
  return { ...session, path: resolve(path) };
}

async function transcriptFiles(root) {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const files = [];
  for (const entry of entries) {
    if (entry.name === 'subagents' || entry.name.startsWith('agent-')) continue;
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await transcriptFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path);
  }
  return files;
}

export async function discoverSessions({ tool, env = process.env, home = homedir(), warn = () => {} } = {}) {
  const roots = {
    codex: join(env.CODEX_HOME || join(home, '.codex'), 'sessions'),
    claude: join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects'),
  };
  const sessions = [];
  for (const [name, root] of Object.entries(roots)) {
    if (tool && tool !== name) continue;
    for (const path of await transcriptFiles(root)) {
      try { sessions.push(await readTranscript(path, name)); }
      catch (error) { if (error.code !== 'SKIP_SUBAGENT') warn(`Skipped ${basename(path)}: ${error.message}`); }
    }
  }
  return sessions.sort((a, b) => (Date.parse(b.lastAnswer?.timestamp) || 0) - (Date.parse(a.lastAnswer?.timestamp) || 0));
}

export function describeSessions(sessions) {
  return sessions.map(s => `${s.tool.padEnd(6)}  ${s.id}  ${s.lastAnswer?.timestamp || 'no completed answer'}  ${s.cwd || '(unknown project)'}`).join('\n');
}

// Explicit selectors always override the calling agent's environment.
export function sessionOptions(options, env = process.env) {
  if (['session', 'latest', 'cwd', 'transcript', 'list'].some(key => options[key])) return options;
  const candidates = [
    { tool: 'codex', session: env.CODEX_THREAD_ID || env.CODEX_SESSION_ID },
    { tool: 'claude', session: env.CLAUDE_CODE_SESSION_ID },
  ].filter(candidate => candidate.session && (!options.tool || candidate.tool === options.tool));
  if (candidates.length > 1) throw new Error('Both Codex and Claude session IDs are present. Choose --tool codex or --tool claude.');
  return candidates.length ? { ...options, ...candidates[0], exactSession: true } : options;
}

export function selectSession(sessions, { session, tool, exactSession = false, latest = false, cwd = process.cwd() } = {}) {
  let matches = sessions.filter(s => !tool || s.tool === tool);
  if (session) {
    const exact = matches.filter(s => s.id === session);
    matches = exact.length || exactSession ? exact : matches.filter(s => s.id.startsWith(session));
  } else if (latest) {
    matches = matches.filter(s => s.lastAnswer).sort((a, b) => (Date.parse(b.lastAnswer.timestamp) || 0) - (Date.parse(a.lastAnswer.timestamp) || 0)).slice(0, 1);
  } else {
    // A session started in a parent directory may belong to an unrelated project.
    matches = matches.filter(s => s.cwd && resolve(s.cwd) === resolve(cwd));
  }
  if (!matches.length) throw new Error('No matching local session. Run readback --list, then readback --session <id>, or explicitly choose --latest.');
  if (matches.length > 1) throw new Error(`Multiple sessions match. Choose one with --session <id>:\n${describeSessions(matches)}`);
  if (!matches[0].lastAnswer) throw new Error(`No completed answer in ${matches[0].tool} session ${matches[0].id}.`);
  return matches[0];
}
