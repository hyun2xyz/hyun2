import {
  getEditablePost,
  getLatestPublishedPost,
  getPostBySlug,
  hasSupabaseConfig,
  listPostTitles,
  refreshSession,
  savePostWithSession,
  signInWithPassword
} from './supabase-client.js?v=20260514-2145';

const LOCAL_DRAFT_KEY = 'hyun2.localDraft';
const SESSION_KEY = 'hyun2.supabaseSession';
const TYPE_SETTINGS_KEY = 'hyun2.typeSettings';
const DEFAULT_TYPE_SETTINGS = {
  titleSizePt: 44,
  bodySizePt: 20,
  bodyLineHeight: 1.85
};

const fallbackArticle = {
  title: '가안: 가운데에 놓인 글',
  slug: 'centered-draft',
  excerpt: 'Hyun2 첫 번째 발행면',
  content: [
    '이곳은 HTML을 직접 고치지 않고, 웹 안에서 글을 쓰고 발행하기 위한 작은 시작점입니다.',
    '지금은 한 편의 글이 화면 가운데 조용히 놓여 있습니다. 다음 단계에서는 Supabase의 published 글을 읽어오고, 나만 들어갈 수 있는 쓰기 화면을 붙이면 됩니다.',
    '글은 페이지의 장식보다 먼저 오고, 도구는 글을 방해하지 않는 만큼만 남깁니다.'
  ].join('\n\n'),
  status: 'published',
  updated_at: new Date().toISOString()
};

const routeParams = new URLSearchParams(window.location.search);
const isAdminPage = document.body.dataset.admin === 'true'
  || routeParams.has('edit')
  || routeParams.has('admin');

function splitParagraphs(content) {
  if (Array.isArray(content)) return content;
  return String(content ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function slugify(value) {
  return String(value || 'untitled')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function clampPt(value, fallback) {
  const next = Number.parseFloat(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(120, Math.max(8, next));
}

function clampLineHeight(value, fallback) {
  const next = Number.parseFloat(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(3, Math.max(1, next));
}

function normalizeTypeSettings(settings = {}) {
  return {
    titleSizePt: clampPt(settings.titleSizePt, DEFAULT_TYPE_SETTINGS.titleSizePt),
    bodySizePt: clampPt(settings.bodySizePt, DEFAULT_TYPE_SETTINGS.bodySizePt),
    bodyLineHeight: clampLineHeight(settings.bodyLineHeight, DEFAULT_TYPE_SETTINGS.bodyLineHeight)
  };
}

function decodeContent(content) {
  const raw = String(content ?? '');

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.body === 'string') {
      return {
        body: parsed.body,
        style: normalizeTypeSettings(parsed.style)
      };
    }
  } catch {
    // Plain text is the default authoring format.
  }

  return {
    body: raw,
    style: normalizeTypeSettings()
  };
}

function encodeContent(body, style) {
  return JSON.stringify({
    body: String(body ?? ''),
    style: normalizeTypeSettings(style)
  }, null, 2);
}

function loadTypeSettings(fallback = DEFAULT_TYPE_SETTINGS) {
  try {
    return normalizeTypeSettings(JSON.parse(localStorage.getItem(TYPE_SETTINGS_KEY)) ?? fallback);
  } catch {
    return normalizeTypeSettings(fallback);
  }
}

function saveTypeSettings(settings) {
  localStorage.setItem(TYPE_SETTINGS_KEY, JSON.stringify(normalizeTypeSettings(settings)));
}

function loadLocalDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(LOCAL_DRAFT_KEY)) ?? null;
    return draft ? normalizeArticle(draft) : null;
  } catch {
    return null;
  }
}

function saveLocalDraft(article) {
  localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify({
    ...article,
    updated_at: new Date().toISOString()
  }));
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) ?? null;
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

function decodeBase64Url(value) {
  const normalized = String(value)
    .replaceAll('-', '+')
    .replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return atob(padded);
}

function accessTokenExpiryMs(session) {
  const expiresAt = Number(session?.expires_at);
  if (Number.isFinite(expiresAt)) return expiresAt * 1000;

  try {
    const [, payload] = String(session?.access_token ?? '').split('.');
    if (!payload) return 0;
    const parsed = JSON.parse(decodeBase64Url(payload));
    return Number(parsed.exp) * 1000;
  } catch {
    return 0;
  }
}

function sessionNeedsRefresh(session) {
  if (!session?.refresh_token) return false;
  const expiryMs = accessTokenExpiryMs(session);
  return Boolean(expiryMs && expiryMs - Date.now() < 60000);
}

async function refreshStoredSession(session) {
  const result = await refreshSession(session?.refresh_token);
  if (!result.ok) return result;

  const nextSession = {
    ...session,
    ...result.session
  };
  saveSession(nextSession);

  return {
    ...result,
    session: nextSession
  };
}

async function refreshSessionIfNeeded(session) {
  if (!sessionNeedsRefresh(session)) {
    return { ok: true, reason: 'current', session };
  }

  return refreshStoredSession(session);
}

function normalizeArticle(article = fallbackArticle) {
  const merged = { ...fallbackArticle, ...article };
  const decoded = decodeContent(merged.content);
  const style = normalizeTypeSettings(merged.style ?? decoded.style ?? loadTypeSettings());

  return {
    ...merged,
    content: decoded.body,
    style
  };
}

function currentArticle() {
  return normalizeArticle(window.hyun2Article ?? loadLocalDraft() ?? fallbackArticle);
}

function setCurrentArticle(article) {
  window.hyun2Article = normalizeArticle(article);
}

function applyTypeStyle(container, settings) {
  const style = normalizeTypeSettings(settings);
  const paragraphGap = Math.max(0.35, style.bodyLineHeight * 0.55).toFixed(2);
  container.style.setProperty('--title-size', `${style.titleSizePt}pt`);
  container.style.setProperty('--body-size', `${style.bodySizePt}pt`);
  container.style.setProperty('--body-line-height', style.bodyLineHeight);
  container.style.setProperty('--paragraph-gap', `${paragraphGap}em`);
}

function articleMarkup(article) {
  const view = normalizeArticle(article);
  const paragraphs = splitParagraphs(view.content);

  return `
    <h1 class="article__title">${escapeHtml(view.title)}</h1>
    <div class="article__body">
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
    </div>
  `;
}

export function renderArticle(article) {
  const root = document.querySelector('#article-root');
  const view = normalizeArticle(article);
  applyTypeStyle(root, view.style);
  root.innerHTML = articleMarkup(view);
}

function renderReaderIndex(posts, selectedSlug) {
  if (!posts.length) return '';

  return `
    <aside class="reader-index" data-panel="index" aria-label="글 목차">
      <div class="index-title">index</div>
      <nav>
        ${posts.map((post) => `
          <a class="${post.slug === selectedSlug ? 'is-selected' : ''}" href="./?post=${encodeURIComponent(post.slug)}">
            ${escapeHtml(post.title)}
          </a>
        `).join('')}
      </nav>
    </aside>
  `;
}

function dedupePostTitles(posts) {
  const seen = new Set();

  return posts.filter((post) => {
    const key = String(post.title || post.slug).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderReader(article, posts = []) {
  const root = document.querySelector('#article-root');
  const view = normalizeArticle(article);
  applyTypeStyle(root, view.style);

  root.innerHTML = `
    <div class="reader-layout">
      ${renderReaderIndex(posts, view.slug)}
      <article class="reader-article">
        ${articleMarkup(view)}
      </article>
    </div>
  `;
}

function renderLogin(statusText = '') {
  const root = document.querySelector('#article-root');

  root.innerHTML = `
    <section class="editor">
      <p class="editor__note">작성자 로그인입니다. 독자 화면은 따로 열려 있습니다.</p>
      <form class="login-form" data-action="login">
        <label>
          email
          <input name="email" type="email" autocomplete="email" required>
        </label>
        <label>
          password
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <button type="submit">login</button>
      </form>
      <p class="editor__status">${escapeHtml(statusText)}</p>
    </section>
  `;

  root.querySelector('[data-action="login"]').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await signInWithPassword(form.get('email'), form.get('password'));

    if (!result.ok) {
      renderLogin(result.reason);
      return;
    }

    saveSession(result.session);
    await renderEditor({ statusText: 'logged in' });
  });
}

function readTypeSettingsFromDom(article) {
  return normalizeTypeSettings({
    titleSizePt: document.querySelector('[name="titleSizePt"]')?.value ?? article.style?.titleSizePt,
    bodySizePt: document.querySelector('[name="bodySizePt"]')?.value ?? article.style?.bodySizePt,
    bodyLineHeight: document.querySelector('[name="bodyLineHeight"]')?.value ?? article.style?.bodyLineHeight
  });
}

function editorArticleFromDom(article, session = null) {
  const title = document.querySelector('[data-field="title"]').innerText.trim();
  const content = document.querySelector('[data-field="content"]').innerText.trim();
  const style = readTypeSettingsFromDom(article);
  const paragraphs = splitParagraphs(content);
  const publishedAt = new Date().toISOString();

  return normalizeArticle({
    ...article,
    title: title || '제목 없는 글',
    slug: article.id ? article.slug : article.slug || slugify(title),
    author_id: article.author_id ?? session?.user?.id,
    excerpt: paragraphs[0]?.slice(0, 90) ?? 'Hyun2',
    content: content || fallbackArticle.content,
    style,
    status: 'published',
    published_at: publishedAt
  });
}

function articleForSupabase(article) {
  const next = normalizeArticle(article);
  return {
    ...next,
    content: encodeContent(next.content, next.style)
  };
}

function saveFailureMessage(reason) {
  if (reason === 'no-returned-row') {
    return 'no row updated. Run supabase/schema.sql in Supabase SQL Editor.';
  }

  if (reason === 'http-401') {
    return 'login expired. logout and login again.';
  }

  return reason;
}

async function saveSuccessMessage(result) {
  const publicResult = await getPostBySlug(result.post.slug);
  if (publicResult.ok && publicResult.post) {
    return result.reason === 'saved-as-new-row'
      ? 'saved to Supabase as a fresh public copy. reader is updated.'
      : 'saved to Supabase. reader is updated.';
  }

  return 'saved to Supabase, but public read failed. check RLS/public read policy.';
}

function renderAdminIndex(posts, selectedSlug) {
  if (!posts.length) {
    return '<p class="empty-state">아직 저장된 제목이 없습니다.</p>';
  }

  return posts.map((post) => `
    <button
      class="index-link ${post.slug === selectedSlug ? 'is-selected' : ''}"
      type="button"
      data-action="select-post"
      data-slug="${escapeHtml(post.slug)}"
    >${escapeHtml(post.title)}</button>
  `).join('');
}

async function loadAdminState(session, options = {}) {
  let article = options.article ? normalizeArticle(options.article) : currentArticle();
  let posts = [];
  let source = hasSupabaseConfig() ? 'connected' : 'local only';

  if (hasSupabaseConfig() && session?.access_token) {
    const titleResult = await listPostTitles(session.access_token);
    if (titleResult.ok) {
      posts = dedupePostTitles(titleResult.posts);
    } else {
      source = `supabase index failed: ${titleResult.reason}`;
    }

    const selectedSlug = options.selectedSlug
      ?? routeParams.get('post')
      ?? article.slug
      ?? posts[0]?.slug;

    if (!options.article && selectedSlug) {
      const postResult = await getPostBySlug(selectedSlug, session.access_token);
      if (postResult.ok && postResult.post) {
        article = normalizeArticle(postResult.post);
        source = 'supabase';
      }
    }
  }

  if (!posts.length && article.title) {
    posts = [{ title: article.title, slug: article.slug, status: article.status }];
  }

  return { article, posts, source };
}

async function renderEditor(options = {}) {
  let session = loadSession();
  if (hasSupabaseConfig() && !session) {
    renderLogin(options.statusText);
    return;
  }

  if (hasSupabaseConfig() && session) {
    const refreshResult = await refreshSessionIfNeeded(session);
    if (!refreshResult.ok) {
      clearSession();
      renderLogin('login expired. login again.');
      return;
    }
    session = refreshResult.session;
  }

  let { article, posts } = await loadAdminState(session, options);

  if (hasSupabaseConfig() && session?.access_token && session?.user?.id && !options.article && !article.id) {
    const result = await getEditablePost(session.user.id, session.access_token);
    if (result.ok && result.post) {
      article = normalizeArticle(result.post);
    }
  }

  const style = normalizeTypeSettings(article.style);
  setCurrentArticle(article);

  const root = document.querySelector('#article-root');
  applyTypeStyle(root, style);
  root.innerHTML = `
    <div class="admin-layout">
      <aside class="admin-index" data-panel="index" aria-label="글 목차">
        <div class="admin-index__bar">
          <span>index</span>
          <button type="button" data-action="new">new</button>
        </div>
        <nav>
          ${renderAdminIndex(posts, article.slug)}
        </nav>
      </aside>

      <section class="editor" data-panel="editor">
        <div class="editor__bar">
          <button type="button" data-action="save">save</button>
          <a href="./${article.slug ? `?post=${encodeURIComponent(article.slug)}` : ''}">read</a>
          ${session ? '<button type="button" data-action="logout">logout</button>' : ''}
        </div>

        <div class="editor__settings" data-panel="settings" aria-label="글자 설정">
          <label>
            title
            <span><input name="titleSizePt" type="number" min="8" max="120" step="1" value="${style.titleSizePt}"> pt</span>
          </label>
          <label>
            body
            <span><input name="bodySizePt" type="number" min="8" max="120" step="1" value="${style.bodySizePt}"> pt</span>
          </label>
          <label>
            line
            <span><input name="bodyLineHeight" type="number" min="1" max="3" step="0.05" value="${style.bodyLineHeight}"></span>
          </label>
        </div>

        <h1 class="article__title editor__title" data-field="title" contenteditable="true" spellcheck="true">${escapeHtml(article.title)}</h1>
        <div class="article__body editor__content" data-field="content" contenteditable="true" spellcheck="true">${splitParagraphs(article.content).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div>
        <p class="editor__status">${escapeHtml(options.statusText ?? '')}</p>
      </section>
    </div>
  `;

  root.querySelectorAll('[name="titleSizePt"], [name="bodySizePt"], [name="bodyLineHeight"]').forEach((input) => {
    input.addEventListener('input', () => {
      const nextStyle = readTypeSettingsFromDom(currentArticle());
      saveTypeSettings(nextStyle);
      applyTypeStyle(root, nextStyle);
      setCurrentArticle({ ...currentArticle(), style: nextStyle });
    });
  });

  root.querySelectorAll('[data-action="select-post"]').forEach((button) => {
    button.addEventListener('click', async () => {
      await renderEditor({ selectedSlug: button.dataset.slug });
    });
  });

  root.querySelector('[data-action="new"]').addEventListener('click', async () => {
    const now = new Date().toISOString();
    const draft = normalizeArticle({
      id: null,
      author_id: session?.user?.id,
      title: '제목 없는 글',
      slug: '',
      excerpt: 'Hyun2',
      content: '',
      status: 'published',
      published_at: now,
      updated_at: now,
      style: loadTypeSettings(style)
    });

    setCurrentArticle(draft);
    await renderEditor({ article: draft, statusText: 'new writing' });
  });

  root.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const nextArticle = editorArticleFromDom(article, session);
    saveLocalDraft(nextArticle);

    if (!hasSupabaseConfig() || !session?.access_token) {
      setCurrentArticle(nextArticle);
      await renderEditor({ statusText: 'saved locally. add a Supabase public key to sync.' });
      return;
    }

    const result = await savePostWithSession(articleForSupabase(nextArticle), session);
    if (result.session) {
      saveSession(result.session);
    }

    if (result.ok && result.post) {
      setCurrentArticle(result.post);
      await renderEditor({
        selectedSlug: result.post.slug,
        statusText: await saveSuccessMessage(result)
      });
      return;
    }

    if (result.reason === 'missing-refresh-token' || result.reason.startsWith('refresh-')) {
      clearSession();
      renderLogin('login expired. login again.');
      return;
    }

    await renderEditor({ statusText: `local saved. Supabase failed: ${saveFailureMessage(result.reason)}` });
  });

  root.querySelector('[data-action="logout"]')?.addEventListener('click', async () => {
    clearSession();
    renderLogin('logged out');
  });
}

async function renderPublicPage() {
  const requestedSlug = routeParams.get('post') ?? routeParams.get('slug');
  const local = currentArticle();
  let article = local;
  let posts = local.slug ? [{ title: local.title, slug: local.slug, status: local.status }] : [];

  renderArticle(local);

  const postResult = requestedSlug
    ? await getPostBySlug(requestedSlug)
    : await getLatestPublishedPost();

  if (postResult.ok && postResult.post) {
    article = normalizeArticle(postResult.post);
    setCurrentArticle(article);
  }

  const titleResult = await listPostTitles();
  if (titleResult.ok) {
    posts = dedupePostTitles(titleResult.posts);
  }

  renderReader(article, posts);
}

async function boot() {
  const localDraft = loadLocalDraft();
  setCurrentArticle(localDraft ?? fallbackArticle);

  if (isAdminPage) {
    await renderEditor();
    return;
  }

  await renderPublicPage();
}

boot();
