// Phone version of the organizer's data layer. Same data shape and backup format as the
// desktop extension (v3), so backups move freely between the two in either direction:
// {
//   folders: { [id]: { id, name, parentId, order?, collapsed? } },
//   chats:   { [id]: { id, title, folderId, createTime, platform, titleLocked?, url? } }
// }
// `url` is only set when a chat was saved from a share link (so it opens that link); other chats
// open at their normal address on ChatGPT or Claude.
//
// Everything is stored in this browser on this phone (localStorage). Nothing is sent anywhere.

const STORE_KEY = "aiorg_data_v1";
const PREFS_KEY = "aiorg_prefs_v1";
const LAST_BACKUP_KEY = "aiorg_last_backup";

const PLATFORMS = {
  chatgpt: {
    id: "chatgpt", label: "ChatGPT", badge: "GPT",
    hosts: ["chatgpt.com", "chat.openai.com"],
    chatUrl: id => `https://chatgpt.com/c/${id}`,
    idPattern: /\/c\/([a-zA-Z0-9-]+)/,
    exportHelp: "ChatGPT → Settings → Data controls → Export data"
  },
  claude: {
    id: "claude", label: "Claude", badge: "Claude",
    hosts: ["claude.ai"],
    chatUrl: id => `https://claude.ai/chat/${id}`,
    idPattern: /\/chat\/([a-zA-Z0-9-]+)/,
    exportHelp: "Claude → Settings → Privacy → Export data"
  }
};

function platformOfUrl(url) {
  let host;
  try { host = new URL(url).hostname; } catch (e) { return null; }
  for (const p of Object.values(PLATFORMS)) {
    if (p.hosts.some(h => host === h || host.endsWith("." + h))) return p.id;
  }
  return null;
}

function chatPlatform(chat) {
  return chat && PLATFORMS[chat.platform] ? chat.platform : "chatgpt";
}

function chatUrlFor(chat) {
  return chat.url || PLATFORMS[chatPlatform(chat)].chatUrl(chat.id);
}

// From a link someone shared to the app: { platform, id, url, isShare } or null.
function parseChatLink(link) {
  const platform = platformOfUrl(link);
  if (!platform) return null;
  const u = new URL(link);
  const share = u.pathname.match(/\/share\/([a-zA-Z0-9-]+)/);
  if (share) return { platform, id: "share-" + share[1], url: u.origin + u.pathname, isShare: true };
  const m = u.pathname.match(PLATFORMS[platform].idPattern);
  if (m) return { platform, id: m[1], url: null, isShare: false };
  return null;
}

// ---------- Storage ----------

function emptyData() { return { folders: {}, chats: {} }; }

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function writeJson(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; }
  catch (e) { return false; }
}

function loadData() {
  const d = readJson(STORE_KEY, null) || emptyData();
  d.folders = d.folders || {};
  d.chats = d.chats || {};
  return d;
}

function saveData(d) { return writeJson(STORE_KEY, d); }

function loadPrefs() {
  return Object.assign({ filter: "all", sort: "date_desc" }, readJson(PREFS_KEY, {}));
}

function savePrefs(p) { writeJson(PREFS_KEY, p); }

function getLastBackupTime() { return readJson(LAST_BACKUP_KEY, null); }
function setLastBackupTime(t) { writeJson(LAST_BACKUP_KEY, t); }

// Ask the browser not to clear this site's storage under storage pressure (Chrome grants this
// to installed home-screen apps). Harmless if refused.
async function requestPersistentStorage() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); }
  catch (e) { /* ignore */ }
  return false;
}

function newId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// ---------- Official data exports (conversations.json) ----------

function detectExportPlatform(conv) {
  if (!conv || typeof conv !== "object") return null;
  if (conv.mapping || conv.conversation_id || typeof conv.create_time === "number") return "chatgpt";
  if (conv.chat_messages || conv.uuid) return "claude";
  return null;
}

function exportEntryFields(conv, platform) {
  if (platform === "claude") {
    const t = Date.parse(conv.created_at || conv.updated_at || "");
    return { id: conv.uuid || conv.id, title: (conv.name || conv.title || "").trim() || "Untitled", createTime: Number.isFinite(t) ? t / 1000 : 0 };
  }
  return { id: conv.conversation_id || conv.id, title: conv.title || "Untitled", createTime: conv.create_time || conv.update_time || 0 };
}

function exportList(parsed) {
  return Array.isArray(parsed) ? parsed : ((parsed && parsed.conversations) || []);
}

function conversationToMessages(platform, json) {
  return platform === "claude" ? claudeConversationToMessages(json) : chatgptConversationToMessages(json);
}

function conversationTitle(platform, json) {
  return ((platform === "claude" ? json.name : json.title) || "").trim();
}

// ---------- Backups (same format as the desktop extension) ----------

function backupPayload(data) {
  Object.values(data.chats).forEach(c => { c.platform = chatPlatform(c); });
  return Object.assign({ app: "ai-chat-organizer", version: 2 }, data);
}

function guessBackupPlatform(fileName) {
  const n = (fileName || "").toLowerCase();
  if (n.includes("claude")) return "claude";
  if (n.includes("chatgpt") || n.includes("gpt")) return "chatgpt";
  return null;
}

function normName(s) { return (s || "").trim().toLowerCase(); }

// Adds a backup into `data`. Same-named folders in the same place merge into one; nothing that
// is already here is moved or overwritten. Identical to the desktop extension's merge.
function mergeBackup(data, backup, defaultPlatform) {
  const bFolders = Object.values(backup.folders || {});
  const idMap = {};
  let foldersAdded = 0, foldersMerged = 0;
  const depth = f => { let d = 0, cur = f, seen = new Set(); while (cur && cur.parentId && !seen.has(cur.id)) { seen.add(cur.id); cur = backup.folders[cur.parentId]; d++; } return d; };
  bFolders.sort((x, y) => depth(x) - depth(y)).forEach(f => {
    const parentHere = f.parentId ? (idMap[f.parentId] || null) : null;
    if (data.folders[f.id]) { idMap[f.id] = f.id; return; }
    const twin = Object.values(data.folders).find(x => (x.parentId || null) === parentHere && normName(x.name) === normName(f.name));
    if (twin) { idMap[f.id] = twin.id; foldersMerged++; return; }
    data.folders[f.id] = Object.assign({}, f, { parentId: parentHere });
    idMap[f.id] = f.id;
    foldersAdded++;
  });
  let chatsAdded = 0, chatsKept = 0;
  Object.values(backup.chats || {}).forEach(c => {
    if (data.chats[c.id]) { chatsKept++; return; }
    const platform = PLATFORMS[c.platform] ? c.platform : defaultPlatform;
    data.chats[c.id] = Object.assign({}, c, { platform, folderId: c.folderId ? (idMap[c.folderId] || null) : null });
    chatsAdded++;
  });
  return { foldersAdded, foldersMerged, chatsAdded, chatsKept };
}

// ---------- Chats sent by the bookmarklet ----------
// The bookmarklet puts the chat in the address after "#import=", gzip-compressed and
// base64url-encoded. The part after "#" is never sent to any server; it only exists on the phone.

async function decodeImportPayload(b64) {
  const bin = atob(b64.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  const text = await new Response(stream).text();
  const payload = JSON.parse(text);
  if (!payload || !PLATFORMS[payload.p] || !payload.id || !payload.data) throw new Error("That doesn't look like a chat sent by the bookmarklet.");
  return payload;
}

// ---------- Files ----------

function safeFileName(name) {
  return (name || "chat").replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 60) || "chat";
}

function downloadTextFile(filename, text, mimeType) {
  const blob = new Blob([text], { type: mimeType || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Android's share sheet (send the file to Drive, WhatsApp, email…), when available.
async function shareTextFile(filename, text, mimeType) {
  const file = new File([text], filename, { type: mimeType || "text/plain" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return true;
  }
  return false;
}
