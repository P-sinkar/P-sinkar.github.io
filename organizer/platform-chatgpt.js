// ChatGPT: turns a conversation's JSON into a message list for the .md/.html exports.
// Shared unchanged with the desktop extension (v3). In this personal phone app the JSON comes
// either from your official data export (conversations.json) or from your own bookmarklet,
// which you run yourself on a chat you have open.

// ---------- Transcript cleanup ----------
// ChatGPT's replies can contain its own UI markup (<box>, <row>, <AsyncImage/>, <Cite/>,
// <Entity/>, <WritingBlock>, {@body ...} state lines, etc.) that the ChatGPT app renders as
// cards and widgets. In a .txt transcript that's noise, so we convert it back to plain text.
// Only a fixed list of known tag names is touched, and fenced ``` code blocks are left as-is,
// so ordinary HTML/JSX that you or ChatGPT wrote as code survives untouched.

const GENUI_DROP = new Set(["asyncimage", "cite", "memorycite", "icon", "divider", "spacer", "image", "img", "button"]);
const GENUI_UNWRAP = new Set(["box", "row", "col", "stack", "grid", "text", "title", "radio-group", "card", "section"]);
const GENUI_ALL = new Set([...GENUI_DROP, ...GENUI_UNWRAP, "entity", "link", "badge", "radio", "writingblock"]);

function decodeHtmlEntities(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return named[code.toLowerCase()] ?? m;
  });
}

// Scans one tag starting at s[i] === "<". Handles quoted attrs and {...} attrs that may
// themselves contain ">" (e.g. onClick={() => ...}). Returns null if it isn't a known tag.
function readGenUiTag(s, i) {
  const m = /^<(\/?)([A-Za-z][\w-]*)/.exec(s.slice(i, i + 40));
  if (!m) return null;
  const name = m[2].toLowerCase();
  if (!GENUI_ALL.has(name)) return null;
  let j = i + m[0].length, depth = 0, quote = null;
  for (; j < s.length; j++) {
    const c = s[j];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '"' || c === "'") { if (depth === 0) quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth <= 0) break;
  }
  if (j >= s.length) return null;
  const raw = s.slice(i, j + 1);
  return { name, closing: m[1] === "/", selfClosing: /\/\s*>$/.test(raw), raw, end: j + 1 };
}

function attr(raw, key) {
  const m = new RegExp(`\\b${key}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*"([^"]*)"\\s*\\})`).exec(raw);
  return m ? (m[1] ?? m[2] ?? m[3]) : null;
}

function cleanGenUiSegment(s) {
  // Drop {@body ...} state declarations (whole line).
  s = s.replace(/^[ \t]*\{@body[^\n]*\}[ \t]*$/gm, "");

  let out = "";
  let skipUntilClose = null; // tag name whose inner content is being dropped (e.g. button)
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "<") {
      if (!skipUntilClose) out += s[i];
      i++;
      continue;
    }
    const tag = readGenUiTag(s, i);
    if (!tag) { if (!skipUntilClose) out += s[i]; i++; continue; }
    i = tag.end;

    if (skipUntilClose) {
      if (tag.closing && tag.name === skipUntilClose) skipUntilClose = null;
      continue;
    }
    if (tag.closing) {
      if (tag.name === "writingblock") out += "\n\uE002\n";
      else if (tag.name === "badge") out += "]";
      else if (tag.name === "title") out += "\n";
      continue;
    }
    switch (tag.name) {
      case "entity": out += attr(tag.raw, "value") || ""; break;
      case "link": {
        const url = attr(tag.raw, "url"), title = attr(tag.raw, "title");
        out += title && url ? `${title} (${url})` : (title || url || "");
        break;
      }
      case "writingblock": out += "\n\uE000\uE001\n"; break;
      case "badge": out += "["; if (tag.selfClosing) out += "]"; break;
      case "radio": out += "\n- "; break;
      case "title": out += "\n"; break;
      default:
        if (GENUI_DROP.has(tag.name) && !tag.selfClosing) skipUntilClose = tag.name;
        // unwrap/drop tags otherwise just disappear
    }
  }
  return out;
}

function cleanMessageText(text) {
  if (!text) return text;
  text = text.replace(/[\uE000-\uE002]/g, ""); // reserved for our own document markers
  // Split out fenced code blocks so they're never altered.
  const pieces = text.split(/(```[\s\S]*?```)/g);
  const cleaned = pieces.map((piece, idx) => {
    if (idx % 2 === 1) return piece; // code block
    const hadMarkup = /<\/?(box|row|AsyncImage|Cite|Entity|WritingBlock|MemoryCite|radio-group)\b/.test(piece) || /\{@body/.test(piece);
    let p = hadMarkup ? cleanGenUiSegment(piece) : piece;
    p = decodeHtmlEntities(p);
    if (hadMarkup) {
      // Indentation here came from nested layout boxes, not from the content — flatten it.
      p = p.split("\n").map(l => l.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "")).join("\n");
      // Tighten option lists that came from radio buttons (one blank line between each).
      p = p.replace(/\n{2,}(?=- )/g, (m, off) => (/\n- [^\n]*$/.test(p.slice(0, off)) ? "\n" : m));
    }
    return p;
  }).join("");
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

function chatgptConversationToMessages(json) {
  const mapping = json.mapping || {};
  let nodeId = json.current_node;
  const chain = [];
  const seen = new Set();
  while (nodeId && mapping[nodeId] && !seen.has(nodeId)) {
    seen.add(nodeId);
    chain.push(nodeId);
    nodeId = mapping[nodeId].parent;
  }
  chain.reverse();

  const messages = [];
  chain.forEach(id => {
    const node = mapping[id];
    const msg = node && node.message;
    if (!msg || !msg.author) return;
    const role = msg.author.role;
    if (role !== "user" && role !== "assistant") return;
    const meta = msg.metadata || {};
    if (meta.is_visually_hidden_from_conversation) return;
    const content = msg.content || {};
    const recipient = msg.recipient || "all";

    // Canvas / document blocks: ChatGPT writes these as a tool call whose text is JSON
    // holding the document body. Include the document so the transcript isn't missing it.
    if (role === "assistant" && /^canmore\./.test(recipient) && typeof content.text === "string") {
      try {
        const doc = JSON.parse(content.text);
        const body = doc.content || (Array.isArray(doc.updates) ? doc.updates.map(u => u.replacement).filter(Boolean).join("\n") : "");
        if (body) messages.push({ role, time: msg.create_time || null, attachments: [], text: `\uE000${doc.name || ""}\uE001\n${cleanMessageText(body)}\n\uE002` });
      } catch (e) { /* not JSON — skip */ }
      return;
    }

    // Skip other tool calls (search queries, code-interpreter input, etc.) and reasoning.
    if (recipient !== "all") return;
    if (["thoughts", "reasoning_recap", "user_editable_context", "model_editable_context"].includes(content.content_type)) return;

    const parts = content.parts || [];
    const text = cleanMessageText(parts.filter(p => typeof p === "string").join("\n").trim());

    // Attached files (names only — file contents aren't part of the conversation data).
    const attachments = (Array.isArray(meta.attachments) ? meta.attachments : [])
      .map(a => a && a.name).filter(Boolean);
    const imageCount = parts.filter(p => p && typeof p === "object" && /image/.test(p.content_type || "")).length;
    if (imageCount > attachments.length) {
      for (let k = attachments.length; k < imageCount; k++) attachments.push("(image)");
    }

    if (!text && !attachments.length) return;
    messages.push({ role, time: msg.create_time || null, attachments, text });
  });
  return messages;
}
