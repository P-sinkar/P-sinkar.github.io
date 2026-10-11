"""Weekly Substack sync.

Reads the Substack RSS feed and creates a small file in _posts/ for every article
that isn't on the site yet. Each file just links out to Substack, so the article
shows up in the Writing list and on the home page. Existing files are never
changed, so you can edit any of them by hand.
"""
import os, re, sys, html, urllib.request, email.utils
import xml.etree.ElementTree as ET

FEED = os.environ.get("FEED_URL", "https://pranavsinkar.substack.com/feed")
POSTS = "_posts"

req = urllib.request.Request(FEED, headers={
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
})
try:
    resp = urllib.request.urlopen(req, timeout=30)
    xml = resp.read()
except Exception as e:
    print(f"::error::Could not fetch {FEED}: {e}")
    sys.exit(1)
if b"<rss" not in xml[:2000] and b"<feed" not in xml[:2000]:
    print(f"::error::{FEED} (final URL {resp.geturl()}) did not return an RSS feed. First bytes: {xml[:150]!r}")
    sys.exit(1)

os.makedirs(POSTS, exist_ok=True)
existing = ""
for f in os.listdir(POSTS):
    existing += open(os.path.join(POSTS, f), encoding="utf-8").read()

def clean(s, limit=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    if limit and len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s

def yaml_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'

added = 0
for item in ET.fromstring(xml).iter("item"):
    title = clean(item.findtext("title"))
    link = (item.findtext("link") or "").strip().split("?")[0]
    if not title or not link or link in existing:
        continue
    date = email.utils.parsedate_to_datetime(item.findtext("pubDate"))
    slug = re.sub(r"[^a-z0-9]+", "-", link.rstrip("/").rsplit("/", 1)[-1].lower()).strip("-")[:60] or "substack-post"
    desc = clean(item.findtext("description"), 200)
    path = os.path.join(POSTS, f"{date:%Y-%m-%d}-{slug}.md")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write("---\n")
        fh.write(f"title: {yaml_str(title)}\n")
        fh.write(f"external_url: {link}\n")
        fh.write("source: Substack\n")
        if desc:
            fh.write(f"description: {yaml_str(desc)}\n")
        fh.write("---\n")
    print("Added", path)
    added += 1

print(f"{added} new article(s) from {FEED}")
