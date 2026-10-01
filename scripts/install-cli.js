import { mkdir, readFile, writeFile, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(process.env.READBACK_BIN_DIR || join(homedir(), '.local/bin'));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const marker = '# Installed by Readback: local transcript viewer';
const commands = new Map([
  ['readback', ''],
  ['read-later-browser', ' --viewer browser'],
  ['read-later-glow', ' --viewer glow'],
]);

for (const name of commands.keys()) {
  const path = join(directory, name);
  try {
    const info = await lstat(path);
    if (!info.isFile() || !(await readFile(path, 'utf8')).includes(marker)) {
      throw new Error(`Refusing to overwrite an unrelated command: ${path}`);
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
await mkdir(directory, { recursive: true });
for (const [name, flags] of commands) {
  const path = join(directory, name);
  const script = `#!/bin/sh\n${marker}\nexec ${quote(process.execPath)} ${quote(join(root, 'src/cli.js'))}${flags} "$@"\n`;
  await writeFile(path, script, { mode: 0o755 });
  console.log(`Installed ${path}`);
}
if (!(process.env.PATH || '').split(':').includes(directory)) {
  console.log(`Add this directory to your shell PATH: ${directory}`);
}
