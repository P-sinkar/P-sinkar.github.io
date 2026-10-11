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

req = urllib.request.Request(FEED, headers={"User-Agent": "Mozilla/5.0 (site sync; +https://p-sinkar.github.io)"})
try:
    xml = urllib.request.urlopen(req, timeout=30).read()
except Exception as e:
    sys.exit(f"Could not fetch {FEED}: {e}")

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
