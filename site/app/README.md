# Shelf mobile web app

Shelf for Android phones and tablets (it also works in any other mobile or desktop browser). It uses the same account and data as the extension.

## Where it goes

Put this `app` folder inside the website folder, so the files are at `site/app/`. It reads the Supabase settings from `site/config.js`, the same file the website uses. After deploying, it is at `<your site>/app/`.

## One Supabase setting

For "Continue with Google", add the app's address to Supabase > Authentication > URL Configuration > Redirect URLs, for example `https://alqushaibi.github.io/shelf/app/`. Email and password sign-in needs no setting.

## Using it on Android

- Open the address in Chrome (or another browser), then use the browser menu > "Add to Home screen" / "Install app".
- Once installed, "Shelf" appears in Android's Share menu: share any page to it and choose a collection.

## What it does

Spaces, nested folders and collapsible collections; open, add, edit and remove links; tasks and notes; search; shared spaces (view-only spaces cannot be edited); sign out of this or all browsers; the Donate button when the site admin has it switched on. The last loaded data stays readable without a connection.

## What it cannot do

A web page cannot see or control the browser's tabs, so there is no open-tab list, session saving, sleeping tabs or duplicate clean-up here. Managing collaborators and importing bookmarks are done in the desktop extension.
