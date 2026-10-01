import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import { readFileSync } from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

const css = readFileSync(new URL('./reader.css', import.meta.url), 'utf8');
const md = new MarkdownIt({
  html: false,
  linkify: true,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    }
    return '';
  },
});

// Images remain clickable references, without fetching remote resources on load.
md.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  const text = md.utils.escapeHtml(token.content || 'Image');
  const url = md.utils.escapeHtml(token.attrGet('src') || '');
  return `<a href="${url}" rel="noreferrer">${text}</a>`;
};
md.renderer.rules.table_open = () => '<div class="table-scroll" tabindex="0" role="region" aria-label="Table"><table>\n';
md.renderer.rules.table_close = () => '</table></div>\n';

export function renderMarkdown(source) {
  const markdown = stripVTControlCharacters(source);
  if (!markdown.trim()) throw new Error('No Markdown to read. Provide a non-empty file or pipe an answer to stdin.');
  const tokens = md.parse(markdown, {});
  const heading = tokens.findIndex(token => token.type === 'heading_open');
  const title = heading >= 0 ? tokens[heading + 1].content : 'Last answer';
  const safeTitle = md.utils.escapeHtml(title);
  const words = markdown.trim().split(/\s+/u).length;
  const minutes = Math.max(1, Math.ceil(words / 220));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
  <meta name="referrer" content="no-referrer">
  <title>${safeTitle} · Readback</title>
  <style>${css}</style>
</head>
<body>
  <header class="masthead"><span class="brand">Readback<span class="brand-dot" aria-hidden="true"></span></span><span class="reading-time">${minutes} min read</span></header>
  <main id="answer"><article>${md.renderer.render(tokens, md.options, {})}</article></main>
  <footer><span>End of answer</span><a href="answer.md" download>Save Markdown ↗</a></footer>
</body>
</html>\n`;
}
