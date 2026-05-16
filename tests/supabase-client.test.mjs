import { test } from 'node:test';
import assert from 'node:assert/strict';

import { refreshSession, savePost, savePostWithSession } from '../src/supabase-client.js';

const article = {
  id: '4d6d6594-0b48-4301-bac3-1965b3b38aa5',
  title: '가안: 가운데에 놓인 글',
  slug: 'centered-draft',
  author_id: 'user-1',
  excerpt: 'Hyun2',
  content: '본문',
  status: 'published',
  published_at: '2026-05-14T05:34:34.457414+00:00'
};

test('savePost clones locked existing rows when PATCH returns no rows', async () => {
  const calls = [];
  const result = await savePost(article, 'access-token', async (url, options) => {
    calls.push({
      method: options.method,
      url: String(url),
      body: JSON.parse(options.body)
    });

    if (calls.length === 1) {
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify([{ ...article, id: 'new-id', slug: calls[1].body[0].slug }]), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'saved-as-new-row');
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[1].method, 'POST');
  assert.match(calls[1].body[0].slug, /^centered-draft-/);
});

test('savePost treats empty insert representations as an unsaved row', async () => {
  const result = await savePost({ ...article, id: null }, 'access-token', async () => new Response('[]', {
    status: 201,
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

test('savePost refreshes published_at when saving published writing', async () => {
  let payload;

  await savePost(article, 'access-token', async (_url, options) => {
    payload = JSON.parse(options.body);

    return new Response(JSON.stringify([{ ...article, ...payload }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.notEqual(payload.published_at, article.published_at);
  assert.ok(Date.parse(payload.published_at));
});

test('savePost clears published_at when saving draft writing', async () => {
  let payload;

  await savePost({ ...article, status: 'draft' }, 'access-token', async (_url, options) => {
    payload = JSON.parse(options.body);

    return new Response(JSON.stringify([{ ...article, ...payload }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.equal(payload.status, 'draft');
  assert.equal(payload.published_at, null);
});

test('refreshSession calls the Supabase refresh token endpoint', async () => {
  let request;

  const result = await refreshSession('refresh-token', async (url, options) => {
    request = {
      url: String(url),
      method: options.method,
      body: JSON.parse(options.body)
    };

    return new Response(JSON.stringify({
      access_token: 'fresh-access-token',
      refresh_token: 'fresh-refresh-token',
      expires_in: 3600,
      token_type: 'bearer',
      user: { id: 'user-1' }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.equal(result.ok, true);
  assert.equal(result.session.access_token, 'fresh-access-token');
  assert.match(request.url, /\/auth\/v1\/token\?grant_type=refresh_token$/);
  assert.equal(request.method, 'POST');
  assert.deepEqual(request.body, { refresh_token: 'refresh-token' });
});

test('savePostWithSession refreshes an expired token and retries the save', async () => {
  const calls = [];
  const result = await savePostWithSession(article, {
    access_token: 'expired-access-token',
    refresh_token: 'refresh-token'
  }, async (url, options) => {
    calls.push({
      url: String(url),
      method: options.method,
      auth: options.headers.Authorization,
      body: JSON.parse(options.body)
    });

    if (calls.length === 1) {
      return new Response(JSON.stringify({ message: 'JWT expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (calls.length === 2) {
      return new Response(JSON.stringify({
        access_token: 'fresh-access-token',
        refresh_token: 'fresh-refresh-token',
        expires_in: 3600,
        token_type: 'bearer',
        user: { id: 'user-1' }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify([{ ...article, id: 'saved-id' }]), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  });

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'saved-after-refresh');
  assert.equal(result.session.access_token, 'fresh-access-token');
  assert.equal(calls.length, 3);
  assert.match(calls[1].url, /grant_type=refresh_token/);
  assert.equal(calls[2].auth, 'Bearer fresh-access-token');
});
