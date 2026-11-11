# Shelf

A tab organizer for Chromium browsers (Chrome, Edge, Brave) with a small website and admin page.

Shelf sorts tabs into spaces, nested folders and collapsible collections, with notes and tasks, one search for everything, automatic session saving, sleeping idle tabs, bookmark import, sync across browsers and per-space sharing.

## What is in this repository

| Folder | What it is |
| --- | --- |
| `extension/` | The browser extension (Manifest V3, plain JavaScript, no build step) |
| `site/` | The public website and its admin editor (static files) |
| `brand/` | Logo files |
| `.github/workflows/pages.yml` | Publishes `site/` to GitHub Pages |

Each folder has its own README with details.

## Run your own copy

You need a free [Supabase](https://supabase.com) project for accounts, sync, sharing and the website content. Without one, the extension still works with data kept in the browser.

1. **Database.** The two database scripts (`schema.sql` for the extension and `site.sql` for the website) are not included in this repository. Ask the maintainer for them, then run them in Supabase > SQL Editor.
2. **Settings.** In both `extension/` and `site/`, copy `config.example.js` to `config.js` and fill in your project URL and **publishable** key.
3. **Extension.** Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose the `extension` folder.
4. **Website.** Host the `site` folder on any static host, or use the included GitHub Pages workflow:
   - Repository Settings > Pages > Source: **GitHub Actions**
   - Repository Settings > Secrets and variables > Actions > **Variables**: add `SUPABASE_URL` and `SUPABASE_KEY` (the publishable key)
   - Push to `main`, or run the "Deploy website" workflow by hand
5. **Sign-in addresses.** In Supabase > Authentication > URL Configuration, set the Site URL to your website and add your `admin.html` address to Redirect URLs.

## Download

The deploy workflow packages the `extension` folder as `downloads/shelf-extension.zip` on the website, already set up for the site's own Supabase project. To install it: unzip, open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose the unzipped `shelf-extension` folder.

## Keys and secrets

- `config.js` is in `.gitignore`. Do not commit it.
- Only the **publishable** key (`sb_publishable_...`) belongs in `config.js` or in the repository variables. It is sent to every visitor's browser by design; the database's row-level security rules are what protect the data.
- Never put the database password, a secret key (`sb_secret_...`) or a `service_role` key anywhere in this repository, in `config.js`, or in the extension.
- `extension/manifest.json` contains a `key` field. It is a public key that only keeps the extension's ID stable for unpacked installs. Remove it or replace it with your own if you fork.

## Contributing

Issues and pull requests are welcome. Please keep the code dependency-free (no build step) and describe how you tested a change.

## Licence

The code is released under the [MIT License](LICENSE).

The "Shelf" name and the logo files in `brand/` and `site/assets/` are not covered by that licence. If you publish a modified version, please give it a different name and logo.
