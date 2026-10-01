# Readback

Read Claude Code and Codex answers in your browser or [Glow](https://github.com/charmbracelet/glow), directly from local session transcripts. No model calls, API keys, or extra tokens are needed to open an answer.

![Readback browser view with readable headings, lists, and a blockquote](docs/images/readback-preview.png)

## Setup

Requires macOS and Node.js 22 or later. Glow is optional for the terminal viewer.

```sh
git clone https://github.com/esenilsson/readback.git
cd readback
npm ci
npm run install-cli
brew install glow  # Only needed for the Glow viewer
```

The installer creates `readback`, `read-later-browser`, and `read-later-glow` in `~/.local/bin`. Ensure that directory is on your shell's `PATH`. Set `READBACK_BIN_DIR` to install elsewhere. Rerunning the installer updates Readback's own launchers; it refuses to overwrite unrelated commands. Keep this checkout and Node installed, and rerun the installer after moving the checkout or changing the Node installation.

## Read the last answer

Inside Codex CLI or Claude Code, type:

```sh
!readback        # Browser
!readback glow   # Glow
```

Readback automatically selects the calling session using `CODEX_THREAD_ID` (or `CODEX_SESSION_ID`) for Codex and [`CLAUDE_CODE_SESSION_ID`](https://code.claude.com/docs/en/env-vars) for Claude Code. No session ID or tool flag is needed when the agent supplies its session environment. Explicit selectors below override detection. Older agent versions without these variables fall back to matching the current directory; ambiguous matches require a selector. If both agents' variables are inherited, specify `--tool codex` or `--tool claude`.

Readback itself makes no model calls. Claude Code can automatically respond after a `!` command; set `"respondToBashCommands": false` in `~/.claude/settings.json` to disable that extra model turn ([Claude shell-mode docs](https://code.claude.com/docs/en/interactive-mode#shell-mode-with-prefix)). Command output still enters the conversation context. For no additional agent context or model usage, run Readback in a separate terminal.

Glow uses a pager in an interactive terminal (`q` to exit). Inside an agent's captured shell, it prints the rendered Markdown without a pager. Use the browser option for a separate reading window.

The original commands also work in a normal terminal shell, from the directory where you started the agent:

```sh
read-later-browser
read-later-glow
```

Without an agent session environment, both select the last completed answer from the session matching that directory. `readback` defaults to the browser; `readback browser` is also supported.

If multiple sessions match, Readback lists the choices instead of guessing. You can also list all sessions or explicitly choose the latest completed answer across projects:

```sh
readback --list
read-later-browser --session <session-id>
read-later-glow --session <session-id>
read-later-browser --latest --tool codex
read-later-glow --latest --tool claude
```

Session IDs accept unique prefixes. `--tool` restricts discovery to `claude` or `codex`. `--latest` selects by the completed answer's timestamp, not by the transcript file's modification time. Use `--cwd /path/to/project` to match another directory, or `--transcript /path/to/session.jsonl` to read a known transcript directly. Outside the agent, a moved or renamed project may require `--session` because the transcript still records the original directory.

### Files and generated previews

```sh
read-later-browser answer.md
read-later-glow answer.md
readback --session <session-id> --no-open
readback - < answer.md
```

Use `readback -- glow` to open a file literally named `glow`.

`--no-open` saves the output without launching a viewer. Each invocation writes `answer.md` and `answer.html` in a private `readback-*` directory under the system temporary directory. The output path is printed; previews remain until those temporary files are removed. There is no background server or automatic cleanup. For use without installation, replace `readback` with `node src/cli.js`; choose Glow with `--viewer glow`.

The browser view includes local CSS, highlighted code, light/dark mode, and scrollable tables and code blocks. Embedded HTML displays as text and scripts are prohibited. Images become clickable references, so opening a browser preview makes no network requests. Relative file links resolve from the temporary preview directory. Glow handles Markdown display using its own settings.

## Supported transcripts

- **Codex:** `~/.codex/sessions/**/*.jsonl`, or `$CODEX_HOME/sessions`. Reads completed turn messages and final-answer records; ignores commentary, reasoning, tools, and subagent sessions.
- **Claude Code:** `~/.claude/projects/**/*.jsonl`, or `$CLAUDE_CONFIG_DIR/projects`. Follows the active parent chain and reads completed assistant text; excludes thinking, tool calls, and sidechain/subagent transcripts.

Readback preserves the stored text instead of asking a model to repeat it. Distinct text blocks are separated by blank lines. It ignores a partially written trailing JSON record, reports malformed complete records, and reports when no completed answer exists. While an agent is still working, it shows the previous completed answer. Session files stay on your machine. Local transcript formats can change; an unsupported format needs a parser update. Sessions that are not saved locally cannot be read this way.

## Optional agent skills

The older `/read-last` (Claude Code) and `$read-last` (Codex) skills remain available as a convenience. **Invoking a skill still uses a model turn and tokens.** They now invoke the transcript reader instead of copying the answer through the model. Use the terminal commands above for zero extra tokens.

```sh
npm run install-skills              # First install
npm run install-skills -- --update  # Update Readback skills from this checkout
```

Skills are installed in `~/.codex/skills` (or `$CODEX_HOME/skills`) and `~/.claude/skills`. Start a new agent session if an updated skill does not appear.

## Verification

```sh
npm test
```

Tests cover transcript parsing, session selection, branching and interrupted turns, command installation, both viewer dispatch paths, Markdown rendering, and errors. All test transcripts are synthetic; real conversation logs are never included in the repository.
