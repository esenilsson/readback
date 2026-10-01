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

// Check both destinations before writing; never overwrite another skill.
for (const { directory } of targets) {
  try {
    await access(directory);
    throw new Error(`Skill already exists: ${directory}. Review it before replacing it.`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
for (const target of targets) {
  await mkdir(target.directory, { recursive: true });
  await writeFile(join(target.directory, 'SKILL.md'), target.skill, { flag: 'wx' });
  if (target.ui) {
    await mkdir(join(target.directory, 'agents'));
    await writeFile(join(target.directory, 'agents/openai.yaml'), target.ui, { flag: 'wx' });
  }
  console.log(`Installed ${target.directory}`);
}
