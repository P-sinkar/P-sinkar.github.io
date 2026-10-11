# My personal website

A plain Jekyll site. GitHub Pages builds it automatically, so there's nothing to install and hosting is free.

## Publish it (about 10 minutes, one time)

1. Sign in to GitHub and create a new **public** repository named exactly `<your-username>.github.io`.
2. On the empty repo page, click **uploading an existing file**, then drag in *everything inside* this folder (including the `_layouts`, `_data`, `_drafts` and `assets` folders). Click **Commit changes**.
3. Go to **Settings → Pages**. Under *Build and deployment*, set Source to **Deploy from a branch**, Branch to **main** and folder to **/ (root)**. Save.
4. Wait a minute or two. Your site is live at `https://<your-username>.github.io`. The **Actions** tab shows build progress, and a red ✗ there means a typo somewhere.
5. Open `_config.yml` on GitHub (pencil icon), fill in your email, LinkedIn and GitHub links, and commit.

If you'd rather use a repo named something else, like `website`, set `baseurl: "/website"` in `_config.yml`. The site will then be at `https://<your-username>.github.io/website/`.

A custom domain can be added later under Settings → Pages. Nothing needs to change in the site itself.

## Add things later

Everything can be done in GitHub's web editor. Each commit rebuilds the site in about a minute.

**An article.** On the repo's main page, choose *Add file → Create new file* and type the name `_posts/2026-10-20-my-title.md` (typing the slash creates the folder), and paste in the template from `_drafts/example-article.md`. Write in Markdown and commit. The date in the filename is the publish date, and the article appears at `/writing/my-title/`. Set `kind:` to `Essay`, `Note`, `Research` or `Experiment` so readers know how settled it is. Add `sources:` for research.

**A reading recommendation.** Edit `_data/reading.yml` and add an entry:

```yaml
- title: Title
  author: Author
  category: Book
  url: https://...
  note: Why it's worth reading.
```

**A tool.** Edit `_data/tools.yml` and copy one of the existing entries. Only `name`, `description` and `status` are required. Downloadable zips go in `assets/downloads/`.

**Pages and wording.** The short home text is `index.html` and the About page is `about.md`; the home quote and the AI note are in `_config.yml`; colours, fonts and the background photo settings are in `assets/style.css`, and the photos themselves in `assets/img/`.

## Structure

```
_config.yml        site name, your links, URL settings
index.html         home
writing.html       writing archive (lists _posts automatically)
tools.html         reads _data/tools.yml
reading.html       reads _data/reading.yml
_layouts/home.html one-screen home page (coast to cosmos)
_includes/nav.html the four-item menu
_posts/            published articles (Markdown)
_drafts/           unpublished drafts and the article template
_layouts/          page templates
assets/style.css   all styling
```
