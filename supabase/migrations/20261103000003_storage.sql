-- Storage buckets for host media. All buckets are public-read (served via CDN URL);
-- writes are restricted by path:
--   lot-media/{auction_id}/{lot_id}/{file}     host of auction
--   auction-branding/{auction_id}/{file}       host of auction
--   avatars/{user_id}/{file}                   the user

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('lot-media', 'lot-media', true, 52428800,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']),
  ('auction-branding', 'auction-branding', true, 2097152,
    array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']),
  ('avatars', 'avatars', true, 1048576,
    array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create or replace function public.storage_path_is_host(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  aid uuid;
begin
  begin
    aid := ((storage.foldername(p_name))[1])::uuid;
  exception when others then
    return false;
  end;
  return public.is_auction_host(aid);
end;
$$;

create policy "host media insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('lot-media', 'auction-branding') and public.storage_path_is_host(name));
create policy "host media update" on storage.objects for update to authenticated
  using (bucket_id in ('lot-media', 'auction-branding') and public.storage_path_is_host(name));
create policy "host media delete" on storage.objects for delete to authenticated
  using (bucket_id in ('lot-media', 'auction-branding') and public.storage_path_is_host(name));

create policy "avatar insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar update own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
