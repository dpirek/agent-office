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
