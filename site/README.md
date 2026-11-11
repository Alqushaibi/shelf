# Shelf website

> The database scripts mentioned below (`schema.sql`, `site.sql`) are not included in the public repository. Ask the maintainer for them.

A static site. Every word, link, colour and section on it is loaded from your Supabase project and edited from `admin.html`.

## Set up (once)

1. In Supabase, open **SQL Editor**, paste all of `site.sql` and click Run. (Run `schema.sql` from the extension first if you have not.)
   First replace `YOUR_ADMIN_EMAIL@example.com` in the file with your own sign-in email (it appears twice, on consecutive lines). The script creates the content table, loads the starter content and makes that email the admin.
2. Copy `config.example.js` to `config.js` and fill in your Supabase project URL and publishable key.
3. Upload this folder to any static host: GitHub Pages, Netlify, Cloudflare Pages or your own server. No build step.
4. Open `admin.html` on the hosted site and sign in.
   - **Email and password** works straight away. If your account was created with Google, set a password first in the Shelf extension under Account > Change password.
   - **Google** needs one setting: in Supabase > Authentication > URL Configuration > Redirect URLs, add the full address of your `admin.html`.

Opening the files directly from your disk (`file://`) does not work; browsers need them served from a web address. To try it on your computer, run `python -m http.server` in this folder and open `http://localhost:8000`.

## Editing

`admin.html` has one panel per part of the site: brand, theme colours, header links, hero, highlights, features, platforms, testimonials, stats, closing banner, donation, questions, footer, and the privacy and terms pages. Lists can be added to, removed from and reordered. Press **Save changes**; visitors see the result on their next page load.

- **Donation**: turn on "Show this section" and paste your donation link (PayPal.me, Ko-fi, Buy Me a Coffee and so on). The same switch shows or hides the Donate button inside the extension.
- **Get Shelf tiles**: paste the store link into a tile once the extension is listed; until then the tile shows as not yet available.
- **Stats**: live totals from the database (members, spaces, collections, saved tabs).
- **Testimonials**: hidden until you add quotes. Only use quotes from real people who agreed.
- **Privacy and terms**: starter drafts are included and marked DRAFT. Review them before publishing; they are not legal advice.

## Admins

The admin list is the `site_admins` table. Add or remove an email there (Supabase > Table Editor) to change who can edit.

## Files

- `index.html`, `privacy.html`, `terms.html` – empty shells filled in by `site.js`
- `site.js`, `site.css` – rendering and styles
- `admin.html`, `admin.js`, `admin.css` – the editor
- `api.js` – Supabase connection; `config.example.js` – template for your own `config.js`
- `site.sql` – database setup and starter content; `seed-content.json` is the same starter content for reference
- `assets/` – logo and favicon
