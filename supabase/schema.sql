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

grant usage on schema public to anon, authenticated;
grant select on table public.posts to anon;
grant select, insert, update, delete on table public.posts to authenticated;

create or replace function public.set_post_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_post_updated_at on public.posts;
create trigger set_post_updated_at
before update on public.posts
for each row execute function public.set_post_updated_at();

drop policy if exists "published posts are readable by anyone" on public.posts;
create policy "published posts are readable by anyone"
on public.posts
for select
to anon, authenticated
using (status = 'published');

drop policy if exists "authors can create own posts" on public.posts;
drop policy if exists "authors can update own posts" on public.posts;
drop policy if exists "authors can read own posts" on public.posts;
drop policy if exists "authenticated users can manage posts" on public.posts;
create policy "authenticated users can manage posts"
on public.posts
for all
to authenticated
using ((select auth.uid()) is not null and (author_id is null or author_id = (select auth.uid())))
with check ((select auth.uid()) is not null and (author_id is null or author_id = (select auth.uid())));

create index if not exists posts_status_published_at_idx
on public.posts (status, published_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'post-images',
  'post-images',
  true,
  52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "post images bucket is visible" on storage.buckets;
create policy "post images bucket is visible"
on storage.buckets
for select
to anon, authenticated
using (id = 'post-images');

drop policy if exists "post images are readable by anyone" on storage.objects;

drop policy if exists "authenticated users can upload post images" on storage.objects;
create policy "authenticated users can upload post images"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'post-images' and (select auth.uid()) is not null);

drop policy if exists "authenticated users can update post images" on storage.objects;
create policy "authenticated users can update post images"
on storage.objects
for update
to authenticated
using (bucket_id = 'post-images' and (select auth.uid()) is not null)
with check (bucket_id = 'post-images' and (select auth.uid()) is not null);

drop policy if exists "authenticated users can delete post images" on storage.objects;
create policy "authenticated users can delete post images"
on storage.objects
for delete
to authenticated
using (bucket_id = 'post-images' and (select auth.uid()) is not null);
