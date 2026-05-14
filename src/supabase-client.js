import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config.js';

const POSTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/posts`;
const AUTH_TOKEN_ENDPOINT = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
const PUBLISHED_STATUS_QUERY = 'status=eq.published';
const upsertPreferHeader = 'resolution=merge-duplicates,return=representation';
const POST_SELECT = 'id,author_id,title,slug,content,excerpt,status,published_at,updated_at';
const TITLE_SELECT = 'id,title,slug,status,published_at,updated_at';

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

function uniqueSlug(slug) {
  const safeSlug = String(slug || 'post')
    .trim()
    .replace(/-+$/g, '') || 'post';
  const suffix = new Date().toISOString()
    .replace(/\D/g, '')
    .slice(0, 14);

  return `${safeSlug}-${suffix}`;
}

function payloadForPost(post, slug = post.slug) {
  return {
    title: post.title,
    slug,
    author_id: post.author_id,
    excerpt: post.excerpt,
    content: post.content,
    status: post.status,
    published_at: post.status === 'published' ? new Date().toISOString() : null
  };
}

function rowFromResponse(rows) {
  return Array.isArray(rows) ? rows[0] : rows;
}

async function writePost(post, accessToken, fetchImpl, options = {}) {
  const method = post.id && !options.forceInsert ? 'PATCH' : 'POST';
  const payload = payloadForPost(post, options.slug ?? post.slug);
  const url = new URL(POSTS_ENDPOINT);

  if (method === 'PATCH') {
    url.searchParams.set('id', `eq.${post.id}`);
  } else {
    url.searchParams.set('on_conflict', 'slug');
  }

  const response = await fetchImpl(url, {
    method,
    headers: authHeaders(accessToken, {
      'Content-Type': 'application/json',
      Prefer: method === 'POST'
        ? upsertPreferHeader
        : 'return=representation'
    }),
    body: JSON.stringify(method === 'POST' ? [payload] : payload)
  });

  const rows = await response.json().catch(() => []);
  return { method, response, rows, post: rowFromResponse(rows) };
}

async function cloneLockedPost(post, accessToken, fetchImpl) {
  const result = await writePost(post, accessToken, fetchImpl, {
    forceInsert: true,
    slug: uniqueSlug(post.slug)
  });

  if (!result.response.ok) {
    return { ok: false, reason: `http-${result.response.status}`, post: null };
  }

  if (!result.post) {
    return { ok: false, reason: 'no-returned-row', post: null };
  }

  return { ok: true, reason: 'saved-as-new-row', post: result.post };
}

export async function getLatestPublishedPost(fetchImpl = fetch) {
  if (!hasSupabaseConfig()) {
    return { ok: false, reason: 'missing-config', post: null };
  }

  const url = new URL(POSTS_ENDPOINT);
  const [statusField, statusValue] = PUBLISHED_STATUS_QUERY.split('=');
  url.searchParams.set('select', POST_SELECT);
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

export async function listPostTitles(accessToken = null, fetchImpl = fetch) {
  if (!hasSupabaseConfig()) {
    return { ok: false, reason: 'missing-config', posts: [] };
  }

  const url = new URL(POSTS_ENDPOINT);
  url.searchParams.set('select', TITLE_SELECT);
  url.searchParams.set('order', 'published_at.desc.nullslast,updated_at.desc');

  const headers = accessToken ? authHeaders(accessToken) : publicHeaders();
  if (!accessToken) {
    const [statusField, statusValue] = PUBLISHED_STATUS_QUERY.split('=');
    url.searchParams.set(statusField, statusValue);
  }

  const response = await fetchImpl(url, { headers });

  if (!response.ok) {
    return { ok: false, reason: `http-${response.status}`, posts: [] };
  }

  const rows = await response.json();
  return { ok: true, reason: 'loaded', posts: rows };
}

export async function getPostBySlug(slug, accessToken = null, fetchImpl = fetch) {
  if (!hasSupabaseConfig() || !slug) {
    return { ok: false, reason: 'missing-slug', post: null };
  }

  const url = new URL(POSTS_ENDPOINT);
  url.searchParams.set('select', POST_SELECT);
  url.searchParams.set('slug', `eq.${slug}`);
  url.searchParams.set('limit', '1');

  const headers = accessToken ? authHeaders(accessToken) : publicHeaders();
  if (!accessToken) {
    const [statusField, statusValue] = PUBLISHED_STATUS_QUERY.split('=');
    url.searchParams.set(statusField, statusValue);
  }

  const response = await fetchImpl(url, { headers });

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
  url.searchParams.set('select', POST_SELECT);
  url.searchParams.set('or', `(author_id.eq.${userId},author_id.is.null)`);
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

  const result = await writePost(post, accessToken, fetchImpl);

  if (!result.response.ok) {
    return { ok: false, reason: `http-${result.response.status}`, post: null };
  }

  if (!result.post && result.method === 'PATCH') {
    return cloneLockedPost(post, accessToken, fetchImpl);
  }

  if (!result.post) {
    return { ok: false, reason: 'no-returned-row', post: null };
  }

  return { ok: true, reason: 'saved', post: result.post };
}
