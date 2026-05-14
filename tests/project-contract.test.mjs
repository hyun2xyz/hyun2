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
  assert.match(css, /background:\s*#fff/);
  assert.match(css, /color:\s*#000/);
  assert.match(app, /가안:/);
  assert.match(app, /renderArticle/);
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

  assert.match(adminHtml, /data-admin="true"/);
  assert.match(app, /isAdminPage/);
  assert.match(app, /data-panel="index"/);
  assert.match(app, /name="titleSizePt"/);
  assert.match(app, /name="bodySizePt"/);
  assert.match(app, /pt/);
  assert.match(app, /contenteditable="true"/);
  assert.match(app, /data-action="save"/);
  assert.match(app, /localStorage/);
  assert.match(client, /\/auth\/v1\/token\?grant_type=password/);
  assert.match(client, /savePost/);
  assert.match(client, /upsert/);
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
