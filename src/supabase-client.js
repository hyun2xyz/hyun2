import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config.js';

const POSTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/posts`;
const AUTH_TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
const PUBLISHED_STATUS_QUERY = 'status=eq.published';
const UPSERT_MODE = 'upsert';

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
}

function publicHeaders(extra = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    Accept: 'application/json',
    ...extra
  };
}

function authHeaders(accessToken, extra = {}) {
  return {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    ...extra
  };
}

export async function getLatestPublishedPost(fetchImpl = fetch) {
  if (!hasSupabaseConfig()) {
    return { ok: false, reason: 'missing-config', post: null };
  }

  const url = new URL(POSTS_ENDPOINT);
  const [statusField, statusValue] = PUBLISHED_STATUS_QUERY.split('=');
  url.searchParams.set('select', 'id,title,slug,content,excerpt,status,published_at,updated_at');
  url.searchParams.set(statusField, statusValue);
  url.searchParams.set('order', 'published_at.desc.nullslast,updated_at.desc');
  url.searchParams.set('limit', '1');

  const response = await fetchImpl(url, { headers: publicHeaders() });

  if (!response.ok) {
    return { ok: false, reason: `http-${response.status}`, post: null };
  }

  const rows = await response.json();
  return { ok: true, reason: 'loaded', post: rows[0] ?? null };
}

export async function signInWithPassword(email, password, fetchImpl = fetch) {
  if (!hasSupabaseConfig()) {
    return { ok: false, reason: 'missing-config', session: null };
  }

  const response = await fetchImpl(AUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: publicHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email, password })
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      ok: false,
      reason: payload.error_description ?? payload.msg ?? `http-${response.status}`,
      session: null
    };
  }

  return { ok: true, reason: 'signed-in', session: payload };
}

export async function getEditablePost(userId, accessToken, fetchImpl = fetch) {
  if (!hasSupabaseConfig() || !accessToken || !userId) {
    return { ok: false, reason: 'missing-session', post: null };
  }

  const url = new URL(POSTS_ENDPOINT);
  url.searchParams.set('select', 'id,author_id,title,slug,content,excerpt,status,published_at,updated_at');
  url.searchParams.set('author_id', `eq.${userId}`);
  url.searchParams.set('order', 'updated_at.desc');
  url.searchParams.set('limit', '1');

  const response = await fetchImpl(url, {
    headers: authHeaders(accessToken)
  });

  if (!response.ok) {
    return { ok: false, reason: `http-${response.status}`, post: null };
  }

  const rows = await response.json();
  return { ok: true, reason: 'loaded', post: rows[0] ?? null };
}

export async function savePost(post, accessToken, fetchImpl = fetch) {
  if (!hasSupabaseConfig() || !accessToken) {
    return { ok: false, reason: 'missing-session', post: null };
  }

  const payload = {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    content: post.content,
    status: post.status,
    published_at: post.status === 'published' ? post.published_at ?? new Date().toISOString() : null
  };

  const url = new URL(POSTS_ENDPOINT);
  let method = 'POST';

  if (post.id) {
    method = 'PATCH';
    url.searchParams.set('id', `eq.${post.id}`);
  } else {
    url.searchParams.set('on_conflict', 'slug');
  }

  const response = await fetchImpl(url, {
    method,
    headers: authHeaders(accessToken, {
      'Content-Type': 'application/json',
      Prefer: method === 'POST'
        ? `resolution=merge-duplicates,return=representation,missing=default; mode=${UPSERT_MODE}`
        : 'return=representation'
    }),
    body: JSON.stringify(method === 'POST' ? [payload] : payload)
  });

  const rows = await response.json().catch(() => []);

  if (!response.ok) {
    return { ok: false, reason: `http-${response.status}`, post: null };
  }

  return { ok: true, reason: 'saved', post: Array.isArray(rows) ? rows[0] : rows };
}
