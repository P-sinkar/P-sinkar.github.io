// Chat Organizer — phone app. Same folders, backups and export formats as the desktop extension.

const APP_VERSION = "1.0.0";
let DATA = loadData();
let PREFS = loadPrefs();
let PENDING = null; // chat received from the bookmarklet: { platform, id, url, title, messages }

// ---------- Small helpers ----------

function $(sel, root = document) { return root.querySelector(sel); }

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach(k => { if (k != null) n.append(k.nodeType ? k : String(k)); });
  return n;
}

let toastTimer = null;
function toast(msg, isError = false, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

function persist() {
  if (!saveData(DATA)) toast("Couldn't save — your phone's browser storage is full or blocked.", true, 6000);
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts > 1e12 ? ts : ts * 1000);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function badge(platform) {
  const p = PLATFORMS[platform] || PLATFORMS.chatgpt;
  return el("span", { class: `badge ${p.id}` }, p.badge);
}

function showView(id) {
  ["mainView", "receiveView", "shareView"].forEach(v => { $("#" + v).hidden = v !== id; });
  window.scrollTo(0, 0);
}

// ---------- Bottom sheets ----------

// items: [{ label, value, danger?, disabled?, current? }] → resolves to value, or null if cancelled.
function sheet(title, items) {
  return new Promise(resolve => {
    const dlg = el("dialog", { class: "sheet" });
    let done = false;
    const finish = v => { if (done) return; done = true; dlg.close(); dlg.remove(); resolve(v); };
    if (title) dlg.append(el("div", { class: "sheet-title" }, title));
    const list = el("div", { class: "sheet-list" });
    items.forEach(it => {
      list.append(el("button", {
        class: "sheet-item" + (it.danger ? " danger" : "") + (it.current ? " current" : ""),
        disabled: it.disabled, style: it.indent ? `padding-left:${12 + it.indent * 18}px` : null,
        onclick: () => finish(it.value)
      }, it.label));
    });
    dlg.append(list, el("button", { class: "sheet-cancel", onclick: () => finish(null) }, "Cancel"));
    dlg.addEventListener("cancel", e => { e.preventDefault(); finish(null); });
    dlg.addEventListener("click", e => { if (e.target === dlg) finish(null); }); // tap on backdrop
    document.body.append(dlg);
    dlg.showModal();
  });
}

function folderPath(id) {
  const names = [];
  let cur = DATA.folders[id], guard = 0;
  while (cur && guard++ < 50) { names.unshift(cur.name); cur = DATA.folders[cur.parentId]; }
  return names.join(" / ");
}

function sortedFolders(parentId) {
  return Object.values(DATA.folders)
    .filter(f => (f.parentId || null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function isWithin(candidateId, rootId) {
  let cur = candidateId, guard = 0;
  while (cur && guard++ < 100) { if (cur === rootId) return true; cur = DATA.folders[cur] ? DATA.folders[cur].parentId : null; }
  return false;
}

// Folder picker. Returns a folder id, "" for Unorganized / top level, or null if cancelled.
async function pickFolder(title, { currentId = null, rootLabel = "Unorganized", excludeSubtreeOf = null } = {}) {
  const items = [{ label: rootLabel, value: "", current: !currentId }];
  const walk = (parentId, depth) => sortedFolders(parentId).forEach(f => {
    const excluded = excludeSubtreeOf && isWithin(f.id, excludeSubtreeOf);
    items.push({ label: f.name, value: f.id, indent: depth, current: f.id === currentId, disabled: excluded });
    walk(f.id, depth + 1);
  });
  walk(null, 0);
  items.push({ label: "+ New folder…", value: "__new__" });
  const v = await sheet(title, items);
  if (v === "__new__") {
    const name = await uiPrompt("New folder", { placeholder: "Folder name", okLabel: "Create" });
    if (!name) return null;
    const fid = newId("f");
    DATA.folders[fid] = { id: fid, name, parentId: null, order: Date.now() };
    persist();
    return fid;
  }
  return v;
}

// ---------- Main view ----------

function visible(c) { return PREFS.filter === "all" || chatPlatform(c) === PREFS.filter; }

function sortChats(list) {
  const arr = list.slice();
  if (PREFS.sort === "title_asc") arr.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  else if (PREFS.sort === "date_asc") arr.sort((a, b) => (a.createTime || 0) - (b.createTime || 0));
  else arr.sort((a, b) => (b.createTime || 0) - (a.createTime || 0));
  return arr;
}

function chatsIn(folderId) {
  return Object.values(DATA.chats).filter(c => (c.folderId || null) === folderId && visible(c));
}

function countDeep(folderId) {
  return chatsIn(folderId).length + sortedFolders(folderId).reduce((n, f) => n + countDeep(f.id), 0);
}

function chatRow(c) {
  const sub = [fmtDate(c.createTime), c.url ? "shared copy" : "", c.folderId && $("#search").value.trim() ? folderPath(c.folderId) : ""].filter(Boolean).join(" · ");
  return el("div", { class: "row chat-row" },
    badge(chatPlatform(c)),
    el("a", { href: chatUrlFor(c), target: "_blank", rel: "noopener" },
      el("span", { class: "title" }, c.title || "Untitled"),
      sub ? el("span", { class: "sub" }, sub) : null),
    el("button", { class: "more", "aria-label": "Chat options", onclick: () => chatActions(c) }, "⋯"));
}

function folderNode(f) {
  const kids = sortedFolders(f.id), chats = sortChats(chatsIn(f.id));
  const open = !f.collapsed;
  const wrap = el("div");
  wrap.append(el("div", { class: "row folder-row", onclick: e => { if (e.target.closest(".more")) return; f.collapsed = open; persist(); renderMain(); } },
    el("span", { class: "caret" }, kids.length || chats.length ? (open ? "▾" : "▸") : ""),
    el("span", { class: "name" }, f.name),
    el("span", { class: "count" }, countDeep(f.id)),
    el("button", { class: "more", "aria-label": "Folder options", onclick: () => folderActions(f) }, "⋯")));
  if (open && (kids.length || chats.length)) {
    wrap.append(el("div", { class: "children" }, kids.map(folderNode), chats.map(chatRow)));
  }
  return wrap;
}

function renderMain() {
  document.querySelectorAll(".chip").forEach(b => b.classList.toggle("on", b.dataset.filter === PREFS.filter));
  $("#sort").value = PREFS.sort;
  const tree = $("#tree");
  tree.textContent = "";
  const q = $("#search").value.trim().toLowerCase();
  const total = Object.keys(DATA.chats).length + Object.keys(DATA.folders).length;

  if (!total) {
    tree.append(el("div", { class: "empty" },
      "Nothing here yet.", el("br"), el("br"),
      "Send a chat from Chrome with your bookmarklet, share a chat link here from the ChatGPT or Claude app, or open the menu (⋮) to restore a backup from your computer."));
    return;
  }

  if (q) {
    const hits = sortChats(Object.values(DATA.chats).filter(c => visible(c) && (c.title || "").toLowerCase().includes(q)));
    if (!hits.length) tree.append(el("div", { class: "empty" }, "No chats match."));
    hits.forEach(c => tree.append(chatRow(c)));
    return;
  }

  const unorg = sortChats(chatsIn(null));
  const uOpen = !PREFS.unorgCollapsed;
  tree.append(el("div", { class: "row folder-row", onclick: () => { PREFS.unorgCollapsed = uOpen; savePrefs(PREFS); renderMain(); } },
    el("span", { class: "caret" }, unorg.length ? (uOpen ? "▾" : "▸") : ""),
    el("span", { class: "name" }, "Unorganized"),
    el("span", { class: "count" }, unorg.length),
    el("span", { style: "width:40px" })));
  if (uOpen && unorg.length) tree.append(el("div", { class: "children" }, unorg.map(chatRow)));
  sortedFolders(null).forEach(f => tree.append(folderNode(f)));
  renderBackupBanner();
}

function renderBackupBanner() {
  const b = $("#banner");
  const hasData = Object.keys(DATA.chats).length > 0;
  const last = getLastBackupTime();
  const days = last ? (Date.now() - last) / 864e5 : Infinity;
  const snoozed = PREFS.backupSnoozeUntil && Date.now() < PREFS.backupSnoozeUntil;
  if (!hasData || days < 14 || snoozed) { b.hidden = true; return; }
  b.textContent = "";
  b.append(el("span", {}, last ? `Last backup ${Math.floor(days)} days ago.` : "No backup yet — your folders only live on this phone."),
    el("span", {}, el("button", { onclick: exportBackup }, "Back up"),
      el("button", { onclick: () => { PREFS.backupSnoozeUntil = Date.now() + 3 * 864e5; savePrefs(PREFS); b.hidden = true; } }, "Later")));
  b.hidden = false;
}

// ---------- Chat and folder actions ----------

async function chatActions(c) {
  const p = PLATFORMS[chatPlatform(c)];
  const v = await sheet(c.title || "Untitled", [
    { label: `Open in ${p.label}`, value: "open" },
    { label: "Move to…", value: "move" },
    { label: "Rename", value: "rename" },
    { label: "Export from data-export file…", value: "export" },
    { label: "Remove from organizer", value: "remove", danger: true }
  ]);
  if (v === "open") window.open(chatUrlFor(c), "_blank", "noopener");
  if (v === "move") {
    const to = await pickFolder("Move chat to", { currentId: c.folderId || null });
    if (to === null) return;
    c.folderId = to || null; persist(); renderMain();
    toast(`Moved to ${to ? folderPath(to) : "Unorganized"}`);
  }
  if (v === "rename") {
    const name = await uiPrompt("Rename chat", { value: c.title || "" });
    if (!name) return;
    c.title = name; c.titleLocked = true; persist(); renderMain();
  }
  if (v === "export") exportFromDataFile(c);
  if (v === "remove") {
    if (!await uiConfirm(`This only removes it from the organizer. The chat itself stays on ${p.label}.`, { title: `Remove "${c.title || "Untitled"}"?`, okLabel: "Remove", danger: true })) return;
    delete DATA.chats[c.id]; persist(); renderMain();
  }
}

async function folderActions(f) {
  const v = await sheet(folderPath(f.id), [
    { label: "Add subfolder", value: "sub" },
    { label: "Rename", value: "rename" },
    { label: "Move to…", value: "move" },
    { label: "Delete folder", value: "delete", danger: true }
  ]);
  if (v === "sub") {
    const name = await uiPrompt("New subfolder", { placeholder: "Folder name", okLabel: "Create", message: `Inside ${f.name}` });
    if (!name) return;
    const fid = newId("f");
    DATA.folders[fid] = { id: fid, name, parentId: f.id, order: Date.now() };
    f.collapsed = false; persist(); renderMain();
  }
  if (v === "rename") {
    const name = await uiPrompt("Rename folder", { value: f.name });
    if (!name) return;
    f.name = name; persist(); renderMain();
  }
  if (v === "move") {
    const to = await pickFolder("Move folder into", { currentId: f.parentId || null, rootLabel: "Top level", excludeSubtreeOf: f.id });
    if (to === null) return;
    f.parentId = to || null; persist(); renderMain();
  }
  if (v === "delete") {
    if (!await uiConfirm("Its subfolders are deleted too. Chats inside move to Unorganized.", { title: `Delete "${f.name}"?`, okLabel: "Delete", danger: true })) return;
    const drop = id => { sortedFolders(id).forEach(k => drop(k.id)); Object.values(DATA.chats).forEach(c => { if (c.folderId === id) c.folderId = null; }); delete DATA.folders[id]; };
    drop(f.id); persist(); renderMain();
  }
}

// ---------- Exports (.md for AI, .html for reading) ----------

function exportMeta(platform, title, url, completeness) {
  return { title: title || "Untitled", url, source: PLATFORMS[platform].label, completeness };
}

function buildExport(format, messages, meta) {
  const base = safeFileName(meta.title);
  return format === "ai"
    ? { name: `${base} (for AI).md`, text: messagesToAiMarkdown(messages, meta), type: "text/markdown" }
    : { name: `${base}.html`, text: messagesToHtml(messages, meta), type: "text/html" };
}

let chatExportTarget = null;
async function exportFromDataFile(c) {
  const format = await sheet("Export as", [{ label: "For AI (.md)", value: "ai" }, { label: "Readable (.html)", value: "html" }]);
  if (!format) return;
  chatExportTarget = { chat: c, format };
  toast(`Pick conversations.json from your ${PLATFORMS[chatPlatform(c)].label} data export`);
  $("#chatExportFile").click();
}

$("#chatExportFile").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file || !chatExportTarget) return;
  const { chat, format } = chatExportTarget; chatExportTarget = null;
  const platform = chatPlatform(chat);
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch (err) { toast("That file isn't valid JSON. Use conversations.json from the data export.", true, 5000); return; }
  const list = exportList(parsed);
  const match = list.find(x => platform === "claude" ? (x.uuid || x.id) === chat.id : (x.conversation_id || x.id) === chat.id);
  if (!match) { toast(`This chat isn't in that file. Request a fresh export: ${PLATFORMS[platform].exportHelp}.`, true, 6000); return; }
  const messages = conversationToMessages(platform, match);
  const out = buildExport(format, messages, exportMeta(platform, chat.title, chatUrlFor(chat), "full"));
  downloadTextFile(out.name, out.text, out.type);
  toast(`Saved ${out.name}`);
});

// ---------- Receiving a chat from the bookmarklet ----------

async function handleIncomingHash() {
  const m = location.hash.match(/^#import=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  history.replaceState(null, "", location.pathname); // remove the chat from the address bar
  try {
    const payload = await decodeImportPayload(m[1]);
    const messages = conversationToMessages(payload.p, payload.data);
    if (!messages.length) throw new Error("The chat came through empty.");
    PENDING = {
      platform: payload.p, id: payload.id, url: payload.url,
      title: conversationTitle(payload.p, payload.data) || "Untitled", messages
    };
    try { sessionStorage.setItem("aiorg_pending", JSON.stringify(PENDING)); } catch (e) { /* fine */ }
    // A chat that's already filed gets its title refreshed from the real conversation.
    const existing = DATA.chats[PENDING.id];
    if (existing) { existing.title = PENDING.title; existing.titleLocked = true; existing.platform = PENDING.platform; persist(); }
    showReceive();
  } catch (err) {
    showView("mainView"); renderMain();
    toast("Couldn't read the chat that was sent: " + (err.message || err), true, 7000);
  }
  return true;
}

function showReceive() {
  const P = PENDING, p = PLATFORMS[P.platform];
  const prompts = P.messages.filter(x => x.role === "user").length;
  const meta = $("#rcMeta"); meta.textContent = "";
  meta.append(badge(P.platform), `${P.messages.length} messages · ${prompts} prompt${prompts === 1 ? "" : "s"}`);
  $("#rcTitle").textContent = P.title;
  const first = P.messages.find(x => x.role === "user");
  $("#rcFirst").textContent = first ? `“${first.text.replace(/\s+/g, " ").slice(0, 140)}${first.text.length > 140 ? "…" : ""}”` : "";
  updateReceiveFolder();
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(["x"], "x.md", { type: "text/markdown" })] }));
  $("#rcShareRow").hidden = !canShare;
  showView("receiveView");
  void p;
}

function updateReceiveFolder() {
  const c = DATA.chats[PENDING.id];
  $("#rcFolder").textContent = c ? `In ${c.folderId ? folderPath(c.folderId) : "Unorganized"}` : "Not filed yet";
  $("#rcFileBtn").textContent = c ? "Move" : "Choose folder";
}

document.querySelectorAll("[data-export]").forEach(b => b.addEventListener("click", () => {
  const P = PENDING; if (!P) return;
  const out = buildExport(b.dataset.export, P.messages, exportMeta(P.platform, P.title, P.url, "full"));
  downloadTextFile(out.name, out.text, out.type);
  toast(`Saved ${out.name} to Downloads`);
}));

document.querySelectorAll("[data-share]").forEach(b => b.addEventListener("click", async () => {
  const P = PENDING; if (!P) return;
  const out = buildExport(b.dataset.share, P.messages, exportMeta(P.platform, P.title, P.url, "full"));
  try { if (!await shareTextFile(out.name, out.text, out.type)) toast("Sharing files isn't available here — use the download button.", true); }
  catch (e) { if (e && e.name !== "AbortError") toast("Couldn't share: " + e.message, true); }
}));

$("#rcFileBtn").addEventListener("click", async () => {
  const P = PENDING; if (!P) return;
  const existing = DATA.chats[P.id];
  const to = await pickFolder("File this chat in", { currentId: existing ? existing.folderId || null : null });
  if (to === null) return;
  const createTime = (P.messages[0] && P.messages[0].time) || Date.now() / 1000;
  DATA.chats[P.id] = Object.assign(existing || { id: P.id, createTime }, { title: P.title, platform: P.platform, folderId: to || null, titleLocked: true });
  persist(); updateReceiveFolder();
  toast(`Filed in ${to ? folderPath(to) : "Unorganized"}`);
});

// ---------- Receiving a link from Android's share menu ----------

let SHARED = null; // { platform, id, url, isShare }
function handleShareTarget() {
  const q = new URLSearchParams(location.search);
  if (!q.has("url") && !q.has("text") && !q.has("title")) return false;
  history.replaceState(null, "", location.pathname);
  const blob = [q.get("url"), q.get("text"), q.get("title")].filter(Boolean).join(" ");
  const link = (blob.match(/https?:\/\/[^\s"'<>]+/) || [])[0];
  const parsed = link && parseChatLink(link);
  if (!parsed) {
    showView("mainView"); renderMain();
    toast("That share didn't include a ChatGPT or Claude chat link.", true, 5000);
    return true;
  }
  SHARED = parsed;
  const textTitle = [q.get("title"), (q.get("text") || "").replace(link, "")].map(s => (s || "").trim()).find(s => s && !/^https?:/.test(s));
  const existing = DATA.chats[parsed.id];
  const p = PLATFORMS[parsed.platform];
  const meta = $("#shMeta"); meta.textContent = "";
  meta.append(badge(parsed.platform), existing ? "Already in your organizer" : `${p.label} chat`);
  $("#shTitle").value = (existing && existing.title) || textTitle || `${p.label} chat`;
  $("#shNote").hidden = !parsed.isShare;
  $("#shNote").textContent = parsed.isShare
    ? `This is a share link, so it opens the read-only shared copy. To file the original chat, open it on ${p.hosts[0]} in Chrome and use your bookmarklet.`
    : "";
  SHARED.folderId = existing ? existing.folderId || null : null;
  $("#shFolder").textContent = SHARED.folderId ? folderPath(SHARED.folderId) : "Unorganized";
  showView("shareView");
  return true;
}

$("#shPickBtn").addEventListener("click", async () => {
  const to = await pickFolder("Save in", { currentId: SHARED.folderId });
  if (to === null) return;
  SHARED.folderId = to || null;
  $("#shFolder").textContent = to ? folderPath(to) : "Unorganized";
});

$("#shSaveBtn").addEventListener("click", () => {
  const s = SHARED; if (!s) return;
  const title = $("#shTitle").value.trim() || "Untitled";
  const existing = DATA.chats[s.id];
  DATA.chats[s.id] = Object.assign(existing || { id: s.id, createTime: Date.now() / 1000 },
    { title, platform: s.platform, folderId: s.folderId, titleLocked: true }, s.url ? { url: s.url } : {});
  persist();
  SHARED = null;
  showView("mainView"); renderMain();
  toast(`Saved to ${s.folderId ? folderPath(s.folderId) : "Unorganized"}`);
});

// ---------- Menu: import, backup, restore ----------

async function openMenu() {
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const v = await sheet("Chat Organizer", [
    { label: "Import from a data export (conversations.json)", value: "import" },
    { label: "Back up (save a backup file)", value: "backup" },
    { label: "Restore or merge a backup", value: "restore" },
    { label: "Expand all folders", value: "expand" },
    { label: "Collapse all folders", value: "collapse" },
    { label: "About", value: "about" }
  ]);
  if (v === "import") $("#importFile").click();
  if (v === "backup") exportBackup();
  if (v === "restore") $("#restoreFile").click();
  if (v === "expand" || v === "collapse") { Object.values(DATA.folders).forEach(f => { f.collapsed = v === "collapse"; }); persist(); renderMain(); }
  if (v === "about") {
    await uiDialog({
      title: `Chat Organizer ${APP_VERSION}`,
      message: `Your folders and chats are stored only in this phone's browser${persisted ? " (protected from automatic clean-up)" : ""}. Nothing is uploaded anywhere.\n\nBackups use the same format as the desktop extension, so you can move them between the two in either direction.\n\n${Object.keys(DATA.chats).length} chats · ${Object.keys(DATA.folders).length} folders`,
      buttons: [{ label: "OK", value: true, primary: true }]
    });
  }
}

function exportBackup() {
  const payload = backupPayload(DATA);
  downloadTextFile(`ai-chat-organizer-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
  setLastBackupTime(Date.now());
  persist(); renderMain();
  toast("Backup saved to Downloads");
}

$("#importFile").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch (err) { toast("That file isn't valid JSON. Use conversations.json from the data export.", true, 5000); return; }
  let added = 0, refreshed = 0;
  const per = { chatgpt: 0, claude: 0 };
  exportList(parsed).forEach(conv => {
    const platform = detectExportPlatform(conv); if (!platform) return;
    const { id, title, createTime } = exportEntryFields(conv, platform); if (!id) return;
    per[platform]++;
    const ex = DATA.chats[id];
    if (ex) { if (ex.title !== title) { ex.title = title; refreshed++; } ex.titleLocked = true; ex.platform = platform; return; }
    DATA.chats[id] = { id, title, folderId: null, createTime, titleLocked: true, platform };
    added++;
  });
  if (!per.chatgpt && !per.claude) { toast("No conversations found. Use conversations.json from the data export (backups go in Restore).", true, 6000); return; }
  persist(); renderMain();
  toast(`Imported: ${added} new, ${refreshed} titles refreshed (${[per.chatgpt && per.chatgpt + " ChatGPT", per.claude && per.claude + " Claude"].filter(Boolean).join(", ")})`, false, 5000);
});

$("#restoreFile").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  let backup;
  try { backup = JSON.parse(await file.text()); } catch (err) { toast("That isn't a backup file.", true); return; }
  if (!backup || !backup.folders || !backup.chats) { toast("That file doesn't look like an organizer backup.", true, 5000); return; }
  const unlabeled = Object.values(backup.chats).some(c => !PLATFORMS[c.platform]);
  let def = guessBackupPlatform(file.name);
  if (unlabeled && !def) {
    def = await uiChoose("Some chats in this backup don't say which site they're from.", [{ label: "ChatGPT", value: "chatgpt" }, { label: "Claude", value: "claude" }], { title: "Which site are they from?" });
    if (!def) return;
  }
  const isEmpty = !Object.keys(DATA.chats).length && !Object.keys(DATA.folders).length;
  if (!isEmpty && !await uiConfirm("Folders with the same name in the same place are merged. Nothing already here is moved or overwritten.", { title: "Add this backup?", okLabel: "Add" })) return;
  const r = mergeBackup(DATA, backup, def || "chatgpt");
  persist(); renderMain();
  const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;
  toast(`Restored: ${n(r.chatsAdded, "chat")} added, ${n(r.foldersAdded, "folder")} added, ${r.foldersMerged} merged${r.chatsKept ? `, ${r.chatsKept} already here` : ""}`, false, 6000);
});

// ---------- Wiring ----------

$("#menuBtn").addEventListener("click", openMenu);
$("#search").addEventListener("input", renderMain);
$("#sort").addEventListener("change", e => { PREFS.sort = e.target.value; savePrefs(PREFS); renderMain(); });
document.querySelectorAll(".chip").forEach(b => b.addEventListener("click", () => { PREFS.filter = b.dataset.filter; savePrefs(PREFS); renderMain(); }));
$("#newFolderBtn").addEventListener("click", async () => {
  const name = await uiPrompt("New folder", { placeholder: "Folder name", okLabel: "Create" });
  if (!name) return;
  const fid = newId("f");
  DATA.folders[fid] = { id: fid, name, parentId: null, order: Date.now() };
  persist(); renderMain();
});
document.querySelectorAll(".back-btn, .done-btn").forEach(b => b.addEventListener("click", () => {
  PENDING = null; SHARED = null;
  try { sessionStorage.removeItem("aiorg_pending"); } catch (e) { /* fine */ }
  showView("mainView"); renderMain();
}));
window.addEventListener("hashchange", () => { handleIncomingHash(); });
// Another tab (e.g. Chrome vs the home-screen app) changed the data: reload it.
window.addEventListener("storage", e => { if (e.key === STORE_KEY) { DATA = loadData(); if (!$("#mainView").hidden) renderMain(); } });

(async function init() {
  requestPersistentStorage();
  if (await handleIncomingHash()) return;
  if (handleShareTarget()) return;
  // A received chat survives a reload of the page.
  try {
    const saved = JSON.parse(sessionStorage.getItem("aiorg_pending") || "null");
    if (saved && saved.messages) { PENDING = saved; showReceive(); return; }
  } catch (e) { /* fine */ }
  showView("mainView"); renderMain();
})();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* app still works online */ });
}
