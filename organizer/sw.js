// Offline support. The app's own files are cached so it opens without a connection; each visit
// checks for a newer version in the background and uses it from the next launch.
// No chat data passes through here — chats live in the page's local storage only.
const CACHE = "chat-organizer-v1.0.0";
const FILES = [
  "./", "index.html", "app.css", "app.js", "data.js", "dialogs.js", "export-formats.js",
  "platform-chatgpt.js", "platform-claude.js", "lib/marked.min.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Stale-while-revalidate for the app's own files; everything else goes straight to the network.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Navigations (including "#import=…" and share-menu links) always get the app page.
  const key = e.request.mode === "navigate" ? new Request("./") : e.request;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(key, { ignoreSearch: e.request.mode === "navigate" });
    const fresh = fetch(e.request).then(res => {
      if (res.ok && e.request.mode !== "navigate") cache.put(e.request, res.clone());
      if (res.ok && e.request.mode === "navigate") cache.put(new Request("./"), res.clone());
      return res;
    }).catch(() => cached);
    return cached || fresh;
  }));
});
