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
  assert.match(css, /--bg:\s*#fff/);
  assert.match(css, /--fg:\s*#000/);
  assert.match(html, /Gowun\+Batang/);
  assert.match(app, /가안:/);
  assert.match(app, /renderArticle/);
  assert.match(app, /article__date/);
  assert.match(app, /formatDate/);
  assert.doesNotMatch(app, /article__meta/);
  assert.doesNotMatch(app, /renderArticle\(local\)/);
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
  assert.match(client, /status', 'neq\.archived'/);
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
  assert.match(app, /data-action="publish"/);
  assert.match(app, /aria-pressed="\$\{article\.status === 'published'\}"/);
  assert.match(app, /status = publishEnabled\(\) \? 'published' : 'draft'/);
  assert.match(app, /saved to Supabase as draft/);
  assert.match(app, /data-action="trash"/);
  assert.match(app, /status:\s*'archived'/);
  assert.match(app, /trash/);
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

test('reader and editor support index-only, mobile top, word wrapping, annotations, and underline marks', async () => {
  const app = await file('src/app.js');
  const css = await file('styles.css');

  assert.match(app, /routeParams\.has\('index'\)/);
  assert.match(app, /renderIndexPage/);
  assert.match(app, /href="\.\/\?index"/);
  assert.match(app, /data-action="top"/);
  assert.match(app, /scrollTo\(\{\s*top:\s*0,\s*behavior:\s*'smooth'/);
  assert.match(app, /renderTopControls/);
  assert.match(app, /data-action="lang-toggle"/);
  assert.match(app, /data-action="theme-toggle"/);
  assert.match(app, /toggleLang/);
  assert.match(app, /한/);
  assert.match(app, /EN/);
  assert.match(app, /themeLabel/);
  assert.match(app, /DA/);
  assert.match(app, /LA/);
  assert.match(app, /data-action="underline"/);
  assert.match(app, /execCommand\('underline'\)/);
  assert.match(app, /textDecoration/);
  assert.match(app, /data-action="note"/);
  assert.match(app, /range\.collapse\(false\)/);
  assert.match(app, /note-dot/);
  assert.match(app, /data-note/);
  assert.match(app, /data-url/);
  assert.match(app, /lineHeight/);
  assert.doesNotMatch(app, /data-action="apply-line"/);
  assert.doesNotMatch(app, /selectedParagraphs/);
  assert.match(app, /reader-chrome/);
  assert.match(app, /attachReaderChromeDissolve/);
  assert.match(app, /setTimeout\(hide,\s*160\)/);
  assert.match(app, /data-line-height/);
  assert.match(app, /sanitizeInlineHtml/);
  assert.match(app, /block\.html/);
  assert.match(app, /window\.prompt/);
  assert.match(css, /word-break:\s*keep-all/);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.match(css, /\.reader-index[\s\S]*position:\s*fixed/);
  assert.match(css, /\.reader-layout[\s\S]*display:\s*block/);
  assert.doesNotMatch(css, /display:\s*grid|grid-template/);
  assert.match(css, /\.to-top-button/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /@media \(max-width:\s*720px\)/);
  assert.match(css, /\.top-controls/);
  assert.match(css, /transition:\s*opacity 140ms ease/);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.top-controls[\s\S]*position:\s*static/);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*\.reader-index[\s\S]*position:\s*static/);
  assert.match(css, /\.button-link/);
  assert.match(css, /\.editor__tools/);
  assert.match(css, /\.tool-button/);
  assert.match(css, /font-size:\s*0\.5/);
  assert.match(css, /\.note-dot/);
  assert.match(css, /color:\s*#1c7fb8/);
  assert.match(css, /content:\s*"ㅇ"/);
  assert.match(css, /\.note-dot\.is-open::after/);
  assert.match(css, /text-decoration-style:\s*solid/);
  assert.match(css, /\.index-page[\s\S]*justify-content:\s*center/);
  assert.match(css, /\.index-page__row[\s\S]*justify-content:\s*space-between/);
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
