import assert from "node:assert/strict";
import test from "node:test";
import {
  isImageArtifact,
  renderChatArtifacts,
  renderMarkdown,
  safeChatUrl,
} from "../public/lib/markdown.mjs";

test("chat markdown renders common formatting and images", () => {
  const html = renderMarkdown(`# Result

**Ready** for @designer.

- First
- Second

\`inline code\`

\`\`\`js
const ready = true;
\`\`\`

![Homepage preview](/api/shared-workspace-file?path=site%2Fpreview.png)
`);
  assert.match(html, /<h1>Result<\/h1>/);
  assert.match(html, /<strong>Ready<\/strong>/);
  assert.match(html, /<mark>@designer<\/mark>/);
  assert.match(html, /<ul><li>First<\/li><li>Second<\/li><\/ul>/);
  assert.match(html, /<code>inline code<\/code>/);
  assert.match(html, /<pre><code class="language-js">const ready = true;<\/code><\/pre>/);
  assert.match(html, /<img class="markdown-image"[^>]+preview\.png/);
});

test("chat markdown escapes HTML and rejects active URLs", () => {
  const html = renderMarkdown(`<script>alert(1)</script>

[unsafe](javascript:alert(1))

![unsafe](data:image/svg+xml,bad)`);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /href="javascript:/);
  assert.doesNotMatch(html, /src="data:/);
  assert.equal(safeChatUrl("javascript:alert(1)"), null);
});

test("chat markdown renders tables with alignment and inline formatting", () => {
  const html = renderMarkdown(`| Agent | Status | Score |
| :--- | :---: | ---: |
| **Coder** | ready | 12 |
| Planner | [details](/tasks) | 7 |`);
  assert.match(html, /<div class="markdown-table-wrap"><table>/);
  assert.match(html, /<thead><tr><th class="markdown-align-left">Agent<\/th><th class="markdown-align-center">Status<\/th><th class="markdown-align-right">Score<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td class="markdown-align-left"><strong>Coder<\/strong><\/td>/);
  assert.match(html, /<td class="markdown-align-center"><a href="\/tasks"[^>]*>details<\/a><\/td>/);
  assert.match(html, /<td class="markdown-align-right">7<\/td><\/tr><\/tbody>/);
});

test("chat markdown tables support optional outer pipes and literal cell pipes", () => {
  const html = renderMarkdown(`Value | Meaning
--- | ---
\`a|b\` | code pipe
a\\|b | escaped pipe`);
  assert.match(html, /<th>Value<\/th><th>Meaning<\/th>/);
  assert.match(html, /<td><code>a\|b<\/code><\/td><td>code pipe<\/td>/);
  assert.match(html, /<td>a\|b<\/td><td>escaped pipe<\/td>/);
});

test("table-like text without a valid delimiter remains a paragraph", () => {
  const html = renderMarkdown(`Agent | Status
Coder | ready`);
  assert.doesNotMatch(html, /<table>/);
  assert.match(html, /<p>Agent \| Status<br>Coder \| ready<\/p>/);
});

test("image artifacts render as previews while other files remain links", () => {
  const artifacts = [
    { name: "preview.png", mimeType: "image/png", uri: "/api/shared-workspace-file?path=preview.png" },
    { name: "source.zip", mimeType: "application/zip", uri: "https://worker.example/source.zip" },
  ];
  assert.equal(isImageArtifact(artifacts[0]), true);
  assert.equal(isImageArtifact(artifacts[1]), false);
  const html = renderChatArtifacts(artifacts);
  assert.match(html, /<figure class="chat-image-attachment">/);
  assert.match(html, /<img[^>]+preview\.png/);
  assert.match(html, /class="chat-file-attachment"[^>]+source\.zip/);
});

test("chat automatically links web URLs and app paths with trailing punctuation excluded", () => {
  const html = renderMarkdown("Visit https://example.com/report?q=one&view=full. See (https://example.com/wiki/Result_(final)), www.example.com, /tasks and /api/shared-workspace-file?path=notes.md.");
  assert.ok(html.includes('href="https://example.com/report?q=one&amp;view=full"'));
  assert.ok(html.includes('href="https://example.com/wiki/Result_(final)"'));
  assert.ok(html.includes('href="https://www.example.com"'));
  assert.ok(html.includes('href="/tasks"'));
  assert.ok(html.includes('href="/api/shared-workspace-file?path=notes.md"'));
  assert.ok(html.includes('</a>.'));
});

test("chat links angle URLs and mailto links without nesting existing links or code", () => {
  const html = renderMarkdown('<https://example.com> mailto:hello@example.com [Website](https://example.com)\n\n`https://code.example.com`\n\n```\nhttps://code.example.com\n```');
  assert.equal((html.match(/<a /g) || []).length, 3);
  assert.ok(html.includes('href="mailto:hello@example.com"'));
  assert.ok(html.includes('<code>https://code.example.com</code>'));
  assert.ok(html.includes('<pre><code>https://code.example.com</code></pre>'));
  assert.doesNotMatch(html, /<a[^>]*>[^<]*<a/);
});

test("automatic links keep unsafe schemes and HTML inert", () => {
  const html = renderMarkdown('javascript:alert(1) data:text/html,bad <img src=x onerror=alert(1)> https://example.com/?q="onclick="bad');
  assert.doesNotMatch(html, /href="(?:javascript|data):|<img|<script/);
  assert.ok(html.includes('href="https://example.com/?q="'));
});
