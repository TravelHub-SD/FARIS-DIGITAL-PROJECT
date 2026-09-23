-- Storage buckets. Access policies live in the security migration.
-- Private buckets accept only server re-encoded JPEGs (EXIF stripped upstream).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('kyc-documents', 'kyc-documents', false, 5242880, array['image/jpeg']),
  ('payment-receipts', 'payment-receipts', false, 5242880, array['image/jpeg']),
  ('public-assets', 'public-assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
