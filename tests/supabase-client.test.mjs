import { test } from 'node:test';
import assert from 'node:assert/strict';

import { savePost } from '../src/supabase-client.js';

const article = {
  id: '4d6d6594-0b48-4301-bac3-1965b3b38aa5',
  title: '가안: 가운데에 놓인 글',
  slug: 'centered-draft',
  author_id: 'user-1',
  excerpt: 'Hyun2',
  content: '본문',
  status: 'published'
};

test('savePost treats empty Supabase representations as an unsaved row', async () => {
  const result = await savePost(article, 'access-token', async () => new Response('[]', {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  }));

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'no-returned-row');
  assert.equal(result.post, null);
});

test('savePost uses Supabase REST upsert headers that return the saved row', async () => {
  let preferHeader = '';

  await savePost({ ...article, id: null }, 'access-token', async (_url, options) => {
    preferHeader = options.headers.Prefer;

    return new Response(JSON.stringify([{ ...article, id: 'saved-id' }]), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.match(preferHeader, /resolution=merge-duplicates/);
  assert.match(preferHeader, /return=representation/);
  assert.doesNotMatch(preferHeader, /mode=upsert|;/);
});
