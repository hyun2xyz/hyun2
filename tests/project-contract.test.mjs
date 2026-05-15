import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = new URL('../', import.meta.url);

async function file(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('home page renders a centered writing draft', async () => {
  const html = await file('index.html');
  const css = await file('styles.css');
  const app = await file('src/app.js');

  assert.match(html, /id="article-root"/);
  assert.doesNotMatch(html, /data-admin/);
  assert.match(html, /src="\.\/src\/app\.js\?v=/);
  assert.match(css, /--bg:\s*#f7f0df/);
  assert.match(css, /--fg:\s*#1c1510/);
  assert.match(html, /Gowun\+Batang/);
  assert.match(app, /가안:/);
  assert.match(app, /renderArticle/);
  assert.match(app, /article__date/);
  assert.match(app, /formatDate/);
  assert.doesNotMatch(app, /article__meta/);
  assert.doesNotMatch(app, /renderArticle\(local\)/);
});

test('handmade reference design uses paper, copper thread, and stable cache busting', async () => {
  const html = await file('index.html');
  const adminHtml = await file('admin.html');
  const app = await file('src/app.js');
  const css = await file('styles.css');

  assert.match(html, /styles\.css\?v=20260516-handmade/);
  assert.match(adminHtml, /styles\.css\?v=20260516-handmade/);
  assert.match(css, /--paper:\s*#fff8ea/);
  assert.match(css, /--copper:\s*#a65a2a/);
  assert.match(css, /--thread:\s*#c99868/);
  assert.match(css, /repeating-linear-gradient/);
  assert.match(css, /border-left:\s*1px dashed var\(--thread\)/);
  assert.match(css, /text-decoration-style:\s*wavy/);
  assert.match(css, /box-shadow:\s*2px 2px 0/);
  assert.match(css, /data-theme="dark"/);
  assert.doesNotMatch(css, /prefers-color-scheme:\s*dark/);
  assert.match(app, /function currentTheme\(\)[\s\S]*return 'light';\n}/);
});

test('Supabase client is wired to the target project without secret keys', async () => {
  const config = await file('src/supabase-config.js');
  const client = await file('src/supabase-client.js');

  assert.match(config, /ltmkpotvrxgoyyuzfvlv\.supabase\.co/);
  assert.doesNotMatch(config, /service_role|sb_secret_/i);
  assert.match(client, /\/rest\/v1\/posts/);
  assert.match(client, /status=eq\.published/);
  assert.match(client, /listPostTitles/);
  assert.match(client, /getPostBySlug/);
});

test('admin page can sign in, list titles, set pt sizes, and save writing', async () => {
  const adminHtml = await file('admin.html');
  const app = await file('src/app.js');
  const client = await file('src/supabase-client.js');
  const css = await file('styles.css');

  assert.match(adminHtml, /data-admin="true"/);
  assert.match(adminHtml, /src="\.\/src\/app\.js\?v=/);
  assert.match(app, /isAdminPage/);
  assert.match(app, /supabase-client\.js\?v=/);
  assert.match(app, /data-panel="index"/);
  assert.match(app, /name="titleSizePt"/);
  assert.match(app, /name="bodySizePt"/);
  assert.match(app, /name="bodyLineHeight"/);
  assert.match(app, /name="indentPt"/);
  assert.match(app, /bodyLineHeight/);
  assert.match(app, /indentPt/);
  assert.match(app, /pt/);
  assert.match(app, /contenteditable="true"/);
  assert.match(app, /insertImageFiles/);
  assert.match(app, /data-block-type="image"/);
  assert.match(app, /FileReader/);
  assert.match(app, /data-action="save"/);
  assert.match(app, /data-action="theme"/);
  assert.match(app, /savePostWithSession/);
  assert.match(app, /refreshSessionIfNeeded/);
  assert.doesNotMatch(app, /data-field="status"/);
  assert.doesNotMatch(app, /status-toggle/);
  assert.doesNotMatch(app, /saved as draft/);
  assert.doesNotMatch(app, /turn on publish/);
  assert.match(app, /localStorage/);
  assert.match(client, /\/auth\/v1\/token\?grant_type=password/);
  assert.match(client, /savePost/);
  assert.match(client, /upsert/);
  assert.match(client, /no-returned-row/);
  assert.match(client, /saved-as-new-row/);
  assert.match(client, /cloneLockedPost/);
  assert.match(app, /reader is updated/);
  assert.match(app, /dedupePostTitles/);
  assert.match(css, /--body-line-height/);
  assert.match(css, /--paragraph-gap/);
  assert.match(css, /--paragraph-indent/);
  assert.match(css, /hyphens:\s*auto/);
  assert.match(css, /data-theme="dark"/);
  assert.match(css, /#0645ff|#06f|blue/i);
  assert.match(css, /Gowun Batang/);
  assert.match(app, /--paragraph-gap/);
  assert.doesNotMatch(app, /supabase ready/);
});

test('database schema enables RLS and public readers only see published posts', async () => {
  const schema = await file('supabase/schema.sql');

  assert.match(schema, /create table if not exists public\.posts/i);
  assert.match(schema, /enable row level security/i);
  assert.match(schema, /to anon/i);
  assert.match(schema, /status = 'published'/i);
  assert.match(schema, /auth\.uid\(\)/i);
  assert.match(schema, /set_post_updated_at/i);
  assert.match(schema, /authenticated users can manage posts/i);
});

test('GitHub push can deploy the static site through Pages actions', async () => {
  const packageJson = await file('package.json');
  const workflow = await file('.github/workflows/deploy.yml');
  const buildScript = await file('scripts/build-pages.mjs');

  assert.match(packageJson, /"build"/);
  assert.match(workflow, /deploy-pages/);
  assert.match(workflow, /branches:\s*\[\s*main\s*\]/);
  assert.match(buildScript, /dist/);
  assert.match(buildScript, /admin\.html/);
});
