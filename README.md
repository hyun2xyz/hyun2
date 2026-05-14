# Hyun2

Personal writing site prototype.

The first slice is intentionally small:

- Centered public article page
- Reader index with title-only links
- Separate author page at `/admin.html`
- Web editor with publish toggle and pt-based title/body type settings
- Supabase REST client prepared for published posts
- RLS schema for public readers and authenticated author writes
- GitHub Pages deployment on every push to `main`

## Local Run

```bash
npm test
npm run build
npm run dev
```

Open `http://127.0.0.1:5179`.

## Supabase

1. Run `supabase/schema.sql` in the connected Supabase project.
2. Put only the project's publishable or anon browser key into `src/supabase-config.js`.
3. Keep service role and secret keys out of this repo.
4. Visit `/admin.html` to edit from the web page. With no key configured, it saves a local draft.

The public page reads published posts only. The admin page can list titles, open drafts, change title/body sizes in `pt`, and save the article body plus type settings.

Safe live setup:

- Apply `supabase/schema.sql` in the Supabase SQL Editor.
- Copy only the public browser key, such as `sb_publishable_...` or the legacy anon key, into `SUPABASE_PUBLISHABLE_KEY`.
- Do not copy `service_role`, `sb_secret_...`, database passwords, or access tokens into this repo.
