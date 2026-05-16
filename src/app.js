import {
  getEditablePost,
  getLatestPublishedPost,
  getPostBySlug,
  hasSupabaseConfig,
  listPostTitles,
  refreshSession,
  savePostWithSession,
  signInWithPassword
} from './supabase-client.js?v=20260516-publish-trash';

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

function noteDotMarkup(note = '', url = '') {
  return `<button class="note-dot" type="button" contenteditable="false" data-note="${escapeHtml(note)}" data-url="${escapeHtml(url)}" aria-label="각주" title="${escapeHtml(url || note || '각주')}"></button>`;
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
        return {
          type: 'image',
          src: String(block.src),
          alt: String(block.alt ?? '')
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
        style: normalizeTypeSettings(parsed.style)
      };
    }
  } catch {
    // Plain text is the default authoring format.
  }

  return {
    body: raw,
    blocks: blocksFromText(raw),
    style: normalizeTypeSettings()
  };
}

function encodeContent(body, style, blocks = null) {
  const normalizedBlocks = normalizeBlocks(blocks, body);

  return JSON.stringify({
    body: String(body ?? ''),
    blocks: normalizedBlocks,
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

  return {
    ...merged,
    content: decoded.body,
    blocks,
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

function imageBlockMarkup(block) {
  return `
    <figure class="article-image" data-block-type="image" contenteditable="false">
      <img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt ?? '')}">
    </figure>
  `;
}

function blockMarkup(block) {
  if (block.type === 'image') return imageBlockMarkup(block);
  const lineHeight = normalizeBlockLineHeight(block.lineHeight);
  const lineAttrs = lineHeight
    ? ` style="line-height: ${escapeHtml(lineHeight)}" data-line-height="${escapeHtml(lineHeight)}"`
    : '';
  return `<p${lineAttrs}>${block.html ? sanitizeInlineHtml(block.html) : escapeHtml(block.text)}</p>`;
}

function articleMarkup(article, options = {}) {
  const view = normalizeArticle(article);
  const date = formatDate(view.published_at ?? view.updated_at);
  const blocks = view.blocks.length ? view.blocks : blocksFromText(view.content);

  return `
    <h1 class="article__title">${escapeHtml(view.title)}</h1>
    ${date ? `<time class="article__date" datetime="${escapeHtml(view.published_at ?? view.updated_at)}">${escapeHtml(date)}</time>` : ''}
    <div class="article__body">
      ${blocks.map(blockMarkup).join('')}
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
  if (!chrome.length) return;

  let lastY = window.scrollY;
  let timer = 0;

  const show = () => chrome.forEach((element) => element.classList.remove('is-dissolved'));
  const hide = () => chrome.forEach((element) => element.classList.add('is-dissolved'));

  window.addEventListener('scroll', () => {
    window.clearTimeout(timer);
    const nextY = window.scrollY;
    if (nextY <= 24 || nextY < lastY) {
      show();
    } else if (nextY > 36) {
      timer = window.setTimeout(hide, 160);
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
              <time>${escapeHtml(formatDate(post.published_at ?? post.updated_at))}</time>
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
        return image?.src ? { type: 'image', src: image.src, alt: image.alt } : null;
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
  const textBlocks = blocks.filter((block) => block.type === 'text');
  const body = content || (blocks.some((block) => block.type === 'image') ? '' : fallbackArticle.content);
  const status = publishEnabled() ? 'published' : 'draft';
  const publishedAt = status === 'published' ? new Date().toISOString() : null;

  return normalizeArticle({
    ...article,
    title: title || '제목 없는 글',
    slug: article.id ? article.slug : article.slug || slugify(title),
    author_id: article.author_id ?? session?.user?.id,
    excerpt: textBlocks[0]?.text.slice(0, 90) ?? 'Hyun2',
    content: body,
    blocks: blocks.length ? blocks : blocksFromText(body),
    style,
    status,
    published_at: publishedAt
  });
}

function articleForSupabase(article) {
  const next = normalizeArticle(article);
  return {
    ...next,
    content: encodeContent(next.content, next.style, next.blocks)
  };
}

function imageFilesFromDataTransfer(dataTransfer) {
  return Array.from(dataTransfer?.files ?? [])
    .filter((file) => file.type.startsWith('image/'));
}

function dataUrlFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result)));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

function imageFigureFromFile(src, file) {
  const figure = document.createElement('figure');
  figure.className = 'article-image';
  figure.dataset.blockType = 'image';
  figure.contentEditable = 'false';

  const image = document.createElement('img');
  image.src = src;
  image.alt = file.name || 'uploaded image';
  figure.append(image);

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

async function insertImageFiles(files, contentRoot, event = null) {
  for (const file of files) {
    const src = await dataUrlFromFile(file);
    insertImageNode(contentRoot, imageFigureFromFile(src, file), event);
  }
}

function attachImageDrop(contentRoot, statusRoot) {
  contentRoot.addEventListener('dragover', (event) => {
    if (!imageFilesFromDataTransfer(event.dataTransfer).length) return;
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
    await insertImageFiles(files, contentRoot, event);
    statusRoot.textContent = 'image added. save to publish.';
  });

  contentRoot.addEventListener('paste', async (event) => {
    const files = imageFilesFromDataTransfer(event.clipboardData);
    if (!files.length) return;

    event.preventDefault();
    await insertImageFiles(files, contentRoot);
    statusRoot.textContent = 'image added. save to publish.';
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

  insertInlineNode(contentRoot, noteDotElement(value), { replaceSelection: false });
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

function attachEditorFormatting(root, contentRoot, statusRoot) {
  root.querySelector('[data-action="underline"]')?.addEventListener('click', () => {
    underlineSelection(contentRoot, statusRoot);
  });

  root.querySelector('[data-action="note"]')?.addEventListener('click', () => {
    insertNoteDot(contentRoot, statusRoot);
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

  const activePosts = posts.filter((post) => post.status !== 'archived');
  const trashPosts = posts.filter((post) => post.status === 'archived');
  const renderButton = (post) => `
      <button
        class="index-link ${post.slug === selectedSlug ? 'is-selected' : ''}"
        type="button"
        data-action="select-post"
        data-slug="${escapeHtml(post.slug)}"
      >${escapeHtml(post.title)}</button>
    `;

  return `
    <section class="admin-index__group">
      <p>published / draft</p>
      ${activePosts.length ? activePosts.map(renderButton).join('') : '<span class="empty-state">비어 있습니다.</span>'}
    </section>
    <section class="admin-index__group">
      <p>trash</p>
      ${trashPosts.length ? trashPosts.map(renderButton).join('') : '<span class="empty-state">비어 있습니다.</span>'}
    </section>
  `;
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
      ?? posts.find((post) => post.status !== 'archived')?.slug
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
        </div>
        <nav>
          ${renderAdminIndex(posts, article.slug)}
        </nav>
      </aside>

      <section class="editor" data-panel="editor">
        <div class="editor__bar">
          <button type="button" data-action="new">new</button>
          <button type="button" data-action="save">save</button>
          <button type="button" data-action="publish" aria-pressed="${article.status === 'published'}">${article.status === 'published' ? 'published' : 'publish'}</button>
          <a class="button-link" href="./${article.slug ? `?post=${encodeURIComponent(article.slug)}` : ''}">read</a>
          <button type="button" data-action="trash">trash</button>
          ${session ? '<button type="button" data-action="logout">logout</button>' : ''}
        </div>

        <div class="editor__tools" data-panel="tools" aria-label="글 수정 도구">
          <button class="tool-button" type="button" data-action="underline" title="선택한 글자에 밑줄">U</button>
          <button class="tool-button note-tool" type="button" data-action="note" title="선택한 글자 옆에 파란 주석 표시 추가">ㅇ</button>
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
          <label>
            indent
            <span><input name="indentPt" type="number" min="0" max="120" step="1" value="${style.indentPt}"> pt</span>
          </label>
        </div>

        <h1 class="article__title editor__title" data-field="title" contenteditable="true" spellcheck="true">${escapeHtml(article.title)}</h1>
        <div class="article__body editor__content" data-field="content" contenteditable="true" spellcheck="true">${normalizeArticle(article).blocks.map(blockMarkup).join('') || '<p><br></p>'}</div>
        <p class="editor__status">${escapeHtml(options.statusText ?? '')}</p>
      </section>
    </div>
  `;

  attachThemeToggle(root);
  const contentRoot = root.querySelector('[data-field="content"]');
  const statusRoot = root.querySelector('.editor__status');
  attachImageDrop(contentRoot, statusRoot);
  attachEditorFormatting(root, contentRoot, statusRoot);
  attachNoteDots(root);

  root.querySelector('[data-action="publish"]').addEventListener('click', (event) => {
    const button = event.currentTarget;
    const next = button.getAttribute('aria-pressed') !== 'true';
    button.setAttribute('aria-pressed', String(next));
    button.textContent = next ? 'published' : 'publish';
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
  let posts = local.slug ? [{ title: local.title, slug: local.slug, status: local.status }] : [];

  const [postResult, titleResult] = await Promise.all([
    isIndexPage ? Promise.resolve({ ok: false, post: null }) : requestedSlug ? getPostBySlug(requestedSlug) : getLatestPublishedPost(),
    listPostTitles()
  ]);

  if (postResult.ok && postResult.post) {
    article = normalizeArticle(postResult.post);
    setCurrentArticle(article);
  }

  if (titleResult.ok) {
    posts = dedupePostTitles(titleResult.posts);
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
