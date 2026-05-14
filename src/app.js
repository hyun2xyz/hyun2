import {
  getEditablePost,
  getLatestPublishedPost,
  hasSupabaseConfig,
  savePost,
  signInWithPassword
} from './supabase-client.js';

const LOCAL_DRAFT_KEY = 'hyun2.localDraft';
const SESSION_KEY = 'hyun2.supabaseSession';

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

const isEditMode = new URLSearchParams(window.location.search).has('edit');

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

function formatDate(value) {
  if (!value) return 'draft';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(value));
}

function loadLocalDraft() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_DRAFT_KEY)) ?? null;
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

function currentArticle() {
  return window.hyun2Article ?? loadLocalDraft() ?? fallbackArticle;
}

function setCurrentArticle(article) {
  window.hyun2Article = { ...fallbackArticle, ...article };
}

export function renderArticle(article, source = 'local') {
  const root = document.querySelector('#article-root');
  const paragraphs = splitParagraphs(article.content);

  root.innerHTML = `
    <div class="article__meta">${escapeHtml(source)} · ${formatDate(article.published_at ?? article.updated_at)}</div>
    <h1 class="article__title">${escapeHtml(article.title)}</h1>
    <div class="article__body">
      ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}
    </div>
  `;
}

function renderLogin(statusText = '') {
  const root = document.querySelector('#article-root');

  root.innerHTML = `
    <section class="editor">
      <p class="editor__note">Supabase에 로그인하면 이 화면에서 바로 글을 저장합니다.</p>
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

function editorArticleFromDom(article) {
  const title = document.querySelector('[data-field="title"]').innerText.trim();
  const content = document.querySelector('[data-field="content"]').innerText.trim();
  const status = document.querySelector('[data-field="status"]').checked ? 'published' : 'draft';

  return {
    ...article,
    title: title || fallbackArticle.title,
    slug: article.slug || slugify(title),
    excerpt: 'Hyun2',
    content: content || fallbackArticle.content,
    status
  };
}

async function renderEditor(options = {}) {
  const session = loadSession();
  let article = currentArticle();
  let source = hasSupabaseConfig() ? 'supabase ready' : 'local only';

  if (hasSupabaseConfig() && session?.access_token && session?.user?.id) {
    const result = await getEditablePost(session.user.id, session.access_token);
    if (result.ok && result.post) {
      article = result.post;
      source = 'supabase';
    }
  }

  setCurrentArticle(article);

  const root = document.querySelector('#article-root');
  root.innerHTML = `
    <section class="editor">
      <div class="editor__bar">
        <span>${escapeHtml(source)}</span>
        <label class="status-toggle">
          <input data-field="status" type="checkbox" ${article.status === 'published' ? 'checked' : ''}>
          publish
        </label>
        <button type="button" data-action="save">save</button>
        <a href="./">read</a>
        ${session ? '<button type="button" data-action="logout">logout</button>' : ''}
      </div>
      <h1 class="article__title editor__title" data-field="title" contenteditable="true" spellcheck="true">${escapeHtml(article.title)}</h1>
      <div class="article__body editor__content" data-field="content" contenteditable="true" spellcheck="true">${splitParagraphs(article.content).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</div>
      <p class="editor__status">${escapeHtml(options.statusText ?? '')}</p>
    </section>
  `;

  root.querySelector('[data-action="save"]').addEventListener('click', async () => {
    const nextArticle = editorArticleFromDom(article);
    saveLocalDraft(nextArticle);

    if (!hasSupabaseConfig() || !session?.access_token) {
      setCurrentArticle(nextArticle);
      await renderEditor({ statusText: 'saved locally. add a Supabase public key to sync.' });
      return;
    }

    const result = await savePost(nextArticle, session.access_token);
    if (result.ok && result.post) {
      setCurrentArticle(result.post);
      await renderEditor({ statusText: 'saved to Supabase.' });
      return;
    }

    await renderEditor({ statusText: `local saved, Supabase failed: ${result.reason}` });
  });

  root.querySelector('[data-action="logout"]')?.addEventListener('click', async () => {
    clearSession();
    await renderEditor({ statusText: 'logged out' });
  });
}

async function boot() {
  const localDraft = loadLocalDraft();
  setCurrentArticle(localDraft ?? fallbackArticle);

  if (isEditMode) {
    if (hasSupabaseConfig() && !loadSession()) {
      renderLogin();
      return;
    }

    await renderEditor();
    return;
  }

  renderArticle(currentArticle(), 'local');

  const result = await getLatestPublishedPost();
  if (result.ok && result.post) {
    setCurrentArticle(result.post);
    renderArticle(result.post, 'supabase');
  }
}

boot();
