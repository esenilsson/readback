import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const command = `${quote(process.execPath)} ${quote(join(root, 'src/cli.js'))}`;
const template = await readFile(join(root, 'skills/read-last/SKILL.md'), 'utf8');
const skill = template.replace('__READER_COMMAND__', command);
const ui = await readFile(join(root, 'skills/read-last/agents/openai.yaml'), 'utf8');
const codexRoot = process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(homedir(), '.codex');
const targets = [
  { directory: join(codexRoot, 'skills/read-last'), skill, ui },
  { directory: join(homedir(), '.claude/skills/read-last'), skill: skill.replace('name: read-last\n', 'name: read-last\ndisable-model-invocation: true\n') },
];
const update = process.argv.slice(2).includes('--update');
if (process.argv.slice(2).some(arg => arg !== '--update')) throw new Error('Only --update is supported.');

// Check both destinations before writing; never overwrite another skill.
for (const { directory } of targets) {
  try {
    await access(directory);
    if (update) {
      const existing = await readFile(join(directory, 'SKILL.md'), 'utf8');
      if (existing.includes(command)) continue;
      throw new Error(`Refusing to update a skill not installed from this checkout: ${directory}`);
    }
    throw new Error(`Skill already exists: ${directory}. Review it before replacing it.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
for (const target of targets) {
  await mkdir(target.directory, { recursive: true });
  await writeFile(join(target.directory, 'SKILL.md'), target.skill, { flag: update ? 'w' : 'wx' });
  if (target.ui) {
    await mkdir(join(target.directory, 'agents'), { recursive: true });
    await writeFile(join(target.directory, 'agents/openai.yaml'), target.ui, { flag: update ? 'w' : 'wx' });
  }
  console.log(`Installed ${target.directory}`);
}
