# A clearer view of your answer

The reader turns long terminal responses into a page you can comfortably read. **Headings, tables, links, and code** keep their structure, with room to breathe.

## What changed

- Open the last answer when you need it.
- Keep working in Claude Code or Codex.
- Read locally, with no background server.

> A useful reader should make the content easier to follow, without changing what the answer says.

## Compare the options

| Viewer | Shell command | Result |
| --- | --- | --- |
| Browser | `read-later-browser` | Formatted local page |
| Glow | `read-later-glow` | Formatted terminal view |

## An example

```javascript
async function readAnswer(markdown) {
  const preview = await createPreview(markdown);
  return { ready: true, path: preview };
}
```

Inline code such as `npm test` remains easy to distinguish from the explanation. Unicode stays intact: København, café, 日本語, and 🚲.

### A longer line of code

```sql
select campaign_name, customer_segment, count(*) as total_customers, sum(revenue) as total_revenue from campaign_performance where month = '2026-10-01' group by campaign_name, customer_segment;
```

### A wide table

| Campaign | Audience | Market | Channel | New customers | Monthly revenue | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Autumn launch | Small businesses | Copenhagen | Organic search | 240 | 125,000 DKK | Ready to review |

## Next steps

1. Run the reader command after a detailed answer.
2. Use your browser's search and zoom controls as needed.
3. Save the Markdown using the link below.

See [Markdown's original documentation](https://daringfireball.net/projects/markdown/) for examples of the underlying format.
