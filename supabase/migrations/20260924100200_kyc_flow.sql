-- Phase 3: KYC submission and review.
-- Files reach the private bucket only through the server ingest pipeline
-- (validate + re-encode + strip EXIF, service role). These functions run with
-- the caller's own session so auth.uid() and the audit log see the real actor.

-- Customer: register an uploaded document. Path must be the caller's own
-- folder and the object must exist (only the server can put it there).
create function public.submit_kyc(p_doc_type public.kyc_doc_type, p_storage_path text, p_file_sha256 text)
returns public.kyc_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_profile public.profiles;
  v_object record;
  v_row public.kyc_submissions;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '42501';
  end if;
  select * into v_profile from public.profiles where id = v_uid;
  if v_profile.phone_verified_at is null then
    raise exception 'PHONE_NOT_VERIFIED' using errcode = '42501';
  end if;
  if v_profile.is_blocked then
    raise exception 'CUSTOMER_BLOCKED' using errcode = '42501';
  end if;
  if v_profile.kyc_status = 'verified' then
    raise exception 'KYC_ALREADY_VERIFIED' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.kyc_submissions where user_id = v_uid and status = 'pending') then
    raise exception 'KYC_ALREADY_PENDING' using errcode = 'P0001';
  end if;
  if (select count(*) from public.kyc_submissions
       where user_id = v_uid and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'KYC_RATE_LIMIT' using errcode = 'P0001';
  end if;
  if p_storage_path !~ ('^' || v_uid::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$') then
    raise exception 'KYC_INVALID_PATH' using errcode = '42501';
  end if;

  select (o.metadata ->> 'size')::integer as size, o.metadata ->> 'mimetype' as mime
    into v_object
    from storage.objects o
   where o.bucket_id = 'kyc-documents' and o.name = p_storage_path;
  if not found then
    raise exception 'KYC_FILE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_object.mime is distinct from 'image/jpeg' then
    raise exception 'KYC_INVALID_FILE' using errcode = 'P0001';
  end if;

  insert into public.kyc_submissions (id, user_id, doc_type, storage_path, file_sha256, mime, size_bytes)
  values (
    substring(p_storage_path from '/([0-9a-f-]{36})\.jpg$')::uuid,
    v_uid, p_doc_type, p_storage_path, p_file_sha256, 'image/jpeg', v_object.size
  )
  returning * into v_row;

  update public.profiles set kyc_status = 'pending', kyc_rejection_reason = null where id = v_uid;
  return v_row;
end;
$$;

-- Reviewer: record that a document was opened (called before the signed URL
-- is created) and get its path. Every view is in the audit log.
create function public.kyc_open_document(p_submission_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.kyc_submissions;
begin
  if not private.has_permission('kyc') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_row from public.kyc_submissions where id = p_submission_id;
  if not found or v_row.storage_path is null then
    raise exception 'KYC_FILE_NOT_AVAILABLE' using errcode = 'P0002';
  end if;
  insert into public.audit_logs (actor_id, actor_role, action, entity_type, entity_id, new_data)
  values ((select auth.uid()), 'authenticated', 'kyc_submissions.document_viewed',
          'kyc_submissions', p_submission_id::text,
          jsonb_build_object('user_id', v_row.user_id));
  return v_row.storage_path;
end;
$$;

-- Reviewer: approve or reject. Returns the storage path so the server can
-- delete the file (decisions.md: files are deleted after review).
create function public.review_kyc(p_submission_id uuid, p_approve boolean, p_reason text default null)
returns public.kyc_submissions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.kyc_submissions;
begin
  if not private.has_permission('kyc') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_row from public.kyc_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'KYC_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.user_id = v_uid then
    raise exception 'KYC_CANNOT_REVIEW_OWN' using errcode = '42501';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'KYC_NOT_PENDING' using errcode = 'P0001';
  end if;
  if not p_approve and coalesce(btrim(p_reason), '') = '' then
    raise exception 'KYC_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  update public.kyc_submissions
     set status = case when p_approve then 'accepted'::public.review_status else 'rejected'::public.review_status end,
         rejection_reason = case when p_approve then null else btrim(p_reason) end,
         reviewed_by = v_uid,
         reviewed_at = now()
   where id = p_submission_id
  returning * into v_row;

  update public.profiles
     set kyc_status = case when p_approve then 'verified'::public.kyc_status else 'rejected'::public.kyc_status end,
         kyc_rejection_reason = case when p_approve then null else btrim(p_reason) end
   where id = v_row.user_id;

  return v_row;
end;
$$;

-- Reviewer: after the server deleted the file through the Storage API, mark
-- it. Refuses while the object still exists, so the flag cannot lie.
create function public.kyc_mark_file_deleted(p_submission_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.kyc_submissions;
begin
  if not private.has_permission('kyc') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_row from public.kyc_submissions where id = p_submission_id for update;
  if not found or v_row.status = 'pending' or v_row.storage_path is null then
    raise exception 'KYC_NOTHING_TO_MARK' using errcode = 'P0001';
  end if;
  if exists (select 1 from storage.objects o
              where o.bucket_id = 'kyc-documents' and o.name = v_row.storage_path) then
    raise exception 'KYC_FILE_STILL_PRESENT' using errcode = 'P0001';
  end if;
  update public.kyc_submissions set storage_path = null, file_deleted_at = now()
   where id = p_submission_id;
end;
$$;

revoke execute on function public.submit_kyc(public.kyc_doc_type, text, text) from public, anon;
revoke execute on function public.kyc_open_document(uuid) from public, anon;
revoke execute on function public.review_kyc(uuid, boolean, text) from public, anon;
revoke execute on function public.kyc_mark_file_deleted(uuid) from public, anon;
grant execute on function public.submit_kyc(public.kyc_doc_type, text, text) to authenticated;
grant execute on function public.kyc_open_document(uuid) to authenticated;
grant execute on function public.review_kyc(uuid, boolean, text) to authenticated;
grant execute on function public.kyc_mark_file_deleted(uuid) to authenticated;

-- Reviewers may delete a document only after it has been reviewed.
create policy "kyc-documents: reviewers delete reviewed"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'kyc-documents'
    and (select private.has_permission('kyc'))
    and not exists (
      select 1 from public.kyc_submissions k
       where k.storage_path = name and k.status = 'pending'
    )
  );
