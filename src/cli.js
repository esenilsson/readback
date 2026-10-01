#!/usr/bin/env node
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderMarkdown } from './reader.js';
import { discoverSessions, describeSessions, readTranscript, selectSession, sessionOptions } from './sessions.js';

const help = `Usage: readback [browser|glow] [options] [answer.md | -]
       read-later-browser [options]
       read-later-glow [options]

Read the last completed answer directly from local Claude or Codex transcripts.
With no selector, detect the calling agent session, then fall back to the current project.

--list              List local sessions without showing their answer text.
--session <id>      Select an exact session ID or unique prefix.
--tool <name>       Restrict to claude or codex.
--latest            Explicitly choose the latest completed answer across projects.
--cwd <directory>   Match sessions for a different project directory.
--transcript <file> Read a specific JSONL transcript instead of discovering sessions.
--viewer <name>     browser (default) or glow.
--no-open           Save the preview and print its path without opening a viewer.
--                 Treat remaining arguments as filenames.

Run these commands in your shell, outside the agent prompt, for zero model tokens.
`;

export async function createPreview(markdown, { temporaryRoot = tmpdir() } = {}) {
  const html = renderMarkdown(markdown);
  const directory = await mkdtemp(join(temporaryRoot, 'readback-'));
  await writeFile(join(directory, 'answer.md'), markdown, { mode: 0o600 });
  const path = join(directory, 'answer.html');
  await writeFile(path, html, { mode: 0o600 });
  return path;
}

export function openPreview(path, launch = spawnSync) {
  const result = launch('/usr/bin/open', [path], { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim() || `exit status ${result.status}`;
    throw new Error(`Could not open the browser (${reason}). Open this file manually: ${path}`);
  }
}

export function openGlow(path, launch = spawnSync, interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY)) {
  const result = launch('glow', [interactive ? '--pager' : '--pager=false', path], { stdio: 'inherit' });
  if (result.error?.code === 'ENOENT') throw new Error(`Glow is not installed. Run brew install glow. Markdown saved at: ${path}`);
  if (result.error || result.status !== 0) {
    throw new Error(`Could not open Glow (${result.error?.message || result.signal || `exit status ${result.status}`}). Markdown saved at: ${path}`);
  }
}

export async function main(args = process.argv.slice(2)) {
  if (['browser', 'glow'].includes(args[0])) args = ['--viewer', args[0], ...args.slice(1)];
  let noOpen = false;
  let positionalOnly = false;
  const files = [];
  let options = { viewer: 'browser' };
  const values = { '--session': 'session', '--tool': 'tool', '--cwd': 'cwd', '--transcript': 'transcript', '--viewer': 'viewer' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!positionalOnly && (arg === '--help' || arg === '-h')) { console.log(help); return; }
    if (!positionalOnly && arg === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && arg === '--no-open') { noOpen = true; continue; }
    if (!positionalOnly && (arg === '--list' || arg === '--latest')) { options[arg.slice(2)] = true; continue; }
    if (!positionalOnly && values[arg]) {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
      options[values[arg]] = value;
      continue;
    }
    if (!positionalOnly && arg.startsWith('-') && arg !== '-') throw new Error(`Unknown option: ${arg}\n${help}`);
    files.push(arg);
  }
  if (options.tool && !['claude', 'codex'].includes(options.tool)) throw new Error('--tool must be claude or codex.');
  if (!['browser', 'glow'].includes(options.viewer)) throw new Error('--viewer must be browser or glow.');
  if (files.length > 1) throw new Error(help);
  if ([options.session, options.latest, options.cwd, options.transcript, options.list].filter(Boolean).length > 1) {
    throw new Error('Choose only one of --session, --latest, --cwd, --transcript, or --list.');
  }
  if (files.length && (options.session || options.latest || options.cwd || options.transcript || options.list || options.tool)) {
    throw new Error('Choose either a Markdown file/stdin or a session selector.');
  }
  let markdown;
  if (files[0] === '-') {
    process.stdin.setEncoding('utf8');
    markdown = '';
    for await (const chunk of process.stdin) markdown += chunk;
  } else if (files.length) {
    markdown = await readFile(resolve(files[0]), 'utf8');
  } else {
    options = sessionOptions(options);
    let session;
    if (options.transcript) {
      session = await readTranscript(resolve(options.transcript), options.tool);
      if (!session.lastAnswer) throw new Error(`No completed answer in ${session.tool} session ${session.id}.`);
    } else {
      const sessions = await discoverSessions({ tool: options.tool, warn: message => console.error(`Reader: ${message}`) });
      if (options.list) { console.log(describeSessions(sessions) || 'No local sessions found.'); return; }
      session = selectSession(sessions, options);
    }
    console.error(`Reading ${session.tool} session ${session.id} (${session.lastAnswer.timestamp || 'unknown time'}).`);
    markdown = session.lastAnswer.text;
  }
  const path = await createPreview(markdown);
  const outputPath = options.viewer === 'glow' ? join(path, '../answer.md') : path;
  console.log(outputPath);
  if (!noOpen) {
    if (options.viewer === 'glow') openGlow(outputPath);
    else openPreview(path);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Reader: ${error.message}`); process.exitCode = 1; });
}
