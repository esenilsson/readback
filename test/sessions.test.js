import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseJSONL, parseCodex, parseClaude, discoverSessions, selectSession, sessionOptions } from '../src/sessions.js';
import { openGlow } from '../src/cli.js';

const timestamp = '2026-10-01T08:00:00Z';
const codex = (id = 'codex-123', cwd = '/project', text = '# Exact\n\n`$HOME` café\n') => [
  { type: 'session_meta', payload: { id, cwd, source: 'cli' } },
  { type: 'event_msg', payload: { type: 'task_started' } },
  { type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'commentary', content: [{ type: 'output_text', text: 'Working...' }] } },
  { type: 'response_item', timestamp, payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text }] } },
  { type: 'event_msg', timestamp, payload: { type: 'task_complete', last_agent_message: text } },
];
const claudeRow = (uuid, parentUuid, blocks, stop = 'end_turn', extra = {}) => ({
  type: 'assistant', uuid, parentUuid, sessionId: 'claude-123', cwd: '/project', timestamp,
  message: { id: uuid, role: 'assistant', content: blocks, stop_reason: stop }, ...extra,
});
const textBlock = text => ({ type: 'text', text });

test('Codex extracts only completed final answers, excluding running and aborted turns', () => {
  const rows = codex();
  rows.push({ type: 'event_msg', payload: { type: 'task_started' } });
  rows.push({ type: 'response_item', payload: { type: 'reasoning', summary: [{ text: 'Private' }] } });
  rows.push({ type: 'response_item', payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: 'Not committed yet' }] } });
  assert.equal(parseCodex(rows).lastAnswer.text, '# Exact\n\n`$HOME` café\n');
  rows.push({ type: 'event_msg', payload: { type: 'turn_aborted' } });
  assert.equal(parseCodex(rows).lastAnswer.text, '# Exact\n\n`$HOME` café\n');
  assert.equal(parseCodex(codex().slice(0, 3)).lastAnswer, null);
});

test('Codex supports older task-complete records and excludes subagents', () => {
  const rows = codex().filter(r => r.type !== 'response_item');
  assert.match(parseCodex(rows).lastAnswer.text, /^# Exact/);
  rows[0].payload.source = { subagent: { parent_thread_id: 'parent' } };
  assert.equal(parseCodex(rows), null);
});

test('Claude joins distinct text blocks once and ignores thinking and tool calls', () => {
  const rows = [
    claudeRow('a', null, [{ type: 'thinking', thinking: 'Hidden' }], 'end_turn', { apiBlockIndex: 0 }),
    claudeRow('b', 'a', [textBlock('# One\n')], 'end_turn', { apiBlockIndex: 1 }),
    claudeRow('c', 'b', [textBlock('Two')], 'end_turn', { apiBlockIndex: 2 }),
  ];
  for (const row of rows) row.message.id = 'same-message';
  rows.push(claudeRow('d', 'c', [textBlock('Progress'), { type: 'tool_use', name: 'shell' }], 'tool_use'));
  rows.push(claudeRow('e', 'd', [textBlock('Streaming')], null));
  assert.equal(parseClaude(rows).lastAnswer.text, '# One\n\n\nTwo');
});

test('Claude follows the active branch and does not select abandoned or sidechain answers', () => {
  const rows = [
    claudeRow('root', null, [textBlock('Original')]),
    claudeRow('abandoned', 'root', [textBlock('Wrong branch')]),
    { type: 'user', uuid: 'new-user', parentUuid: 'root', sessionId: 'claude-123', cwd: '/project' },
    claudeRow('side', 'new-user', [textBlock('Subagent')], 'end_turn', { isSidechain: true }),
    claudeRow('active', 'new-user', [textBlock('Unfinished')], null),
  ];
  assert.equal(parseClaude(rows).lastAnswer.text, 'Original');
});

test('Claude supports completed legacy messages and avoids duplicate snapshots', () => {
  const first = claudeRow('a', null, [textBlock('Partial')], null);
  const second = claudeRow('b', 'a', [textBlock('Full answer')], null);
  second.message.id = first.message.id;
  const complete = { type: 'system', subtype: 'turn_duration', uuid: 'c', parentUuid: 'b', timestamp };
  assert.equal(parseClaude([first, second, complete]).lastAnswer.text, 'Full answer');
});

test('JSONL handles an in-progress tail but reports corrupt complete records', () => {
  assert.deepEqual(parseJSONL('{"type":"ok"}\n{"ty'), [{ type: 'ok' }]);
  assert.throws(() => parseJSONL('{broken}\n{}\n'), /line 1/);
});

test('selection requires an explicit choice for multiple sessions and never silently changes projects', () => {
  const a = parseCodex(codex('a', '/project'));
  const b = { ...a, tool: 'claude', id: 'b' };
  const other = { ...a, id: 'c', cwd: '/elsewhere', lastAnswer: { text: 'newer', timestamp: '2026-10-02T08:00:00Z' } };
  assert.equal(selectSession([a, other], { cwd: '/project' }).id, 'a');
  assert.throws(() => selectSession([a], { cwd: '/project/src' }), /No matching/);
  assert.throws(() => selectSession([a, b], { cwd: '/project' }), /Multiple sessions/);
  assert.throws(() => selectSession([a], { cwd: '/project-other' }), /No matching/);
  assert.equal(selectSession([a, b], { cwd: '/project', tool: 'claude' }).id, 'b');
  assert.equal(selectSession([a, other], { latest: true }).id, 'c');
  assert.equal(selectSession([a, other], { session: 'a' }).id, 'a');
  assert.throws(() => selectSession([{ ...a, lastAnswer: null }], { session: 'a' }), /No completed/);
});

test('discovery honors custom homes and excludes nested Claude subagents', async t => {
  const root = await mkdtemp(join(tmpdir(), 'readback-sessions-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexDir = join(root, 'codex/sessions/2026/10/01');
  const claudeDir = join(root, 'claude/projects/project');
  await mkdir(codexDir, { recursive: true });
  await mkdir(join(claudeDir, 'session/subagents'), { recursive: true });
  const jsonl = rows => rows.map(r => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(join(codexDir, 'rollout.jsonl'), jsonl(codex()));
  const claude = jsonl([claudeRow('a', null, [textBlock('Claude answer')])]);
  await writeFile(join(claudeDir, 'session.jsonl'), claude);
  await writeFile(join(claudeDir, 'session/subagents/agent-1.jsonl'), claude);
  const env = { ...process.env, CODEX_THREAD_ID: '', CODEX_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '', CODEX_HOME: join(root, 'codex'), CLAUDE_CONFIG_DIR: join(root, 'claude') };
  const sessions = await discoverSessions({ env });
  assert.equal(sessions.length, 2);
  assert.deepEqual(new Set(sessions.map(s => s.tool)), new Set(['codex', 'claude']));

  // Exercise the real CLI with isolated synthetic transcripts; no model executable is involved.
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (args, agentEnv = {}) => spawnSync(process.execPath, [cli, ...args], { env: { ...env, ...agentEnv }, encoding: 'utf8' });
  const listing = run(['--list']);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /claude-123/);
  assert.doesNotMatch(listing.stdout, /Claude answer/);
  const preview = run(['--session', 'claude-123', '--no-open', '--viewer', 'glow']);
  assert.equal(preview.status, 0, preview.stderr);
  const path = preview.stdout.trim();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));
  assert.equal(await readFile(path, 'utf8'), 'Claude answer');
  assert.equal(run(['--session', 'claude-123', '--latest']).status, 1);
  assert.equal(run(['--viewer', 'unknown']).status, 1);
  for (const [agentEnv, viewer, expected] of [
    [{ CODEX_THREAD_ID: 'codex-123' }, 'browser', /Exact/],
    [{ CODEX_SESSION_ID: 'codex-123' }, 'glow', /Exact/],
    [{ CLAUDE_CODE_SESSION_ID: 'claude-123' }, 'glow', /Claude answer/],
  ]) {
    const result = run([viewer, '--no-open'], agentEnv);
    assert.equal(result.status, 0, result.stderr);
    const path = result.stdout.trim();
    t.after(() => rm(join(path, '..'), { recursive: true, force: true }));
    assert.ok(path.endsWith(viewer === 'browser' ? '.html' : '.md'));
    assert.match(await readFile(path, 'utf8'), expected);
  }
  assert.equal(run(['--no-open'], { CODEX_THREAD_ID: 'codex' }).status, 1);
  assert.equal(run(['--no-open'], { CODEX_THREAD_ID: 'missing' }).status, 1);

});

test('Glow receives a literal local filename, pages only interactively, and has a clear missing dependency error', () => {
  for (const interactive of [true, false]) {
    openGlow('/tmp/a $(not-a-command).md', (command, args, options) => {
      assert.equal(command, 'glow');
      assert.deepEqual(args, [interactive ? '--pager' : '--pager=false', '/tmp/a $(not-a-command).md']);
      assert.equal(options.stdio, 'inherit');
      return { status: 0 };
    }, interactive);
  }
  assert.throws(() => openGlow('/tmp/answer.md', () => ({ error: { code: 'ENOENT' } })), /brew install glow/);
  assert.throws(() => openGlow('/tmp/answer.md', () => ({ status: 1 })), /Could not open Glow/);
});

test('installed shell commands dispatch to both viewers and preserve argument quoting', async t => {
  const root = await mkdtemp(join(tmpdir(), 'readback-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, 'bin with spaces');
  const installer = fileURLToPath(new URL('../scripts/install-cli.js', import.meta.url));
  const env = { ...process.env, READBACK_BIN_DIR: bin };
  const installed = spawnSync(process.execPath, [installer], { env, encoding: 'utf8' });
  assert.equal(installed.status, 0, installed.stderr);
  const source = join(root, 'answer with $ and spaces.md');
  await writeFile(source, '# Shell command\n');
  for (const [name, suffix] of [['readback', '.html'], ['read-later-browser', '.html'], ['read-later-glow', '.md']]) {
    const result = spawnSync(join(bin, name), ['--no-open', source], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const path = result.stdout.trim();
    t.after(() => rm(join(path, '..'), { recursive: true, force: true }));
    assert.ok(path.endsWith(suffix));
    assert.match(await readFile(path, 'utf8'), /Shell command/);
  }
  await writeFile(join(bin, 'readback'), '#!/bin/sh\necho unrelated\n');
  const refused = spawnSync(process.execPath, [installer], { env, encoding: 'utf8' });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to overwrite/);
  assert.match(await readFile(join(bin, 'readback'), 'utf8'), /unrelated/);
});

test('agent detection respects explicit selectors and avoids guessing between nested agents', () => {
  const env = { CODEX_THREAD_ID: 'current', CODEX_SESSION_ID: 'legacy' };
  assert.equal(sessionOptions({}, env).session, 'current');
  assert.equal(sessionOptions({}, { CODEX_SESSION_ID: 'legacy' }).session, 'legacy');
  assert.deepEqual(sessionOptions({}, {}), {});
  for (const options of [{ session: 'chosen' }, { latest: true }, { cwd: '/chosen' }, { transcript: 'file' }, { list: true }]) {
    assert.deepEqual(sessionOptions(options, env), options);
  }
  const nested = { ...env, CLAUDE_CODE_SESSION_ID: 'claude' };
  assert.throws(() => sessionOptions({}, nested), /Both Codex and Claude/);
  assert.equal(sessionOptions({ tool: 'claude' }, nested).session, 'claude');
  assert.equal(sessionOptions({ tool: 'codex' }, nested).session, 'current');
  assert.deepEqual(sessionOptions({ tool: 'claude' }, env), { tool: 'claude' });
});
