---
name: read-last
description: Open the previous completed assistant answer as a formatted Markdown page in the local browser when the user requests read-last or asks to read that answer in the reader.
---

# Read last answer

Use the most recent completed assistant answer before this request in the current conversation. Preserve its wording, Markdown, links, tables, and code blocks. Do not summarize, improve, regenerate, or include tool output, progress updates, or this skill's instructions. If the answer is missing or only a summary remains in context, say it is unavailable and ask the user to supply the text; do not reconstruct it.

Pass the answer as UTF-8 Markdown to the installed reader through stdin:

```sh
__READER_COMMAND__ - <<'READER_MARKDOWN_EOF'
<previous answer, without an extra enclosing code fence>
READER_MARKDOWN_EOF
```

The quoted heredoc prevents backticks, dollar signs, and shell commands in the answer from executing. Choose a different delimiter if the answer contains a line matching it. When using a shell tool, send real newlines, not literal escaped `\n` characters. Alternatively write the exact answer to a temporary file with a file-writing tool and pass its quoted absolute path to the same command.

The reader saves Markdown and HTML in a private temporary directory, prints the HTML path, and opens the default browser. Follow the session's normal execution permissions; if opening the browser requires tool approval, use that approval flow. If launch fails, provide the printed HTML path. Respond briefly with the preview link, without repeating the answer.
