# Publishing Shelf on the Chrome Web Store

The first version is uploaded by hand. After that, GitHub sends each new version to the store automatically.

## Switch it on

The workflow file is delivered as `store/chrome-store.yml`. Move it into place once:

```
git mv store/chrome-store.yml .github/workflows/chrome-store.yml
git commit -m "Add Chrome Web Store publishing workflow"
git push
```

Until the settings below exist it does nothing except report that it is not set up.

## How updates work once set up

1. Change the code and raise `"version"` in `extension/manifest.json` (for example `0.6.1` to `0.6.2`).
2. Push to `main`.
3. The "Publish to Chrome Web Store" workflow builds the package, uploads it and submits it for review.
4. Google reviews it. When it passes, Chrome updates everyone who installed Shelf, usually within a day or so.

A push that does not change the version number is not sent to the store. You can also start the workflow by hand from the Actions tab.

## One-time setup

### 1. Developer account

Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), sign in and pay the one-time registration fee. Turn on 2-step verification for that Google account; the store requires it.

### 2. First upload, by hand

1. Get the package. Either use the `store-package.zip` already placed in the repository folder on your computer (it is ignored by Git), or in GitHub open Actions > "Publish to Chrome Web Store" > **Run workflow**, then download `store-package` from that run's Artifacts. To build it yourself instead, run `SUPABASE_URL=... SUPABASE_KEY=... bash store/build.sh` from the repository root (needs `jq` and `zip`).
2. In the dashboard click **New item** and upload `store-package.zip`.
3. Fill in the **Store listing** tab using the text further down, and upload the images from `store/screenshots/`.
4. Fill in the **Privacy** tab using the answers further down.
5. Set **Distribution** to Public and click **Submit for review**.

### 3. The two IDs

- **Publisher ID**: dashboard > Account (Publisher settings).
- **Item ID**: the 32-letter ID on the item's Package tab.

In GitHub > Settings > Secrets and variables > Actions > **Variables**, add `CWS_PUBLISHER_ID` and `CWS_EXTENSION_ID`.

### 4. Permission for GitHub to upload

1. In [Google Cloud Console](https://console.cloud.google.com), in your project, enable the **Chrome Web Store API**.
2. Credentials > Create credentials > OAuth client ID > **Web application**. Add `https://developers.google.com/oauthplayground` as an authorized redirect URI. Keep the client ID and client secret.
3. Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground). In its settings (gear icon) tick "Use your own OAuth credentials" and enter the client ID and secret.
4. In the scopes box enter `https://www.googleapis.com/auth/chromewebstore`, click **Authorize APIs** and sign in with the account that owns the store item.
5. Click **Exchange authorization code for tokens** and copy the **refresh token**.
6. In GitHub > Settings > Secrets and variables > Actions > **Secrets**, add `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` and `CWS_REFRESH_TOKEN`.

Keep the OAuth consent screen's publishing status as **In production**. While it is "Testing", Google expires the refresh token after seven days and uploads stop.

These three values are real secrets. Put them only in GitHub Secrets, never in a file in the repository.

### 5. After the store assigns the extension's ID

The store version has its own ID, different from the unpacked one. In Supabase > Authentication > URL Configuration > Redirect URLs, add `https://<store item ID>.chromiumapp.org/`. Then set the website's download tiles (admin page > Platforms) to the store page address.

## What the package contains

`store/build.sh` copies `extension/`, writes `config.js` from the two Supabase settings, removes developer-only files, removes the `key` from the manifest (the store refuses it) and limits the extension's server access to your own Supabase project.

## Store listing text

**Name:** Shelf – Tab Organizer

**Summary (132 characters max):**
Organize tabs into spaces, nested folders and collections. Search, notes, tasks, sessions, bookmark import and sync.

**Category:** Workflow & Planning (or Productivity > Tools)

**Description:**

Shelf turns a crowded tab strip into something you can find your way around.

• Spaces, nested folders and collapsible collections for your saved tabs
• Drag tabs in, and drag links and collections to reorder them
• Notes and tasks on every collection
• One search (Ctrl+K) across open tabs, saved links, notes and tasks
• Sessions saved automatically, so a crash does not lose your windows
• Put idle tabs to sleep and close duplicates
• Import bookmarks from your browser or a file, with folders kept
• Optional account: sync across browsers and share a space with others
• Works without an account, with everything kept in your browser

Shelf does not replace your new tab page unless you switch that on in Settings. It is open source.

## Privacy tab answers

**Single purpose:** Shelf saves, organizes and restores browser tabs.

**Permission justifications:**

- `tabs`: to list the open tabs so the user can save, switch to, close, sleep or restore them. Shelf reads only each tab's title and address.
- `storage` and `unlimitedStorage`: to keep the user's saved tabs, folders, notes, tasks, session history and settings in the browser. Large bookmark imports can exceed the default limit.
- `bookmarks`: to read the browser's bookmarks when the user chooses "Import bookmarks > This browser". Shelf never changes or deletes bookmarks.
- `alarms`: to save sessions on a timer and to put idle tabs to sleep when the user has turned those options on.
- `favicon`: to show each saved site's icon next to its title.
- Host permission for the Supabase project address: to sign the user in and sync their saved tabs with their own account. No other site is contacted.

**Remote code:** No. All code is in the package.

**Data the extension handles** (tick these in the data-usage section):

- *Personally identifiable information*: the email address, only if the user creates an account.
- *Authentication information*: sign-in tokens kept in the browser; passwords are sent to the sign-in service and not stored by the extension.
- *Web history*: the titles and addresses of tabs the user saves, and of open tabs when sessions are saved. Session history stays in the browser; saved tabs sync only if the user signs in.
- *Website content*: No.

Certify all three statements: data is not sold, not used for unrelated purposes, and not used for creditworthiness or lending.

**Privacy policy URL:** your site's `privacy.html`. Make sure the published text matches what is listed here before submitting.

## Images

`store/screenshots/` has four 1280×800 screenshots made with sample data and one 440×280 small promo tile. Replace them with your own captures whenever you like; the search screenshot shows "localhost" under one tab because it was captured on a test page.
