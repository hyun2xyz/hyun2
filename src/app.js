import {
  getEditablePost,
  getLatestPublishedPost,
  getPostBySlug,
  hasSupabaseConfig,
  listPostTitles,
  refreshSession,
  savePostWithSession,
  signInWithPassword,
  updatePostContent,
  uploadPostImage
} from './supabase-client.js?v=20260516-image-drop-fix';

const LOCAL_DRAFT_KEY = 'hyun2.localDraft';
const SESSION_KEY = 'hyun2.supabaseSession';
const THEME_KEY = 'hyun2.theme';
const LANG_KEY = 'hyun2.lang';
const TYPE_SETTINGS_KEY = 'hyun2.typeSettings';
const DEFAULT_TYPE_SETTINGS = {
  titleSizePt: 44,
  bodySizePt: 20,
  bodyLineHeight: 1.85,
  indentPt: 0
};

const fallbackArticle = {
  title: '제목 없는 글',
  slug: '',
  excerpt: 'Hyun2',
  content: '',
  status: 'draft',
  published_at: null,
  updated_at: ''
};

function blankArticle(overrides = {}) {
  return {
    ...fallbackArticle,
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

function isBootstrapArticle(article = {}) {
  return String(article.slug ?? '') === 'centered-draft'
    || String(article.title ?? '').trim() === '가안: 가운데에 놓인 글';
}

function filterBootstrapPosts(posts = []) {
  return posts.filter((post) => !isBootstrapArticle(post));
}

const routeParams = new URLSearchParams(window.location.search);
const isAdminPage = document.body.dataset.admin === 'true'
  || routeParams.has('edit')
  || routeParams.has('admin');
const isIndexPage = routeParams.has('index')
  || routeParams.get('view') === 'index';

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

function sanitizeLinkUrl(value) {
  const url = String(value ?? '').trim();
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  return '';
}

function textFromHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');
  return template.content.textContent?.trim() ?? '';
}

function dateInputValue(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToIso(value) {
  const date = dateInputValue(value);
  return date ? `${date}T00:00:00.000Z` : null;
}

function noteDotMarkup(note = '', url = '') {
  return `<button class="note-dot" type="button" contenteditable="false" data-note="${escapeHtml(note)}" data-url="${escapeHtml(url)}" aria-label="각주"></button>`;
}

function sanitizeInlineHtml(html) {
  const template = document.createElement('template');
  template.innerHTML = String(html ?? '');

  const sanitizeNode = (node) => {
    Array.from(node.childNodes).forEach(sanitizeNode);
    if (!(node instanceof HTMLElement)) return;

    if (node.tagName === 'BR') {
      Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));
      return;
    }

    if (node.tagName === 'U') {
      Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));
      return;
    }

    if (node.tagName === 'SPAN' && node.style.textDecoration.includes('underline')) {
      const underline = document.createElement('u');
      underline.append(...Array.from(node.childNodes));
      node.replaceWith(underline);
      return;
    }

    if (node.tagName === 'A') {
      const href = sanitizeLinkUrl(node.getAttribute('href'));
      Array.from(node.attributes).forEach((attribute) => node.removeAttribute(attribute.name));
      if (!href) {
        node.replaceWith(document.createTextNode(node.textContent ?? ''));
        return;
      }
      node.setAttribute('href', href);
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
      return;
    }

    if (node.tagName === 'BUTTON' && node.classList.contains('note-dot')) {
      const note = String(node.dataset.note ?? '').trim();
      const url = sanitizeLinkUrl(node.dataset.url);
      const next = document.createElement('template');
      next.innerHTML = noteDotMarkup(note, url);
      node.replaceWith(next.content.firstElementChild);
      return;
    }

    node.replaceWith(document.createTextNode(node.textContent ?? ''));
  };

  sanitizeNode(template.content);
  return template.innerHTML;
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

function normalizeBlockLineHeight(value) {
  const next = Number.parseFloat(value);
  if (!Number.isFinite(next)) return null;
  return String(Math.min(3, Math.max(1, next)));
}

function clampIndentPt(value, fallback) {
  const next = Number.parseFloat(value);
  if (!Number.isFinite(next)) return fallback;
  return Math.min(120, Math.max(0, next));
}

function normalizeTypeSettings(settings = {}) {
  return {
    titleSizePt: clampPt(settings.titleSizePt, DEFAULT_TYPE_SETTINGS.titleSizePt),
    bodySizePt: clampPt(settings.bodySizePt, DEFAULT_TYPE_SETTINGS.bodySizePt),
    bodyLineHeight: clampLineHeight(settings.bodyLineHeight, DEFAULT_TYPE_SETTINGS.bodyLineHeight),
    indentPt: clampIndentPt(settings.indentPt, DEFAULT_TYPE_SETTINGS.indentPt)
  };
}

function blocksFromText(body) {
  return splitParagraphs(body).map((text) => ({ type: 'text', text }));
}

function normalizeBlocks(blocks, fallbackBody = '') {
  if (!Array.isArray(blocks)) return blocksFromText(fallbackBody);

  return blocks
    .map((block) => {
      if (block?.type === 'image' && block.src) {
        const width = Number.parseFloat(block.width);
        return {
          type: 'image',
          src: String(block.src),
          alt: String(block.alt ?? ''),
          ...(block.path ? { path: String(block.path) } : {}),
          width: Number.isFinite(width) ? Math.min(100, Math.max(18, width)) : 100,
          align: ['left', 'right', 'center'].includes(block.align) ? block.align : 'center',
          wrap: Boolean(block.wrap)
        };
      }

      const html = block?.html ? sanitizeInlineHtml(block.html) : '';
      const text = String(block?.text ?? (html ? textFromHtml(html) : '')).trim();
      const lineHeight = normalizeBlockLineHeight(block?.lineHeight);
      if (!text && !html.replace(/<br\s*\/?>/gi, '').trim()) return null;

      return {
        type: 'text',
        text,
        ...(html ? { html } : {}),
        ...(lineHeight ? { lineHeight } : {})
      };
    })
    .filter(Boolean);
}

function textFromBlocks(blocks) {
  return normalizeBlocks(blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text || textFromHtml(block.html))
    .join('\n\n');
}

function decodeContent(content) {
  const raw = String(content ?? '');

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.body === 'string') {
      const blocks = normalizeBlocks(parsed.blocks, parsed.body);

      return {
        body: parsed.body,
        blocks,
        style: normalizeTypeSettings(parsed.style),
        displayDate: parsed.displayDate ?? parsed.meta?.displayDate ?? '',
        sortOrder: Number.isFinite(Number.parseFloat(parsed.sortOrder ?? parsed.meta?.sortOrder))
          ? Number.parseFloat(parsed.sortOrder ?? parsed.meta?.sortOrder)
          : null
      };
    }
  } catch {
    // Plain text is the default authoring format.
  }

  return {
    body: raw,
    blocks: blocksFromText(raw),
    style: normalizeTypeSettings(),
    displayDate: '',
    sortOrder: null
  };
}

function encodeContent(body, style, blocks = null, meta = {}) {
  const normalizedBlocks = normalizeBlocks(blocks, body);

  return JSON.stringify({
    body: String(body ?? ''),
    blocks: normalizedBlocks,
    style: normalizeTypeSettings(style),
    displayDate: dateInputValue(meta.displayDate),
    sortOrder: Number.isFinite(Number.parseFloat(meta.sortOrder)) ? Number.parseFloat(meta.sortOrder) : null
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
    if (draft && isBootstrapArticle(draft)) {
      localStorage.removeItem(LOCAL_DRAFT_KEY);
      return null;
    }
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

function currentTheme() {
  const theme = document.documentElement.dataset.theme;
  if (theme === 'dark' || theme === 'light') return theme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentLang() {
  const lang = document.documentElement.dataset.lang;
  if (lang === 'en' || lang === 'ko') return lang;
  try {
    return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'ko';
  } catch {
    return 'ko';
  }
}

function setLang(lang) {
  const next = lang === 'en' ? 'en' : 'ko';
  document.documentElement.dataset.lang = next;
  localStorage.setItem(LANG_KEY, next);
  updateTopControls();
}

function toggleLang() {
  setLang(currentLang() === 'en' ? 'ko' : 'en');
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  updateTopControls();
}

function toggleTheme() {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
  document.querySelectorAll('[data-action="theme"]').forEach((button) => {
    button.textContent = button.dataset.theme ? themeLabel(button.dataset.theme) : themeButtonLabel();
  });
}

function themeButtonLabel() {
  return currentTheme() === 'dark' ? 'light' : 'dark';
}

function themeLabel(theme, lang = currentLang()) {
  const dark = lang === 'en' ? 'DA' : '다';
  const light = lang === 'en' ? 'LA' : '라';
  return theme === 'dark' ? dark : light;
}

function updateTopControls(root = document) {
  root.querySelectorAll('[data-action="lang-toggle"]').forEach((button) => {
    button.textContent = currentLang() === 'en' ? 'EN' : '한';
    button.setAttribute('aria-label', currentLang() === 'en' ? 'English' : '한국어');
  });

  root.querySelectorAll('[data-action="theme-toggle"]').forEach((button) => {
    button.textContent = themeLabel(currentTheme());
    button.setAttribute('aria-label', currentTheme() === 'dark' ? 'dark' : 'light');
  });

  root.querySelectorAll('[data-action="theme"]').forEach((button) => {
    button.textContent = themeButtonLabel();
  });
}

function attachThemeToggle(root = document) {
  root.querySelectorAll('[data-action="theme"]').forEach((button) => {
    button.textContent = button.dataset.theme ? themeLabel(button.dataset.theme) : themeButtonLabel();
    button.addEventListener('click', () => {
      if (button.dataset.theme) {
        setTheme(button.dataset.theme);
      } else {
        toggleTheme();
      }
    });
  });
}

function attachLangToggle(root = document) {
  root.querySelectorAll('[data-action="lang-toggle"]').forEach((button) => {
    button.addEventListener('click', toggleLang);
  });
  root.querySelectorAll('[data-action="theme-toggle"]').forEach((button) => {
    button.addEventListener('click', toggleTheme);
  });
  updateTopControls(root);
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
  const blocks = normalizeBlocks(merged.blocks ?? decoded.blocks, decoded.body);
  const sortOrder = Number.parseFloat(merged.sort_order ?? merged.sortOrder ?? decoded.sortOrder);

  return {
    ...merged,
    content: decoded.body,
    blocks,
    style,
    display_date: dateInputValue(merged.display_date ?? decoded.displayDate ?? merged.published_at ?? merged.updated_at),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : null
  };
}

function currentArticle() {
  const windowArticle = window.hyun2Article;
  if (windowArticle && !isBootstrapArticle(windowArticle)) return normalizeArticle(windowArticle);

  const localDraft = loadLocalDraft();
  if (localDraft) return normalizeArticle(localDraft);

  return normalizeArticle(hasSupabaseConfig() ? blankArticle() : fallbackArticle);
}

function setCurrentArticle(article) {
  window.hyun2Article = normalizeArticle(article);
}

function applyTypeStyle(container, settings) {
  const style = normalizeTypeSettings(settings);
  container.style.setProperty('--title-size', `${style.titleSizePt}pt`);
  container.style.setProperty('--body-size', `${style.bodySizePt}pt`);
  container.style.setProperty('--body-line-height', style.bodyLineHeight);
  container.style.setProperty('--paragraph-indent', `${style.indentPt}pt`);
}

function formatDate(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function imageBlockMarkup(block, options = {}) {
  const width = Number.isFinite(Number.parseFloat(block.width)) ? Number.parseFloat(block.width) : 100;
  const align = ['left', 'right', 'center'].includes(block.align) ? block.align : 'center';
  const wrap = Boolean(block.wrap);
  return `
    <figure
      class="article-image ${wrap ? 'article-image--wrap' : ''}"
      data-block-type="image"
      data-width="${escapeHtml(width)}"
      data-align="${escapeHtml(align)}"
      data-wrap="${wrap ? 'true' : 'false'}"
      ${block.path ? `data-path="${escapeHtml(block.path)}"` : ''}
      style="--image-width: ${escapeHtml(width)}%; --image-align: ${escapeHtml(align)};"
      contenteditable="false"
    >
      <img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? '')}">
      ${options.editable ? `
        <div class="image-tools" aria-label="이미지 조정">
          <button type="button" data-image-action="smaller" title="작게">-</button>
          <button type="button" data-image-action="larger" title="크게">+</button>
          <button type="button" data-image-action="left" title="왼쪽">L</button>
          <button type="button" data-image-action="center" title="가운데">C</button>
          <button type="button" data-image-action="right" title="오른쪽">R</button>
          <button type="button" data-image-action="wrap" title="글 감싸기">wrap</button>
        </div>
      ` : ''}
    </figure>
  `;
}

function blockMarkup(block, options = {}) {
  if (block.type === 'image') return imageBlockMarkup(block, options);
  const lineHeight = normalizeBlockLineHeight(block.lineHeight);
  const lineAttrs = lineHeight
    ? ` style="line-height: ${escapeHtml(lineHeight)}" data-line-height="${escapeHtml(lineHeight)}"`
    : '';
  return `<p${lineAttrs}>${block.html ? sanitizeInlineHtml(block.html) : escapeHtml(block.text)}</p>`;
}

function articleMarkup(article, options = {}) {
  const view = normalizeArticle(article);
  const date = formatDate(view.display_date ?? view.published_at ?? view.updated_at);
  const blocks = view.blocks.length ? view.blocks : blocksFromText(view.content);

  return `
    <h1 class="article__title">${escapeHtml(view.title)}</h1>
    ${date ? `<time class="article__date" datetime="${escapeHtml(view.display_date ?? view.published_at ?? view.updated_at)}">${escapeHtml(date)}</time>` : ''}
    <div class="article__body">
      ${blocks.map((block) => blockMarkup(block, options)).join('')}
      ${options.editable && !blocks.length ? '<p><br></p>' : ''}
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
    <aside class="reader-index reader-chrome" data-panel="index" aria-label="글 목차">
      <div class="index-title">
        <a class="index-heading" href="./?index">index</a>
      </div>
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

function renderTopControls(className = '') {
  return `
    <div class="top-controls ${escapeHtml(className)}" aria-label="언어와 테마">
      <button type="button" data-action="lang-toggle" aria-label="${currentLang() === 'en' ? 'English' : '한국어'}">${currentLang() === 'en' ? 'EN' : '한'}</button>
      <button type="button" data-action="theme-toggle" aria-label="${currentTheme() === 'dark' ? 'dark' : 'light'}">${themeLabel(currentTheme())}</button>
    </div>
  `;
}

function topButtonMarkup() {
  return '<button class="to-top-button" type="button" data-action="top" aria-label="맨 위로">top</button>';
}

function attachTopButton(root) {
  root.querySelector('[data-action="top"]')?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

function attachNoteDots(root) {
  if (root.dataset.noteDotsAttached === 'true') return;
  root.dataset.noteDotsAttached = 'true';

  root.addEventListener('click', (event) => {
    const dot = event.target.closest?.('.note-dot');
    if (!dot || !root.contains(dot)) {
      root.querySelectorAll('.note-dot.is-open').forEach((openDot) => openDot.classList.remove('is-open'));
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const url = sanitizeLinkUrl(dot.dataset.url);
    if (url) {
      window.open(url, '_blank', 'noopener');
      return;
    }

    root.querySelectorAll('.note-dot.is-open').forEach((openDot) => {
      if (openDot !== dot) openDot.classList.remove('is-open');
    });
    dot.classList.toggle('is-open');
  });
}

function attachReaderChromeDissolve(root) {
  const chrome = root.querySelectorAll('.reader-chrome');
  const topButton = root.querySelector('[data-action="top"]');
  if (!chrome.length) return;

  let lastY = window.scrollY;

  const show = () => {
    chrome.forEach((element) => element.classList.remove('is-dissolved'));
    topButton?.classList.remove('is-visible');
  };
  const hide = () => {
    chrome.forEach((element) => element.classList.add('is-dissolved'));
    topButton?.classList.add('is-visible');
  };

  window.addEventListener('scroll', () => {
    const nextY = window.scrollY;
    if (nextY <= 24 || nextY < lastY) {
      show();
    } else if (nextY > 24) {
      hide();
    }
    lastY = nextY;
  }, { passive: true });
}

function renderIndexPage(posts = []) {
  const root = document.querySelector('#article-root');

  root.innerHTML = `
    <section class="index-page" aria-label="전체 목차">
      <div class="index-page__inner">
        <h1>index</h1>
        <nav class="index-page__list">
          ${posts.map((post) => `
            <a class="index-page__row" href="./?post=${encodeURIComponent(post.slug)}">
              <span>${escapeHtml(post.title)}</span>
              <time>${escapeHtml(formatDate(post.display_date ?? post.published_at ?? post.updated_at))}</time>
            </a>
          `).join('')}
        </nav>
      </div>
    </section>
    ${renderTopControls()}
    ${topButtonMarkup()}
  `;

  attachTopButton(root);
  attachThemeToggle(root);
  attachLangToggle(root);
}

function dedupePostTitles(posts) {
  const seen = new Set();

  return posts.filter((post) => {
    const key = String(post.slug || post.title).trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function enrichPostSummary(post, index = 0) {
  const decoded = decodeContent(post.content);
  const sortOrder = Number.parseFloat(post.sort_order ?? decoded.sortOrder);
  return {
    ...post,
    display_date: dateInputValue(decoded.displayDate ?? post.published_at ?? post.updated_at),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : index
  };
}

function sortPostSummaries(posts) {
  return posts
    .map(enrichPostSummary)
    .sort((a, b) => {
      if (a.status !== b.status) return String(a.status).localeCompare(String(b.status));
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return String(b.published_at ?? b.updated_at ?? '').localeCompare(String(a.published_at ?? a.updated_at ?? ''));
    });
}

function renderReader(article, posts = []) {
  const root = document.querySelector('#article-root');
  const view = normalizeArticle(article);
  applyTypeStyle(root, view.style);

  root.innerHTML = `
    ${renderTopControls('reader-chrome')}
    <div class="reader-layout">
      ${renderReaderIndex(posts, view.slug)}
      <article class="reader-article">
        ${articleMarkup(view)}
      </article>
    </div>
    ${topButtonMarkup()}
  `;
  attachThemeToggle(root);
  attachLangToggle(root);
  attachTopButton(root);
  attachNoteDots(root);
  attachReaderChromeDissolve(root);
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
    bodyLineHeight: document.querySelector('[name="bodyLineHeight"]')?.value ?? article.style?.bodyLineHeight,
    indentPt: document.querySelector('[name="indentPt"]')?.value ?? article.style?.indentPt
  });
}

function readDisplayDateFromDom(article) {
  return dateInputValue(document.querySelector('[name="displayDate"]')?.value
    ?? article.display_date
    ?? article.published_at
    ?? article.updated_at
    ?? new Date());
}

function editorBlocksFromDom() {
  const contentRoot = document.querySelector('[data-field="content"]');
  if (!contentRoot) return [];

  return Array.from(contentRoot.childNodes)
    .map((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent.trim();
        return text ? { type: 'text', text } : null;
      }

      if (!(node instanceof HTMLElement)) return null;

      if (node.matches('[data-block-type="image"]')) {
        const image = node.querySelector('img');
        return image?.src
          ? {
              type: 'image',
              src: image.src,
              alt: image.alt,
              ...(node.dataset.path ? { path: node.dataset.path } : {}),
              width: Number.parseFloat(node.dataset.width) || 100,
              align: node.dataset.align || 'center',
              wrap: node.dataset.wrap === 'true'
            }
          : null;
      }

      const text = node.innerText.trim();
      const html = sanitizeInlineHtml(node.innerHTML).trim();
      const lineHeight = normalizeBlockLineHeight(node.dataset.lineHeight || node.style.lineHeight);
      return text || html
        ? {
            type: 'text',
            text,
            ...(html ? { html } : {}),
            ...(lineHeight ? { lineHeight } : {})
          }
        : null;
    })
    .filter(Boolean);
}

function publishEnabled() {
  return document.querySelector('[data-action="publish"]')?.getAttribute('aria-pressed') === 'true';
}

function editorArticleFromDom(article, session = null) {
  const title = document.querySelector('[data-field="title"]').innerText.trim();
  const blocks = editorBlocksFromDom();
  const content = textFromBlocks(blocks).trim();
  const style = readTypeSettingsFromDom(article);
  const displayDate = readDisplayDateFromDom(article);
  const textBlocks = blocks.filter((block) => block.type === 'text');
  const body = content || (blocks.some((block) => block.type === 'image') ? '' : fallbackArticle.content);
  const status = publishEnabled() ? 'published' : 'draft';
  const publishedAt = status === 'published' ? dateInputToIso(displayDate) ?? new Date().toISOString() : null;

  return normalizeArticle({
    ...article,
    title: title || '제목 없는 글',
    slug: article.id ? article.slug : article.slug || slugify(title),
    author_id: article.author_id ?? session?.user?.id,
    excerpt: textBlocks[0]?.text.slice(0, 90) ?? 'Hyun2',
    content: body,
    blocks: blocks.length ? blocks : blocksFromText(body),
    style,
    display_date: displayDate,
    sort_order: article.sort_order,
    status,
    published_at: publishedAt
  });
}

function articleForSupabase(article) {
  const next = normalizeArticle(article);
  return {
    ...next,
    content: encodeContent(next.content, next.style, next.blocks, {
      displayDate: next.display_date,
      sortOrder: next.sort_order
    })
  };
}

function imageFilesFromDataTransfer(dataTransfer) {
  return Array.from(dataTransfer?.files ?? [])
    .filter((file) => file.type.startsWith('image/'));
}

function hasImageInDataTransfer(dataTransfer) {
  return imageFilesFromDataTransfer(dataTransfer).length > 0
    || Array.from(dataTransfer?.items ?? [])
      .some((item) => item.kind === 'file' && item.type.startsWith('image/'));
}

function dataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

async function optimizedImageFile(file) {
  if (/image\/(gif|svg\+xml)/.test(file.type)) return file;

  const src = await dataUrlFromFile(file);
  const image = new Image();
  await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', reject, { once: true });
    image.src = src;
  });

  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const webp = await canvasBlob(canvas, 'image/webp', 0.86);
  const blob = webp || await canvasBlob(canvas, 'image/jpeg', 0.86);
  if (!blob) return file;

  const name = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${name}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type });
}

function applyImageFigureSettings(figure) {
  const width = Math.min(100, Math.max(18, Number.parseFloat(figure.dataset.width) || 100));
  const align = ['left', 'right', 'center'].includes(figure.dataset.align) ? figure.dataset.align : 'center';
  const wrap = figure.dataset.wrap === 'true';
  figure.dataset.width = String(width);
  figure.dataset.align = align;
  figure.dataset.wrap = wrap ? 'true' : 'false';
  figure.style.setProperty('--image-width', `${width}%`);
  figure.style.setProperty('--image-align', align);
  figure.classList.toggle('article-image--wrap', wrap);
}

function imageFigureFromUpload(uploaded, file) {
  const figure = document.createElement('figure');
  figure.className = 'article-image';
  figure.dataset.blockType = 'image';
  figure.dataset.width = '100';
  figure.dataset.align = 'center';
  figure.dataset.wrap = 'false';
  if (uploaded.path) figure.dataset.path = uploaded.path;
  figure.contentEditable = 'false';

  const image = document.createElement('img');
  image.src = uploaded.src;
  image.alt = uploaded.alt || file.name || 'uploaded image';
  figure.append(image);
  applyImageFigureSettings(figure);

  return figure;
}

function dropReferenceBlock(contentRoot, event) {
  return document.elementsFromPoint(event.clientX, event.clientY)
    .find((element) => element.parentElement === contentRoot
      && (element.matches('p') || element.matches('[data-block-type="image"]')));
}

function insertImageNode(contentRoot, figure, event = null) {
  const reference = event ? dropReferenceBlock(contentRoot, event) : null;
  if (!reference) {
    contentRoot.append(figure);
  } else {
    const rect = reference.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    contentRoot.insertBefore(figure, before ? reference : reference.nextSibling);
  }

  const paragraph = document.createElement('p');
  paragraph.append(document.createElement('br'));
  contentRoot.insertBefore(paragraph, figure.nextSibling);
}

async function insertImageFiles(files, contentRoot, statusRoot, session, article, event = null) {
  for (const file of files) {
    statusRoot.textContent = `uploading image: ${file.name}`;
    let optimized = file;
    let uploadResult;

    try {
      optimized = await optimizedImageFile(file);
      uploadResult = await uploadPostImage(optimized, {
        accessToken: session?.access_token,
        slug: article?.slug || slugify(article?.title)
      });
    } catch (error) {
      statusRoot.textContent = `image upload failed: ${error?.message ?? 'browser-upload-error'}`;
      continue;
    }

    if (!uploadResult.ok) {
      statusRoot.textContent = `image upload failed: ${uploadResult.reason}`;
      continue;
    }

    insertImageNode(contentRoot, imageFigureFromUpload(uploadResult.image, optimized), event);
    statusRoot.textContent = 'image uploaded. save to publish.';
  }
}

function attachImageDrop(contentRoot, statusRoot, session, article) {
  contentRoot.addEventListener('dragover', (event) => {
    if (!hasImageInDataTransfer(event.dataTransfer)) return;
    event.preventDefault();
    contentRoot.classList.add('is-dragging');
  });

  contentRoot.addEventListener('dragleave', () => {
    contentRoot.classList.remove('is-dragging');
  });

  contentRoot.addEventListener('drop', async (event) => {
    const files = imageFilesFromDataTransfer(event.dataTransfer);
    if (!files.length) return;

    event.preventDefault();
    contentRoot.classList.remove('is-dragging');
    await insertImageFiles(files, contentRoot, statusRoot, session, article, event);
  });

  contentRoot.addEventListener('paste', async (event) => {
    const files = imageFilesFromDataTransfer(event.clipboardData);
    if (!files.length) return;

    event.preventDefault();
    await insertImageFiles(files, contentRoot, statusRoot, session, article);
  });
}

function selectionRangeIn(contentRoot) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  const container = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
    ? range.commonAncestorContainer
    : range.commonAncestorContainer.parentElement;

  return container && contentRoot.contains(container) ? range : null;
}

function placeCaretAfter(node) {
  const range = document.createRange();
  const selection = window.getSelection();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

function insertInlineNode(contentRoot, node, options = {}) {
  const range = selectionRangeIn(contentRoot);
  if (range) {
    if (options.replaceSelection) {
      range.deleteContents();
    } else if (options.beforeSelection) {
      range.collapse(true);
    } else {
      range.collapse(false);
    }
    range.insertNode(node);
    placeCaretAfter(node);
    return;
  }

  const paragraph = contentRoot.querySelector('p:last-of-type') ?? document.createElement('p');
  if (!paragraph.parentElement) contentRoot.append(paragraph);
  paragraph.append(' ', node, ' ');
  placeCaretAfter(node);
}

function noteDotElement(value) {
  const raw = String(value ?? '').trim();
  const url = sanitizeLinkUrl(raw);
  const template = document.createElement('template');
  template.innerHTML = noteDotMarkup(url ? '' : raw, url);
  return template.content.firstElementChild;
}

function insertNoteDot(contentRoot, statusRoot) {
  const value = window.prompt('각주 내용이나 링크를 입력하세요.');
  if (value === null) return;

  insertInlineNode(contentRoot, noteDotElement(value), { replaceSelection: false, beforeSelection: true });
  statusRoot.textContent = 'note dot added. save to publish.';
}

function underlineSelection(contentRoot, statusRoot) {
  const range = selectionRangeIn(contentRoot);
  if (!range || range.collapsed) {
    statusRoot.textContent = 'drag text first, then press underline.';
    return;
  }

  document.execCommand('underline');
  statusRoot.textContent = 'underline added. save to publish.';
}

function linkSelection(contentRoot, statusRoot) {
  const range = selectionRangeIn(contentRoot);
  if (!range || range.collapsed) {
    statusRoot.textContent = 'drag text first, then press hyperlink.';
    return;
  }

  const href = sanitizeLinkUrl(window.prompt('링크 주소를 입력하세요.'));
  if (!href) {
    statusRoot.textContent = 'https://, http://, mailto: 링크만 사용할 수 있습니다.';
    return;
  }

  document.execCommand('createLink', false, href);
  contentRoot.querySelectorAll('a').forEach((anchor) => {
    const cleanHref = sanitizeLinkUrl(anchor.getAttribute('href'));
    if (!cleanHref) return;
    anchor.setAttribute('href', cleanHref);
    anchor.setAttribute('target', '_blank');
    anchor.setAttribute('rel', 'noopener noreferrer');
  });
  statusRoot.textContent = 'hyperlink added. save to publish.';
}

function attachEditorFormatting(root, contentRoot, statusRoot) {
  root.querySelector('[data-action="underline"]')?.addEventListener('click', () => {
    underlineSelection(contentRoot, statusRoot);
  });

  root.querySelector('[data-action="link"]')?.addEventListener('click', () => {
    linkSelection(contentRoot, statusRoot);
  });
}

function attachImageControls(root, statusRoot) {
  root.addEventListener('click', (event) => {
    const action = event.target.closest?.('[data-image-action]')?.dataset.imageAction;
    const figure = event.target.closest?.('[data-block-type="image"]');
    if (!action || !figure || !root.contains(figure)) return;

    if (action === 'smaller') {
      figure.dataset.width = String(Math.max(18, (Number.parseFloat(figure.dataset.width) || 100) - 10));
    } else if (action === 'larger') {
      figure.dataset.width = String(Math.min(100, (Number.parseFloat(figure.dataset.width) || 100) + 10));
    } else if (action === 'left' || action === 'right' || action === 'center') {
      figure.dataset.align = action;
    } else if (action === 'wrap') {
      figure.dataset.wrap = figure.dataset.wrap === 'true' ? 'false' : 'true';
    }

    applyImageFigureSettings(figure);
    statusRoot.textContent = 'image layout changed. save to publish.';
  });
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
  if (result.post?.status === 'draft') {
    return 'saved to Supabase as draft. reader is not updated.';
  }

  if (result.post?.status === 'archived') {
    return 'moved to trash.';
  }

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

  const publishedPosts = posts.filter((post) => post.status === 'published');
  const draftPosts = posts.filter((post) => post.status === 'draft');
  const trashPosts = posts.filter((post) => post.status === 'archived');
  const renderButton = (post) => `
      <button
        class="index-link ${post.slug === selectedSlug ? 'is-selected' : ''}"
        type="button"
        draggable="true"
        data-action="select-post"
        data-id="${escapeHtml(post.id ?? '')}"
        data-slug="${escapeHtml(post.slug)}"
      >${escapeHtml(post.title)}</button>
    `;
  const renderGroup = (label, group, groupPosts) => `
    <section class="admin-index__group">
      <p>${label}</p>
      <div class="admin-index__items" data-index-group="${group}">
        ${groupPosts.length ? groupPosts.map(renderButton).join('') : '<span class="empty-state">비어 있습니다.</span>'}
      </div>
    </section>
  `;

  return `
    ${renderGroup('published', 'published', publishedPosts)}
    ${renderGroup('draft', 'draft', draftPosts)}
    ${renderGroup('trash', 'archived', trashPosts)}
  `;
}

function contentWithMeta(post, metaPatch = {}) {
  const decoded = decodeContent(post.content);
  return encodeContent(decoded.body, decoded.style, decoded.blocks, {
    displayDate: metaPatch.displayDate ?? decoded.displayDate ?? post.display_date,
    sortOrder: metaPatch.sortOrder ?? decoded.sortOrder ?? post.sort_order
  });
}

function adminDropTargetAfter(group, pointerY, source) {
  return Array.from(group.querySelectorAll('.index-link:not(.is-dragging)'))
    .filter((button) => button !== source)
    .find((button) => {
      const rect = button.getBoundingClientRect();
      return pointerY < rect.top + rect.height / 2;
    }) ?? null;
}

async function persistAdminIndexOrder(group, postMap, session) {
  const buttons = Array.from(group.querySelectorAll('.index-link'));
  const updates = buttons.map((item, index) => {
    const post = postMap.get(item.dataset.slug);
    if (!post?.id || !session?.access_token) return Promise.resolve({ ok: true });
    post.sort_order = index;
    post.content = contentWithMeta(post, { sortOrder: index });
    return updatePostContent(post.id, post.content, session.access_token);
  });

  return Promise.all(updates);
}

function attachAdminIndexDrag(root, posts, session, statusRoot) {
  const postMap = new Map(posts.map((post) => [post.slug, post]));
  let draggedSlug = '';

  root.querySelectorAll('.index-link[draggable="true"]').forEach((button) => {
    button.addEventListener('dragstart', (event) => {
      draggedSlug = button.dataset.slug;
      button.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedSlug);
    });

    button.addEventListener('dragend', () => {
      button.classList.remove('is-dragging');
      draggedSlug = '';
    });
  });

  root.querySelectorAll('.admin-index__items').forEach((group) => {
    group.addEventListener('dragover', (event) => {
      const source = root.querySelector(`.index-link[data-slug="${CSS.escape(draggedSlug)}"]`);
      if (!source || source.closest('[data-index-group]') !== group) return;

      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      group.insertBefore(source, adminDropTargetAfter(group, event.clientY, source));
    });

    group.addEventListener('drop', async (event) => {
      const source = root.querySelector(`.index-link[data-slug="${CSS.escape(draggedSlug)}"]`);
      if (!source || source.closest('[data-index-group]') !== group) return;

      event.preventDefault();
      source.classList.remove('is-dragging');
      const results = await persistAdminIndexOrder(group, postMap, session);
      statusRoot.textContent = results.every((result) => result.ok)
        ? 'menu order saved.'
        : 'menu order changed locally, but Supabase order save failed.';
    });
  });
}

async function loadAdminState(session, options = {}) {
  let article = options.article ? normalizeArticle(options.article) : currentArticle();
  let posts = [];
  let source = hasSupabaseConfig() ? 'connected' : 'local only';

  if (hasSupabaseConfig() && session?.access_token) {
    const titleResult = await listPostTitles(session.access_token);
    if (titleResult.ok) {
      posts = filterBootstrapPosts(sortPostSummaries(dedupePostTitles(titleResult.posts)));
    } else {
      source = `supabase index failed: ${titleResult.reason}`;
    }

    const requestedSlug = options.selectedSlug ?? routeParams.get('post');
    const currentSlug = !isBootstrapArticle(article) && posts.some((post) => post.slug === article.slug)
      ? article.slug
      : '';
    const selectedSlug = !isBootstrapArticle({ slug: requestedSlug })
      ? requestedSlug
      : currentSlug
      || posts.find((post) => post.status !== 'archived')?.slug
      || posts[0]?.slug;

    const fallbackSlug = selectedSlug
      ?? currentSlug
      ?? posts.find((post) => post.status !== 'archived')?.slug
      ?? posts[0]?.slug;

    if (!options.article && fallbackSlug) {
      const postResult = await getPostBySlug(fallbackSlug, session.access_token);
      if (postResult.ok && postResult.post && !isBootstrapArticle(postResult.post)) {
        article = normalizeArticle(postResult.post);
        source = 'supabase';
      }
    }
  }

  if (!posts.length && article.title && (!hasSupabaseConfig() || !session?.access_token)) {
    posts = [enrichPostSummary({ title: article.title, slug: article.slug, status: article.status, content: article.content })];
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
        </div>
        <nav>
          ${renderAdminIndex(posts, article.slug)}
        </nav>
      </aside>

      <section class="editor" data-panel="editor">
        <div class="editor__bar">
          <button type="button" data-action="new">new</button>
          <button type="button" data-action="save">save</button>
          <button type="button" data-action="publish" aria-pressed="${article.status === 'published'}">${article.status === 'published' ? 'status: published' : 'status: draft'}</button>
          <a class="button-link" href="./${article.slug ? `?post=${encodeURIComponent(article.slug)}` : ''}">read</a>
          <button type="button" data-action="trash">trash</button>
          ${session ? '<button type="button" data-action="logout">logout</button>' : ''}
        </div>

        <div class="editor__settings" data-panel="settings" aria-label="글자 설정">
          <label>
            date
            <span><input name="displayDate" type="date" value="${escapeHtml(article.display_date || dateInputValue(article.published_at ?? article.updated_at ?? new Date()))}"></span>
          </label>
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
          <label>
            indent
            <span><input name="indentPt" type="number" min="0" max="120" step="1" value="${style.indentPt}"> pt</span>
          </label>
          <div class="editor__inline-tools" data-panel="tools" aria-label="글 수정 도구">
            <button class="text-tool" type="button" data-action="underline" title="선택한 글자에 밑줄">밑줄</button>
            <button class="text-tool" type="button" data-action="link" title="선택한 글자에 하이퍼링크">하이퍼링크</button>
          </div>
        </div>

        <h1 class="article__title editor__title" data-field="title" contenteditable="true" spellcheck="true">${escapeHtml(article.title)}</h1>
        <div class="article__body editor__content" data-field="content" contenteditable="true" spellcheck="true">${normalizeArticle(article).blocks.map((block) => blockMarkup(block, { editable: true })).join('') || '<p><br></p>'}</div>
        <p class="editor__status">${escapeHtml(options.statusText ?? '')}</p>
      </section>
    </div>
  `;

  attachThemeToggle(root);
  const contentRoot = root.querySelector('[data-field="content"]');
  const statusRoot = root.querySelector('.editor__status');
  attachImageDrop(contentRoot, statusRoot, session, article);
  attachEditorFormatting(root, contentRoot, statusRoot);
  attachImageControls(root, statusRoot);
  attachAdminIndexDrag(root, posts, session, statusRoot);
  attachNoteDots(root);

  root.querySelector('[data-action="publish"]').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    button.textContent = next ? 'status: published' : 'status: draft';
  });

  root.querySelectorAll('[name="titleSizePt"], [name="bodySizePt"], [name="bodyLineHeight"], [name="indentPt"]').forEach((input) => {
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
      status: 'draft',
      display_date: dateInputValue(now),
      sort_order: posts.filter((post) => post.status === 'draft').length,
      published_at: null,
      updated_at: now,
      style: loadTypeSettings(style)
    });

    setCurrentArticle(draft);
    await renderEditor({ article: draft, statusText: 'new writing' });
  });

  root.querySelector('[data-action="trash"]').addEventListener('click', async () => {
    if (!window.confirm('이 페이지를 휴지통으로 보낼까요? 독자 페이지에서는 보이지 않습니다.')) return;

    const archivedArticle = normalizeArticle({
      ...editorArticleFromDom(article, session),
      status: 'archived',
      published_at: null
    });
    saveLocalDraft(archivedArticle);

    if (!hasSupabaseConfig() || !session?.access_token) {
      await renderEditor({ article: archivedArticle, statusText: 'moved to local trash.' });
      return;
    }

    const result = await savePostWithSession(articleForSupabase(archivedArticle), session);
    if (result.session) saveSession(result.session);

    if (result.ok && result.post) {
      await renderEditor({ selectedSlug: result.post.slug, statusText: await saveSuccessMessage(result) });
      return;
    }

    await renderEditor({ statusText: `trash failed: ${saveFailureMessage(result.reason)}` });
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
  let posts = local.slug && !isBootstrapArticle(local)
    ? [{ title: local.title, slug: local.slug, status: local.status }]
    : [];

  const [postResult, titleResult] = await Promise.all([
    isIndexPage || isBootstrapArticle({ slug: requestedSlug })
      ? Promise.resolve({ ok: false, post: null })
      : requestedSlug
        ? getPostBySlug(requestedSlug)
        : getLatestPublishedPost(),
    listPostTitles()
  ]);

  if (postResult.ok && postResult.post && !isBootstrapArticle(postResult.post)) {
    article = normalizeArticle(postResult.post);
    setCurrentArticle(article);
  }

  if (titleResult.ok) {
    posts = filterBootstrapPosts(sortPostSummaries(dedupePostTitles(titleResult.posts)));
  }

  if ((!article.title || isBootstrapArticle(article)) && posts[0]) {
    article = normalizeArticle(posts[0]);
    setCurrentArticle(article);
  } else if ((!article.title || isBootstrapArticle(article)) && hasSupabaseConfig()) {
    article = normalizeArticle(blankArticle());
    setCurrentArticle(article);
  }

  if (isIndexPage) {
    renderIndexPage(posts);
    return;
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
