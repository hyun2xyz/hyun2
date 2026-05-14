create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid default auth.uid() references auth.users(id) on delete set null,
  title text not null,
  slug text not null unique,
  excerpt text,
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.posts enable row level security;

drop policy if exists "published posts are readable by anyone" on public.posts;
create policy "published posts are readable by anyone"
on public.posts
for select
to anon, authenticated
using (status = 'published');

drop policy if exists "authors can create own posts" on public.posts;
create policy "authors can create own posts"
on public.posts
for insert
to authenticated
with check (author_id = auth.uid());

drop policy if exists "authors can update own posts" on public.posts;
create policy "authors can update own posts"
on public.posts
for update
to authenticated
using (author_id = auth.uid())
with check (author_id = auth.uid());

drop policy if exists "authors can read own posts" on public.posts;
create policy "authors can read own posts"
on public.posts
for select
to authenticated
using (author_id = auth.uid());

create index if not exists posts_status_published_at_idx
on public.posts (status, published_at desc);

insert into public.posts (title, slug, excerpt, content, status, published_at)
values (
  '가안: 가운데에 놓인 글',
  'centered-draft',
  'Hyun2 첫 번째 발행면',
  '이곳은 HTML을 직접 고치지 않고, 웹 안에서 글을 쓰고 발행하기 위한 작은 시작점입니다.

지금은 한 편의 글이 화면 가운데 조용히 놓여 있습니다. 다음 단계에서는 Supabase의 published 글을 읽어오고, 나만 들어갈 수 있는 쓰기 화면을 붙이면 됩니다.

글은 페이지의 장식보다 먼저 오고, 도구는 글을 방해하지 않는 만큼만 남깁니다.',
  'published',
  now()
)
on conflict (slug) do nothing;
