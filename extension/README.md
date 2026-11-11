# Shelf – Tab Organizer (v0.4, with accounts and sync)

> The database scripts mentioned below (`schema.sql`, `site.sql`) are not included in the public repository. Ask the maintainer for them.

A Chrome / Edge extension that organizes tabs into spaces, nested folders and collections.

## Install

1. Put this folder somewhere permanent. For accounts and sync, copy `config.example.js` to `config.js` and fill in your Supabase project (see below). Without an account Shelf still needs the file to exist.
2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose this `extension` folder.
5. Click the Shelf toolbar icon, or press `Alt+Shift+S`, to open the dashboard.

Shelf does not replace the new tab page unless you ask it to: **Settings** has switches for opening Shelf at browser start-up and in every new tab, and the address to paste for the Home button.

## What works

- **Spaces, nested folders, collections** – any depth. Drag a collection or folder onto another folder (in the page or the sidebar) to move it.
- **Saving tabs** – drag an open tab onto a collection, use the + on a tab, or "Save all".
- **Collapse and expand** – the arrow on a collection folds it to one line; "Collapse all" / "Expand all" does the whole view. Remembered per browser.
- **Notes and tasks** – per link (title and note) and per collection (checklist and note).
- **Search and commands** – `Ctrl+K` searches open tabs in every window, saved links, notes, tasks, collections and folders. Type `>` for commands only.
- **Smart group** – proposes collections from unsaved open tabs that share a site; nothing is created until you confirm.
- **Sessions** – every window is auto-saved on a timer; restore a session or turn it into a collection.
- **Memory** – put idle tabs to sleep now or automatically; close duplicate tabs.
- **Import bookmarks** – from this browser, a bookmarks `.html` export, a JSON or CSV export from another tool, or a pasted list. Folder structure is kept as nested folders, duplicates are skipped.

## Accounts, sync and sharing

One-time setup in your Supabase project:

1. **SQL Editor** – paste all of `schema.sql` and click Run.
2. **Authentication › URL Configuration › Redirect URLs** – add `https://<your-extension-id>.chromiumapp.org/` (recommended for Google sign-in; it also works without it). The ID is shown on the extension's card in `chrome://extensions`.
3. **Authentication › Sign In / Providers** – Email is on by default. For Google, open the Google row, paste the Client ID and Client Secret and enable it.

Then in Shelf, click **Sign in to sync** at the bottom of the sidebar.

- **Sync** – spaces, folders, collections, notes and tasks sync to every browser signed in to the account. Shelf syncs when it opens, a moment after each change, and every 30 seconds while open. If two browsers change the same collection, the most recent change wins.
- **Sharing** – open a space and click **Share** to add collaborators by email as "Can edit" or "Can view", or to make the space private again. A space is private until you add someone.
- **Email confirmation and password reset** – new email accounts must confirm their address from an emailed link before signing in ("Send again" resends it). "Forgot password?" emails a link to the website's `auth.html` page, where a new password is chosen. Both need the Supabase Site URL set to the website's address.
- **Signed-in browsers** – the Account screen lists every browser and can sign out one, all others, or all of them. Signing out removes Shelf data from that browser; it returns on the next sign-in.

## Donation button

When the site admin turns donations on (see the website's `admin.html`), a Donate button appears at the bottom of the sidebar. It needs `site.sql` from the website folder to have been run in Supabase.

## Not in this version

- Session history and the sleep / auto-save rules stay on each browser and are not synced.
- Sharing is per space, not per collection.
- Checking imported links for dead pages.

## Files

- `manifest.json` – extension manifest (Manifest V3)
- `background.js` – toolbar action, auto-save and auto-sleep timer
- `store.js` – local data layer and change tracking
- `cloud.js` – sign-in, sync, sharing and signed-in browsers (Supabase REST)
- `config.example.js` – template for your own `config.js` (Supabase project URL and publishable key)
- `schema.sql` – database tables and access rules to run once in Supabase
- `importers.js` – bookmark parsers
- `app.html`, `app.css`, `app.js` – the dashboard
