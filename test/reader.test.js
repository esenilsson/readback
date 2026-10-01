import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { renderMarkdown } from '../src/reader.js';
import { createPreview, openPreview } from '../src/cli.js';

test('renders Markdown structures, Unicode, links, and known and unknown code languages', () => {
  const html = renderMarkdown('# København 🚲\n\n**Strong** and [link](https://example.com).\n\n- One\n- Two\n\n| Name | Value |\n| --- | --- |\n| Test | 42 |\n\n```js\nconst n = 42;\n```\n\n```unknown-language\n<safe>\n```');
  for (const pattern of [/<h1>København 🚲<\/h1>/, /<strong>Strong<\/strong>/, /href="https:\/\/example.com"/, /<ul>/, /<table>/, /hljs-keyword/, /&lt;safe&gt;/]) {
    assert.match(html, pattern);
  }
});

test('escapes HTML and title injection and rejects active link schemes', () => {
  const html = renderMarkdown('# </title><script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[bad](javascript:alert%281%29)\n\n![image](https://example.com/tracker.png)');
  assert.doesNotMatch(html, /<script|<img|href="javascript:/i);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /href="https:\/\/example.com\/tracker.png"/);
});

test('removes terminal control sequences without losing answer text', () => {
  const html = renderMarkdown('\u001b[32mGreen\u001b[0m\n\n`echo "$HOME"`');
  assert.match(html, /<p>Green<\/p>/);
  assert.match(html, /echo &quot;\$HOME&quot;/);
  assert.doesNotMatch(html, /\u001b/);
});

test('rejects empty input, including only ANSI formatting', () => {
  for (const text of ['', ' \n\t', '\u001b[32m\u001b[0m']) {
    assert.throws(() => renderMarkdown(text), /No Markdown/);
  }
});

test('creates isolated private previews and preserves exact Markdown', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'reader-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const markdown = '# Original\n\n`$(echo nope)` and café\n';
  const first = await createPreview(markdown, { temporaryRoot: directory });
  const second = await createPreview('# Different', { temporaryRoot: directory });
  assert.notEqual(first, second);
  assert.equal(await readFile(join(first, '../answer.md'), 'utf8'), markdown);
  assert.match(await readFile(first, 'utf8'), /<h1>Original<\/h1>/);
  assert.equal((await stat(first)).mode & 0o777, 0o600);
  assert.equal((await stat(join(first, '..'))).mode & 0o777, 0o700);
});

test('browser launch passes filenames literally and reports failures with a usable path', () => {
  const path = '/tmp/an answer $(not-a-command).html';
  openPreview(path, (command, args) => {
    assert.equal(command, '/usr/bin/open');
    assert.deepEqual(args, [path]);
    return { status: 0 };
  });
  for (const result of [{ status: 1, stderr: 'No browser' }, { error: new Error('ENOENT') }]) {
    assert.throws(() => openPreview(path, () => result), error => error.message.includes(path));
  }
});

test('CLI accepts stdin and reports missing files, empty input, and unknown options', async t => {
  const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
  const run = (args, input) => spawnSync(process.execPath, [cli, ...args], { input, encoding: 'utf8' });
  const result = run(['--no-open', '-'], '# From stdin\n\nPreserved.\n');
  assert.equal(result.status, 0, result.stderr);
  const path = result.stdout.trim();
  t.after(() => rm(join(path, '..'), { recursive: true, force: true }));
  assert.match(await readFile(path, 'utf8'), /<h1>From stdin<\/h1>/);
  for (const args of [['--no-open', '/does-not-exist/answer.md'], ['--no-open', '-'], ['--invalid']]) {
    const failed = run(args, '');
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /Reader:/);
    assert.equal(failed.stdout, '');
  }
});
