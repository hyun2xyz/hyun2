import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase-config.js';

const POSTS_ENDPOINT = `${SUPABASE_URL}/rest/v1/posts`;
const PUBLISHED_STATUS_QUERY = 'status=eq.published';

export function hasSupabaseConfig() {
  return Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
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

  const response = await fetchImpl(url, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    return { ok: false, reason: `http-${response.status}`, post: null };
  }

  const rows = await response.json();
  return { ok: true, reason: 'loaded', post: rows[0] ?? null };
}
