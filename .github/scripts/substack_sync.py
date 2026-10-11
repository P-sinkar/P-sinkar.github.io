"""Weekly Substack sync.

Reads the Substack feed and creates a small file in _posts/ for every article that
isn't on the site yet. Each file just links out to Substack, so the article shows up
in the Writing list and on the home page. Existing files are never changed, so you
can edit any of them by hand.

Substack often blocks requests from GitHub's servers, so if the direct request fails
the feed is read through rss2json.com (a free public RSS relay) instead.
"""
import os, re, sys, json, html, datetime, urllib.request, urllib.parse, email.utils
import xml.etree.ElementTree as ET

FEED = os.environ.get("FEED_URL", "https://pranavsinkar.substack.com/feed")
POSTS = "_posts"
UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
    return urllib.request.urlopen(req, timeout=30).read()


def from_rss():
    data = get(FEED)
    root = ET.fromstring(data)
    for it in root.iter("item"):
        yield (it.findtext("title"), it.findtext("link"),
               email.utils.parsedate_to_datetime(it.findtext("pubDate")), it.findtext("description"))


def from_relay():
    data = json.loads(get("https://api.rss2json.com/v1/api.json?rss_url=" + urllib.parse.quote(FEED, safe="")))
    if data.get("status") != "ok":
        raise RuntimeError(data.get("message", "relay returned an error"))
    for it in data.get("items", []):
        yield (it.get("title"), it.get("link"),
               datetime.datetime.strptime(it["pubDate"], "%Y-%m-%d %H:%M:%S"), it.get("description"))


items, errors = None, []
for source in (from_rss, from_relay):
    try:
        items = list(source())
        print(f"Read {len(items)} item(s) via {source.__name__}")
        break
    except Exception as e:
        errors.append(f"{source.__name__}: {e}")
if items is None:
    print("::error::Could not read the Substack feed. " + " | ".join(errors))
    sys.exit(1)


def clean(s, limit=None):
    s = html.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    if limit and len(s) > limit:
        s = s[:limit].rsplit(" ", 1)[0] + "…"
    return s


def yaml_str(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


os.makedirs(POSTS, exist_ok=True)
existing = "".join(open(os.path.join(POSTS, f), encoding="utf-8").read() for f in os.listdir(POSTS))

added = 0
for title, link, date, desc in items:
    title = clean(title)
    link = (link or "").strip().split("?")[0]
    if not title or not link or link in existing:
        continue
    slug = re.sub(r"[^a-z0-9]+", "-", link.rstrip("/").rsplit("/", 1)[-1].lower()).strip("-")[:60] or "substack-post"
    desc = clean(desc, 200)
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

print(f"{added} new article(s).")
