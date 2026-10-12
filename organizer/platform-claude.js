// Claude: turns a conversation's JSON into a message list for the .md/.html exports.
// Shared unchanged with the desktop extension (v3). In this personal phone app the JSON comes
// either from your official data export (conversations.json) or from your own bookmarklet,
// which you run yourself on a chat you have open.

function claudeBlockText(block, artifactTitles) {
  artifactTitles = artifactTitles || {};
  if (!block || typeof block !== "object") return "";
  if (block.type === "text") return (block.text || "").replace(/[\uE000-\uE002]/g, ""); // reserved for our markers
  if (block.type === "tool_use") {
    const inp = block.input || {};
    // Artifacts (documents, code, diagrams Claude wrote in the side panel).
    if (block.name === "artifacts") {
      if (inp.id && inp.title) artifactTitles[inp.id] = inp.title;
      const title = inp.title || artifactTitles[inp.id] || inp.id || "";
      if ((inp.command === "create" || inp.command === "rewrite") && inp.content) {
        const lang = inp.language || (/mermaid/.test(inp.type || "") ? "mermaid" : "");
        const isCode = inp.type === "application/vnd.ant.code" || /mermaid/.test(inp.type || "");
        const body = isCode ? "```" + lang + "\n" + inp.content + "\n```" : inp.content;
        return `\uE000${title}\uE001\n${body}\n\uE002`;
      }
      if (inp.command === "update" && (inp.new_str || inp.old_str)) {
        return `\uE000${title ? title + " (edit)" : "(edit)"}\uE001\nReplaced:\n${inp.old_str || ""}\n\nWith:\n${inp.new_str || ""}\n\uE002`;
      }
      return "";
    }
    // File-creation tools (newer Claude): keep the file body as a document.
    if ((block.name === "create_file" || block.name === "create") && (inp.file_text || inp.content)) {
      const name = (inp.path || inp.title || "").split("/").pop();
      return `\uE000${name}\uE001\n${inp.file_text || inp.content}\n\uE002`;
    }
    return ""; // web search, code execution input, etc.
  }
  return ""; // thinking, tool_result, images, etc.
}

function claudeConversationToMessages(conv) {
  const all = Array.isArray(conv && conv.chat_messages) ? conv.chat_messages : [];
  // Follow the branch you're actually looking at (edits/retries create side branches).
  let ordered = all;
  const byId = new Map(all.map(m => [m.uuid, m]));
  if (conv.current_leaf_message_uuid && byId.has(conv.current_leaf_message_uuid)) {
    const chain = [];
    const seen = new Set();
    let cur = byId.get(conv.current_leaf_message_uuid);
    while (cur && !seen.has(cur.uuid)) {
      seen.add(cur.uuid);
      chain.push(cur);
      cur = byId.get(cur.parent_message_uuid);
    }
    if (chain.length) ordered = chain.reverse();
  } else {
    ordered = [...all].sort((a, b) => (a.index ?? 0) - (b.index ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
  }

  const messages = [];
  const artifactTitles = {}; // artifact id → title, so later edits are labelled by name
  ordered.forEach(m => {
    const role = m.sender === "human" ? "user" : m.sender === "assistant" ? "assistant" : null;
    if (!role) return;
    let text = Array.isArray(m.content) && m.content.length
      ? m.content.map(b => claudeBlockText(b, artifactTitles)).filter(Boolean).join("\n\n")
      : (m.text || "").replace(/[\uE000-\uE002]/g, "");
    text = (text || "").trim();
    const names = [
      ...(m.attachments || []).map(a => a && (a.file_name || a.name)),
      ...(m.files || []).map(f => f && (f.file_name || f.name)),
      ...(m.files_v2 || []).map(f => f && (f.file_name || f.name))
    ].filter(Boolean);
    const attachments = [...new Set(names)];
    if (!text && !attachments.length) return;
    const t = m.created_at ? Date.parse(m.created_at) / 1000 : null;
    messages.push({ role, time: Number.isFinite(t) ? t : null, attachments, text });
  });
  return messages;
}
