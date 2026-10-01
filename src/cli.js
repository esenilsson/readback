#!/usr/bin/env node
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderMarkdown } from './reader.js';

const help = `Usage: node src/cli.js [--no-open] <answer.md | ->

Render a Markdown file (or stdin with -) and open it in your default browser.
--no-open  Generate the page and print its path without opening a browser.
--         Treat remaining arguments as filenames.
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

export async function main(args = process.argv.slice(2)) {
  let noOpen = false;
  let positionalOnly = false;
  const files = [];
  for (const arg of args) {
    if (!positionalOnly && (arg === '--help' || arg === '-h')) { console.log(help); return; }
    if (!positionalOnly && arg === '--') { positionalOnly = true; continue; }
    if (!positionalOnly && arg === '--no-open') { noOpen = true; continue; }
    if (!positionalOnly && arg.startsWith('-') && arg !== '-') throw new Error(`Unknown option: ${arg}\n${help}`);
    files.push(arg);
  }
  if (files.length !== 1) throw new Error(help);
  let markdown;
  if (files[0] === '-') {
    process.stdin.setEncoding('utf8');
    markdown = '';
    for await (const chunk of process.stdin) markdown += chunk;
  } else {
    markdown = await readFile(resolve(files[0]), 'utf8');
  }
  const path = await createPreview(markdown);
  console.log(path);
  if (!noOpen) openPreview(path);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Reader: ${error.message}`); process.exitCode = 1; });
}
