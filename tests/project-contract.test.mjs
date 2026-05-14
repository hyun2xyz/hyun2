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
  assert.match(css, /place-items:\s*center/);
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
});

test('database schema enables RLS and public readers only see published posts', async () => {
  const schema = await file('supabase/schema.sql');

  assert.match(schema, /create table if not exists public\.posts/i);
  assert.match(schema, /enable row level security/i);
  assert.match(schema, /to anon/i);
  assert.match(schema, /status = 'published'/i);
  assert.match(schema, /auth\.uid\(\)/i);
});

test('GitHub push can deploy the static site through Pages actions', async () => {
  const packageJson = await file('package.json');
  const workflow = await file('.github/workflows/deploy.yml');
  const buildScript = await file('scripts/build-pages.mjs');

  assert.match(packageJson, /"build"/);
  assert.match(workflow, /deploy-pages/);
  assert.match(workflow, /branches:\s*\[\s*main\s*\]/);
  assert.match(buildScript, /dist/);
});
