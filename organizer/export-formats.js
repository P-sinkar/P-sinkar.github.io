// Two export formats built from the same message list:
//   1. messagesToAiMarkdown — for another LLM (Claude, ChatGPT, others) or any program:
//      plain text, unambiguous turn boundaries, metadata up front, nothing decorative.
//   2. messagesToHtml       — for people: a self-contained page with chat bubbles, a
//      "conversation flow" index of your prompts, rendered tables/headings/code, and documents
//      shown as cards. Fully offline: no scripts at all, nothing loaded from the internet
//      (Mermaid diagrams appear as their readable source).
//
// Message shape: { role: "user"|"assistant", text, time?: unix seconds, attachments?: [name] }
// Documents inside a message are delimited by invisible private-use characters —
// DOC_OPEN + name + DOC_NAME_END ... DOC_CLOSE — produced by the parsers in store.js.
// Using characters that never occur in real chat text means a message that merely *mentions*
// "[Document]" can't be mistaken for an actual document.

const DOC_RE = /\uE000([^\uE001]*)\uE001\n?([\s\S]*?)\n?\uE002/g;
const DOC_STRAY = /[\uE000-\uE002]/g;

function splitDocuments(text) {
  const segs = [];
  let last = 0, m;
  DOC_RE.lastIndex = 0;
  while ((m = DOC_RE.exec(text))) {
    if (m.index > last) segs.push({ type: "text", text: text.slice(last, m.index).trim() });
    segs.push({ type: "doc", name: (m[1] || "").trim(), text: m[2].trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) segs.push({ type: "text", text: text.slice(last).trim() });
  segs.forEach(s => { s.text = s.text.replace(DOC_STRAY, ""); s.name = (s.name || "").replace(DOC_STRAY, ""); });
  return segs.filter(s => s.text || s.type === "doc");
}

function isoTime(sec) {
  if (!sec) return null;
  const d = new Date(sec * 1000);
  return isNaN(d) ? null : d.toISOString();
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, " "); }

// ---------- 1. For LLMs / machines ----------

function messagesToAiMarkdown(messages, meta) {
  const source = meta.source || "ChatGPT";
  const lines = [];
  lines.push("---");
  lines.push(`title: ${JSON.stringify(meta.title || "Untitled")}`);
  lines.push(`source: ${source}`);
  if (meta.url) lines.push(`url: ${meta.url}`);
  lines.push(`exported: ${new Date().toISOString()}`);
  lines.push(`messages: ${messages.length}`);
  if (meta.completeness) lines.push(`completeness: ${meta.completeness}`);
  lines.push("---");
  lines.push("");
  lines.push(`# Conversation: ${meta.title || "Untitled"}`);
  lines.push("");
  lines.push(`This is a complete export of a conversation between a user and ${source}. ` +
    `Each turn is wrapped in a <message> tag with its role (user or assistant) and timestamp. ` +
    `Documents the assistant produced are wrapped in <document> tags, and files the user attached are listed by name in <attachments> (their contents are not included). ` +
    `Treat this as prior context for the current conversation.`);
  lines.push("");

  messages.forEach((m, i) => {
    const t = isoTime(m.time);
    lines.push(`<message n="${i + 1}" role="${m.role}"${t ? ` time="${t}"` : ""}>`);
    if (m.attachments && m.attachments.length) {
      lines.push(`<attachments>${m.attachments.join("; ")}</attachments>`);
    }
    splitDocuments(m.text || "").forEach(seg => {
      if (seg.type === "doc") {
        lines.push(`<document${seg.name ? ` title="${escapeAttr(seg.name)}"` : ""}>`);
        lines.push(seg.text);
        lines.push("</document>");
      } else {
        lines.push(seg.text);
      }
    });
    lines.push("</message>");
    lines.push("");
  });
  return lines.join("\n");
}

// ---------- 2. For people ----------

let markedConfigured = false;
function renderMarkdown(md) {
  if (typeof marked === "undefined") {
    // Library missing for some reason — fall back to escaped plain text, still readable.
    return `<p>${escapeHtml(md).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
  }
  if (!markedConfigured) {
    marked.use({
      gfm: true,
      breaks: true,
      renderer: {
        // Never pass raw HTML from the chat through into the page — show it as text.
        html(html) { return escapeHtml(typeof html === "object" ? html.text : html); },
        code(code, lang) {
          if ((lang || "").trim().toLowerCase() === "mermaid") {
            return `<div class="diagram"><div class="diagram-label">Diagram (Mermaid source)</div><pre class="mermaid">${escapeHtml(code)}</pre></div>`;
          }
          return false; // default rendering
        },
        link(href, title, text) {
          const safe = /^(https?:|mailto:|#)/i.test(href || "") ? href : "#";
          return `<a href="${escapeAttr(safe)}" target="_blank" rel="noopener noreferrer"${title ? ` title="${escapeAttr(title)}"` : ""}>${text}</a>`;
        }
      }
    });
    markedConfigured = true;
  }
  return marked.parse(md || "");
}

function shortPrompt(m, n) {
  let one = (m.text || "")
    .replace(/\uE000[\s\S]*?(\uE002|$)/g, "[document]")
    .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (all, label) => label)   // markdown links → label
    .replace(/[*_`]+/g, "").replace(/^#+\s*/, "")
    .replace(/\s+/g, " ").trim();
  const files = (m.attachments || []).join(", ");
  if (one.replace(/[^\p{L}\p{N}]/gu, "").length < 3 && files) one = `📎 ${files}${one && !/^[.\s]*$/.test(one) ? " — " + one : ""}`;
  return one.length > n ? one.slice(0, n - 1).trimEnd() + "…" : (one || "(empty)");
}

function formatLocal(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return isNaN(d) ? "" : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function messagesToHtml(messages, meta) {
  const source = meta.source || "ChatGPT";
  const title = meta.title || "Untitled conversation";
  let hasMermaid = false;
  let promptNo = 0;

  const flowItems = [];
  const body = messages.map((m, i) => {
    const id = `m${i + 1}`;
    const isUser = m.role === "user";
    if (isUser) {
      promptNo++;
      flowItems.push(`<li><a href="#${id}"><span class="n">${promptNo}</span>${escapeHtml(shortPrompt(m, 90))}</a></li>`);
    }
    const segs = splitDocuments(m.text || "").map(seg => {
      const html = renderMarkdown(seg.text);
      if (/class="mermaid"/.test(html)) hasMermaid = true;
      if (seg.type === "doc") {
        return `<details class="doc" open><summary><span class="doc-tag">Document</span>${escapeHtml(seg.name || "")}</summary><div class="doc-body">${html}</div></details>`;
      }
      return html;
    }).join("\n");
    const chips = (m.attachments || []).map(a => `<span class="chip">📎 ${escapeHtml(a)}</span>`).join("");
    const when = formatLocal(m.time);
    return `<article id="${id}" class="msg ${isUser ? "user" : "assistant"}">
  <div class="who">${isUser ? `You${promptNo ? ` · #${promptNo}` : ""}` : escapeHtml(source)}${when ? `<time>${escapeHtml(when)}</time>` : ""}</div>
  ${chips ? `<div class="chips">${chips}</div>` : ""}
  ${segs.trim() ? `<div class="content">${segs}</div>` : ""}
</article>`;
  }).join("\n");

  const exported = new Date().toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
:root {
  --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6860; --line: #e4e1d9;
  --user: #eef1f6; --user-line: #d6dce8; --card: #ffffff; --accent: #2f5d8a; --code: #f2f0ea;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #161615; --fg: #e9e7e2; --muted: #9b978d; --line: #2e2d2a;
    --user: #1f2530; --user-line: #2e3646; --card: #1d1d1b; --accent: #8db4dc; --code: #24231f; }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
.layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 40px; max-width: 1180px; margin: 0 auto; padding: 32px 24px 80px; }
header.top { grid-column: 1 / -1; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
header.top h1 { font-size: 26px; line-height: 1.25; margin: 0 0 6px; font-weight: 650; letter-spacing: -0.01em; }
header.top .meta { color: var(--muted); font-size: 13.5px; }
header.top .meta a { color: var(--muted); }
nav.flow { position: sticky; top: 20px; align-self: start; max-height: calc(100vh - 40px); overflow: auto; font-size: 13.5px; }
nav.flow h2 { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 4px 0 10px; font-weight: 600; }
nav.flow ol { list-style: none; margin: 0; padding: 0; border-left: 1px solid var(--line); }
nav.flow li a { display: flex; gap: 10px; padding: 7px 10px 7px 14px; color: var(--fg); text-decoration: none; line-height: 1.4; margin-left: -1px; border-left: 2px solid transparent; }
nav.flow li a:hover { border-left-color: var(--accent); color: var(--accent); }
nav.flow .n { color: var(--muted); font-variant-numeric: tabular-nums; min-width: 1.4em; }
main { min-width: 0; }
.msg { margin: 0 0 28px; scroll-margin-top: 16px; }
.msg .who { font-size: 12.5px; font-weight: 600; color: var(--muted); margin-bottom: 6px; display: flex; gap: 10px; align-items: baseline; }
.msg .who time { font-weight: 400; }
.msg.user .content { background: var(--user); border: 1px solid var(--user-line); border-radius: 14px; padding: 12px 16px; }
.msg.assistant { padding-bottom: 24px; border-bottom: 1px solid var(--line); }
.content > :first-child { margin-top: 0; } .content > :last-child { margin-bottom: 0; }
.content h1, .content h2, .content h3, .content h4 { line-height: 1.3; margin: 1.4em 0 0.5em; }
.content h1 { font-size: 1.35em; } .content h2 { font-size: 1.2em; } .content h3 { font-size: 1.05em; }
.content p { margin: 0 0 0.85em; }
.content ul, .content ol { padding-left: 1.4em; margin: 0 0 0.85em; }
.content a { color: var(--accent); }
.content hr { border: 0; border-top: 1px solid var(--line); margin: 1.6em 0; }
.content blockquote { margin: 0 0 1em; padding: 2px 14px; border-left: 3px solid var(--line); color: var(--muted); }
.content table { border-collapse: collapse; width: 100%; margin: 0 0 1em; font-size: 14.5px; display: block; overflow-x: auto; }
.content th, .content td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
.content th { background: var(--code); font-weight: 600; }
.content code { background: var(--code); padding: 1px 5px; border-radius: 4px; font: 0.88em/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.content pre { background: var(--code); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
.content pre code { background: none; padding: 0; }
.diagram { margin: 0 0 1em; } .diagram pre.mermaid { background: var(--card); border: 1px solid var(--line); margin-top: 4px; }
.diagram-label { font-size: 12px; color: var(--muted); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.chip { font-size: 12.5px; padding: 3px 9px; border: 1px solid var(--line); border-radius: 999px; background: var(--card); }
details.doc { border: 1px solid var(--line); border-radius: 12px; background: var(--card); margin: 0 0 1em; }
details.doc summary { cursor: pointer; padding: 10px 16px; font-weight: 600; display: flex; gap: 10px; align-items: center; list-style: none; }
details.doc summary::-webkit-details-marker { display: none; }
details.doc summary::after { content: "▾"; margin-left: auto; color: var(--muted); }
details.doc:not([open]) summary::after { content: "▸"; }
.doc-tag { font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--accent); border: 1px solid var(--line); border-radius: 5px; padding: 1px 6px; }
.doc-body { padding: 4px 18px 14px; border-top: 1px solid var(--line); }
@media (max-width: 860px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 20px 16px 60px; }
  nav.flow { position: static; max-height: none; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  header.top h1 { font-size: 21px; }
}
@media print {
  nav.flow { display: none; } .layout { display: block; max-width: none; padding: 0; }
  details.doc { break-inside: auto; } .msg { break-inside: avoid-page; }
}
</style>
</head>
<body>
<div class="layout">
  <header class="top">
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">${escapeHtml(source)} conversation · ${messages.length} messages · ${promptNo} prompts · exported ${escapeHtml(exported)}${meta.url ? ` · <a href="${escapeAttr(meta.url)}" target="_blank" rel="noopener noreferrer">open original</a>` : ""}${meta.completeness === "partial" ? " · <strong>read from the page; very long blocks may be incomplete</strong>" : ""}</div>
  </header>
  <nav class="flow" aria-label="Conversation flow">
    <h2>Conversation flow</h2>
    <ol>${flowItems.join("")}</ol>
  </nav>
  <main>
${body}
  </main>
</div>
</body>
</html>`;
}
