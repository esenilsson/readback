---
name: read-last
description: Open a completed answer from a local session transcript in the browser when the user explicitly invokes read-last. For zero model tokens, use the Readback shell commands instead.
---

# Read last answer

This skill invocation already uses a model turn. The standalone shell commands `read-later-browser` and `read-later-glow` do not. Use Readback's transcript reader instead of copying or regenerating the answer.

Identify the current session from an explicitly available session ID or transcript path in the runtime context. If it is unavailable, list sessions with the command below plus `--list` and match the current tool and working directory. If multiple sessions match, ask which one to use. Never choose the newest session across projects implicitly.

```sh
__READER_COMMAND__ --session '<current session ID>'
```

Alternatively use `--transcript '<absolute JSONL path>'`. Pass paths and IDs as literal, quoted arguments. If the transcript is unavailable or has no completed answer, report that; do not reconstruct the answer from context.

The reader saves Markdown and HTML in a private temporary directory, prints the HTML path, and opens the default browser. Follow the session's normal execution permissions; if opening the browser requires tool approval, use that approval flow. If launch fails, provide the printed HTML path. Respond briefly with the preview link, without repeating the answer.
