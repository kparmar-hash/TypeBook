-- =====================================================================================================
-- Typebook: scrub the content of deleted things
--
-- HOW TO RUN: Supabase dashboard -> SQL Editor -> New query -> paste this whole file -> Run.
-- Run it AFTER 20261109000000_init.sql. Safe to run again.
--
-- WHY: deleting a page, block or notebook keeps a small "tombstone" row so that a device which was offline
-- cannot bring the deleted thing back when it reconnects (and so Undo works). Until now the tombstone also kept
-- the full content for 30 days. From now on, as soon as something is deleted the server empties it:
--
--     page        -> title, tags, text and images are emptied; the row stays with deleted = true
--     block       -> its text and PDF link are emptied; id, position and deleted = true stay
--     notebook    -> its name and page order are emptied, and every page in it is scrubbed as above
--
-- Rows are removed completely after 30 days (purge_tombstones). Undo still works: the device that deleted
-- keeps the content in memory and sends it again, which brings the item back.
--
-- This file also scrubs everything that was ALREADY deleted before it ran (section 4).
-- NOTE: pasted images live in Storage, not in the database. Deleting a page does not remove its image files;
-- that is a separate clean-up and is not done here.
-- =====================================================================================================

begin;

-- -----------------------------------------------------------------------------------------------------
-- 1. Scrub helper + merge that applies it
-- -----------------------------------------------------------------------------------------------------

create or replace function public.tb_scrub_item(item jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(item -> 'deleted' = 'true'::jsonb, false)
      then (item - 'ref') || case when item ? 'text' then jsonb_build_object('text', '') else '{}'::jsonb end
    else item
  end
$$;

revoke all on function public.tb_scrub_item(jsonb) from public, anon;
grant execute on function public.tb_scrub_item(jsonb) to authenticated;

create or replace function public.tb_merge_items(a jsonb, b jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.tb_scrub_item(w.item) order by w.id), '[]'::jsonb)
  from (
    select distinct on (u.id) u.id, u.item
    from (
      select x ->> 'id' as id, x as item
        from jsonb_array_elements(case when jsonb_typeof(a) = 'array' then a else '[]'::jsonb end) x
       where x ->> 'id' is not null
      union all
      select x ->> 'id', x
        from jsonb_array_elements(case when jsonb_typeof(b) = 'array' then b else '[]'::jsonb end) x
       where x ->> 'id' is not null
    ) u
    order by u.id,
             (u.item ->> 'updatedAt') desc nulls last,
             coalesce(u.item -> 'deleted' = 'true'::jsonb, false) desc,
             u.item::text desc
  ) w
$$;

-- -----------------------------------------------------------------------------------------------------
-- 2. save_page: a deleted page is stored empty
-- -----------------------------------------------------------------------------------------------------

create or replace function public.save_page(p_notebook_id text, p_page jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid        uuid := auth.uid();
  pid        text := p_page ->> 'id';
  inc_at     timestamptz;
  inc_del    boolean;
  inc_title  text;
  inc_paper  text;
  inc_tags   text[];
  cur        public.pages%rowtype;
  won        boolean;
  final_del  boolean;
  res        public.pages%rowtype;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_page) is distinct from 'object' then
    raise exception 'page must be a JSON object' using errcode = '22023';
  end if;
  if pid is null or pid !~ '^pg_[0-9A-Z]{26}$' then
    raise exception 'invalid page id' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_page -> 'blocks', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_page -> 'images', '[]'::jsonb)) is distinct from 'array'
     or jsonb_typeof(coalesce(p_page -> 'tags', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'blocks, images and tags must be arrays' using errcode = '22023';
  end if;

  inc_at    := (p_page ->> 'updatedAt')::timestamptz;
  inc_del   := coalesce((p_page ->> 'deleted')::boolean, false);
  inc_title := coalesce(p_page ->> 'title', '');
  inc_paper := coalesce(p_page ->> 'paper', 'default');
  inc_tags  := array(select jsonb_array_elements_text(coalesce(p_page -> 'tags', '[]'::jsonb)));
  if inc_at is null then
    raise exception 'updatedAt is required' using errcode = '22023';
  end if;

  -- Make sure the row exists (a no-op if it does), then lock it for the merge.
  insert into public.pages (user_id, id, notebook_id, title, paper, tags, deleted, blocks, images, updated_at)
  values (uid, pid, p_notebook_id, inc_title, inc_paper, inc_tags, inc_del,
          coalesce(p_page -> 'blocks', '[]'::jsonb), coalesce(p_page -> 'images', '[]'::jsonb), inc_at)
  on conflict (user_id, id) do nothing;

  select * into cur from public.pages where user_id = uid and id = pid for update;
  if cur.notebook_id <> p_notebook_id then
    raise exception 'that page belongs to a different notebook' using errcode = '42501';
  end if;

  won := inc_at > cur.updated_at or (inc_at = cur.updated_at and inc_del and not cur.deleted);
  final_del := case when won then inc_del else cur.deleted end;

  update public.pages set
    title      = case when final_del then '' when won then inc_title else cur.title end,
    paper      = case when won then inc_paper else cur.paper end,
    tags       = case when final_del then '{}'::text[] when won then inc_tags else cur.tags end,
    deleted    = final_del,
    blocks     = case when final_del then '[]'::jsonb
                      else public.tb_merge_items(cur.blocks, coalesce(p_page -> 'blocks', '[]'::jsonb)) end,
    images     = case when final_del then '[]'::jsonb
                      else public.tb_merge_items(cur.images, coalesce(p_page -> 'images', '[]'::jsonb)) end,
    updated_at = greatest(cur.updated_at, inc_at)
  where user_id = uid and id = pid
  returning * into res;

  return jsonb_build_object(
           'schema', 1,
           'id', res.id,
           'title', res.title,
           'paper', res.paper,
           'tags', to_jsonb(res.tags),
           'updatedAt', public.tb_iso(res.updated_at),
           'blocks', res.blocks,
           'images', res.images)
         || case when res.deleted then jsonb_build_object('deleted', true) else '{}'::jsonb end;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 3. save_notebook: a deleted notebook is stored empty, and so is every page in it
-- -----------------------------------------------------------------------------------------------------

create or replace function public.save_notebook(p_notebook jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid        uuid := auth.uid();
  nid        text := p_notebook ->> 'id';
  inc_at     timestamptz;
  inc_del    boolean;
  inc_order  text[];
  cur        public.notebooks%rowtype;
  won        boolean;
  final_del  boolean;
  win_order  text[];
  lose_order text[];
  res        public.notebooks%rowtype;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if jsonb_typeof(p_notebook) is distinct from 'object' then
    raise exception 'notebook must be a JSON object' using errcode = '22023';
  end if;
  if nid is null or nid !~ '^nb_[0-9A-Z]{26}$' then
    raise exception 'invalid notebook id' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_notebook -> 'pageOrder', '[]'::jsonb)) is distinct from 'array' then
    raise exception 'pageOrder must be an array' using errcode = '22023';
  end if;

  inc_at    := (p_notebook ->> 'updatedAt')::timestamptz;
  inc_del   := coalesce((p_notebook ->> 'deleted')::boolean, false);
  inc_order := array(select jsonb_array_elements_text(coalesce(p_notebook -> 'pageOrder', '[]'::jsonb)));
  if inc_at is null then
    raise exception 'updatedAt is required' using errcode = '22023';
  end if;

  insert into public.notebooks (user_id, id, name, paper, font, font_size, ink, margin, page_order, deleted, updated_at)
  values (uid, nid,
          coalesce(p_notebook ->> 'name', 'Untitled notebook'),
          coalesce(p_notebook ->> 'paper', 'ruled'),
          coalesce(p_notebook ->> 'font', 'caveat'),
          coalesce((p_notebook ->> 'fontSize')::integer, 24),
          coalesce(p_notebook ->> 'ink', 'blue'),
          coalesce((p_notebook ->> 'margin')::boolean, true),
          inc_order, inc_del, inc_at)
  on conflict (user_id, id) do nothing;

  select * into cur from public.notebooks where user_id = uid and id = nid for update;

  won := inc_at > cur.updated_at or (inc_at = cur.updated_at and inc_del and not cur.deleted);
  final_del := case when won then inc_del else cur.deleted end;
  win_order  := case when won then inc_order else cur.page_order end;
  lose_order := case when won then cur.page_order else inc_order end;

  -- The winner's page order, plus any pages only the other side knows about.
  win_order := win_order || array(
    select t.x from unnest(lose_order) with ordinality as t(x, i)
    where t.x <> all (win_order) order by t.i);

  update public.notebooks set
    name       = case when final_del then 'Deleted notebook'
                      when won then coalesce(p_notebook ->> 'name', cur.name) else cur.name end,
    paper      = case when won then coalesce(p_notebook ->> 'paper', cur.paper) else cur.paper end,
    font       = case when won then coalesce(p_notebook ->> 'font', cur.font) else cur.font end,
    font_size  = case when won then coalesce((p_notebook ->> 'fontSize')::integer, cur.font_size) else cur.font_size end,
    ink        = case when won then coalesce(p_notebook ->> 'ink', cur.ink) else cur.ink end,
    margin     = case when won then coalesce((p_notebook ->> 'margin')::boolean, cur.margin) else cur.margin end,
    deleted    = final_del,
    page_order = case when final_del then '{}'::text[] else win_order end,
    updated_at = greatest(cur.updated_at, inc_at)
  where user_id = uid and id = nid
  returning * into res;

  -- Deleting a notebook deletes everything in it.
  if res.deleted then
    update public.pages set
      deleted    = true,
      title      = '',
      tags       = '{}'::text[],
      blocks     = '[]'::jsonb,
      images     = '[]'::jsonb,
      updated_at = greatest(updated_at, res.updated_at)
    where user_id = uid and notebook_id = nid;
  end if;

  return jsonb_build_object(
           'schema', 1,
           'id', res.id,
           'name', res.name,
           'paper', res.paper,
           'font', res.font,
           'fontSize', res.font_size,
           'ink', res.ink,
           'margin', res.margin,
           'pageOrder', to_jsonb(res.page_order),
           'updatedAt', public.tb_iso(res.updated_at))
         || case when res.deleted then jsonb_build_object('deleted', true) else '{}'::jsonb end;
end;
$$;

-- -----------------------------------------------------------------------------------------------------
-- 4. Scrub what was deleted before this file existed
--    (Run by the SQL editor's admin role, which is allowed to see every row.)
-- -----------------------------------------------------------------------------------------------------

-- pages inside deleted notebooks
update public.pages p set deleted = true
  from public.notebooks n
 where n.user_id = p.user_id and n.id = p.notebook_id and n.deleted and not p.deleted;

-- deleted notebooks
update public.notebooks
   set name = 'Deleted notebook', page_order = '{}'::text[]
 where deleted and (name <> 'Deleted notebook' or cardinality(page_order) > 0);

-- deleted pages
update public.pages
   set title = '', tags = '{}'::text[], blocks = '[]'::jsonb, images = '[]'::jsonb
 where deleted
   and (title <> '' or cardinality(tags) > 0 or blocks <> '[]'::jsonb or images <> '[]'::jsonb);

-- deleted blocks inside pages that still exist
update public.pages p
   set blocks = (select coalesce(jsonb_agg(public.tb_scrub_item(b.item) order by b.ord), '[]'::jsonb)
                   from jsonb_array_elements(p.blocks) with ordinality as b(item, ord))
 where not p.deleted
   and exists (select 1 from jsonb_array_elements(p.blocks) x
                where coalesce(x -> 'deleted' = 'true'::jsonb, false)
                  and ((x ? 'text' and x ->> 'text' <> '') or x ? 'ref'));

commit;

-- =====================================================================================================
-- CHECK IT WORKED (optional): this should return zero rows.
--
--   select id, title, deleted from public.pages
--    where deleted and (title <> '' or cardinality(tags) > 0 or blocks <> '[]'::jsonb);
-- =====================================================================================================
