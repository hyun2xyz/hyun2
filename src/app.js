import { getLatestPublishedPost } from './supabase-client.js';

const fallbackArticle = {
  title: '가안: 가운데에 놓인 글',
  excerpt: 'Hyun2 첫 번째 발행면',
  content: [
    '이곳은 HTML을 직접 고치지 않고, 웹 안에서 글을 쓰고 발행하기 위한 작은 시작점입니다.',
    '지금은 한 편의 글이 화면 가운데 조용히 놓여 있습니다. 다음 단계에서는 Supabase의 published 글을 읽어오고, 나만 들어갈 수 있는 쓰기 화면을 붙이면 됩니다.',
    '글은 페이지의 장식보다 먼저 오고, 도구는 글을 방해하지 않는 만큼만 남깁니다.'
  ].join('\n\n'),
  updated_at: new Date().toISOString()
};

function splitParagraphs(content) {
  if (Array.isArray(content)) return content;
  return String(content ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function formatDate(value) {
  if (!value) return 'draft';
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  }).format(new Date(value));
}

export function renderArticle(article, source = 'local') {
  const root = document.querySelector('#article-root');
  const paragraphs = splitParagraphs(article.content);

  root.innerHTML = `
    <div class="article__meta">${article.excerpt ?? 'Hyun2'} · ${source}</div>
    <h1 class="article__title">${article.title}</h1>
    <div class="article__body">
      ${paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join('')}
    </div>
    <footer class="article__footer">${formatDate(article.published_at ?? article.updated_at)}</footer>
  `;
}

async function boot() {
  renderArticle(fallbackArticle, 'local');

  const result = await getLatestPublishedPost();
  if (result.ok && result.post) {
    renderArticle(result.post, 'supabase');
  }
}

boot();
