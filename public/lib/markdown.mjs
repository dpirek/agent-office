function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function safeChatUrl(value, { image = false } = {}) {
  const url = String(value || "").trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (/^(?:\/|\.\/|\.\.\/)/.test(url)) return url;
  if (!image && url.startsWith("#")) return url;
  try {
    const parsed = new URL(url, "https://office.invalid/");
    const allowed = image ? ["http:", "https:"] : ["http:", "https:", "mailto:"];
    return allowed.includes(parsed.protocol) ? url : null;
  } catch {
    return null;
  }
}

function renderInlineMarkdown(value) {
  const tokens = [];
  const hold = (html) => {
    const placeholder = `\uE000${tokens.length}\uE001`;
    tokens.push(html);
    return placeholder;
  };
  let source = String(value || "");
  source = source.replace(/`([^`\n]+)`/g, (_match, code) => hold(`<code>${escapeHtml(code)}</code>`));
  source = source.replace(/!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_match, alt, target, title) => {
    const src = safeChatUrl(target, { image: true });
    if (!src) return escapeHtml(alt || "image");
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return hold(`<a class="markdown-image-link" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer"><img class="markdown-image" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy"${titleAttribute}></a>`);
  });
  source = source.replace(/\[([^\]]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_match, label, target, title) => {
    const href = safeChatUrl(target);
    if (!href) return escapeHtml(label);
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return hold(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${titleAttribute}>${escapeHtml(label)}</a>`);
  });
  let html = escapeHtml(source)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\n]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~\n]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^\w])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|\s)(@[a-z0-9][a-z0-9-]*)\b/gi, "$1<mark>$2</mark>")
    .replace(/\n/g, "<br>");
  html = html.replace(/\uE000(\d+)\uE001/g, (_match, index) => tokens[Number(index)] || "");
  return html;
}

function splitTableRow(line) {
  let source = String(line || "").trim();
  if (!source.includes("|")) return null;
  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|")) {
    let backslashes = 0;
    for (let index = source.length - 2; index >= 0 && source[index] === "\\"; index -= 1) backslashes += 1;
    if (backslashes % 2 === 0) source = source.slice(0, -1);
  }

  const cells = [""];
  let codeFenceLength = 0;
  for (let index = 0; index < source.length;) {
    if (source[index] === "`") {
      let runLength = 1;
      while (source[index + runLength] === "`") runLength += 1;
      if (!codeFenceLength) codeFenceLength = runLength;
      else if (codeFenceLength === runLength) codeFenceLength = 0;
      cells[cells.length - 1] += source.slice(index, index + runLength);
      index += runLength;
      continue;
    }
    if (source[index] === "|" && !codeFenceLength) {
      let backslashes = 0;
      for (let previous = index - 1; previous >= 0 && source[previous] === "\\"; previous -= 1) backslashes += 1;
      if (backslashes % 2 === 1) {
        cells[cells.length - 1] = `${cells[cells.length - 1].slice(0, -1)}|`;
      } else {
        cells.push("");
      }
      index += 1;
      continue;
    }
    cells[cells.length - 1] += source[index];
    index += 1;
  }
  return cells.map((cell) => cell.trim());
}

function tableDefinition(lines, index) {
  if (index + 1 >= lines.length) return null;
  const headers = splitTableRow(lines[index]);
  const delimiters = splitTableRow(lines[index + 1]);
  if (!headers || !delimiters || headers.length !== delimiters.length) return null;
  if (!delimiters.every((cell) => /^:?-{3,}:?$/.test(cell))) return null;
  const alignments = delimiters.map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.endsWith(":")) return "right";
    if (cell.startsWith(":")) return "left";
    return "";
  });
  return { headers, alignments };
}

function tableCell(tag, value, alignment) {
  const className = alignment ? ` class="markdown-align-${alignment}"` : "";
  return `<${tag}${className}>${renderInlineMarkdown(value)}</${tag}>`;
}

function isBlockStart(line) {
  return /^\s*(?:```|#{1,6}\s|[-+*]\s+|\d+[.)]\s+|>\s?|(?:-{3,}|\*{3,})\s*$)/.test(line);
}

function renderMarkdown(value) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const output = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    const fence = /^\s*```([^\s`]*)\s*$/.exec(line);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      const language = String(fence[1] || "").replace(/[^A-Za-z0-9_-]/g, "");
      output.push(`<pre><code${language ? ` class="language-${language}"` : ""}>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }
    const table = tableDefinition(lines, index);
    if (table) {
      const header = table.headers.map((cell, cellIndex) => tableCell("th", cell, table.alignments[cellIndex])).join("");
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim()) {
        const cells = splitTableRow(lines[index]);
        if (!cells) break;
        const normalizedCells = table.headers.map((_headerCell, cellIndex) => cells[cellIndex] || "");
        rows.push(`<tr>${normalizedCells.map((cell, cellIndex) => tableCell("td", cell, table.alignments[cellIndex])).join("")}</tr>`);
        index += 1;
      }
      output.push(`<div class="markdown-table-wrap"><table><thead><tr>${header}</tr></thead>${rows.length ? `<tbody>${rows.join("")}</tbody>` : ""}</table></div>`);
      continue;
    }
    const heading = /^\s*(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      output.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,})\s*$/.test(line)) {
      output.push("<hr>");
      index += 1;
      continue;
    }
    const unordered = /^\s*[-+*]\s+(.+)$/.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      const tag = ordered ? "ol" : "ul";
      const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-+*]\s+(.+)$/;
      const items = [];
      while (index < lines.length) {
        const item = pattern.exec(lines[index]);
        if (!item) break;
        items.push(`<li>${renderInlineMarkdown(item[1])}</li>`);
        index += 1;
      }
      output.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      output.push(`<blockquote>${renderInlineMarkdown(quote.join("\n"))}</blockquote>`);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index]) && !tableDefinition(lines, index)) paragraph.push(lines[index++]);
    output.push(`<p>${renderInlineMarkdown(paragraph.join("\n"))}</p>`);
  }
  return output.join("") || "<p></p>";
}

function isImageArtifact(artifact) {
  if (/^image\//i.test(String(artifact?.mimeType || ""))) return true;
  return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(String(artifact?.name || artifact?.uri || ""));
}

function renderChatArtifacts(artifacts = []) {
  return (Array.isArray(artifacts) ? artifacts : []).map((artifact) => {
    const href = safeChatUrl(artifact?.uri, { image: isImageArtifact(artifact) });
    const name = String(artifact?.name || artifact?.artifactName || "Delivered work");
    if (!href) return `<span class="chat-artifact-invalid">${escapeHtml(name)}</span>`;
    if (isImageArtifact(artifact)) {
      return `<figure class="chat-image-attachment"><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHtml(href)}" alt="${escapeHtml(name)}" loading="lazy"></a><figcaption>${escapeHtml(name)}</figcaption></figure>`;
    }
    return `<a class="chat-file-attachment" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">↗ ${escapeHtml(name)}</a>`;
  }).join("");
}

export { escapeHtml, isImageArtifact, renderChatArtifacts, renderInlineMarkdown, renderMarkdown, safeChatUrl };
