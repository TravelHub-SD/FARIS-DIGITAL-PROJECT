-- Storage access. storage.objects has RLS enabled by Supabase; with no policy
-- a bucket is deny-all for anon/authenticated. Private buckets get NO insert,
-- update or delete policy: only the server ingest pipeline (service_role)
-- writes, after validating and re-encoding the image.

-- KYC documents: only KYC reviewers can read (needed to create signed URLs).
create policy "kyc-documents: reviewers read"
  on storage.objects for select to authenticated
  using (bucket_id = 'kyc-documents' and (select private.has_permission('kyc')));

-- Receipts: the customer's own folder ({user_id}/...) or orders admins.
create policy "payment-receipts: owner or orders staff read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'payment-receipts'
    and (
      (storage.foldername(name))[1] = (select auth.uid())::text
      or (select private.has_permission('orders'))
    )
  );

-- Public assets: world-readable through public URLs (bucket is public);
-- writes by catalog/settings admins only. No listing policy for anon.
create policy "public-assets: staff insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'public-assets'
    and ((select private.has_permission('products')) or (select private.has_permission('settings')))
  );
create policy "public-assets: staff update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'public-assets'
    and ((select private.has_permission('products')) or (select private.has_permission('settings')))
  );
create policy "public-assets: staff delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'public-assets'
    and ((select private.has_permission('products')) or (select private.has_permission('settings')))
  );
create policy "public-assets: staff list"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'public-assets'
    and ((select private.has_permission('products')) or (select private.has_permission('settings')))
  );
