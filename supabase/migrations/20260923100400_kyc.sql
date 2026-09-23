-- KYC submissions. The image file is deleted after review (decisions.md);
-- the row keeps verdict, reviewer, timestamps and the file hash.

create table public.kyc_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  doc_type public.kyc_doc_type not null,
  status public.review_status not null default 'pending',
  storage_path text,
  file_sha256 text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  mime text not null check (mime = 'image/jpeg'),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  rejection_reason text check (char_length(rejection_reason) <= 500),
  reviewed_by uuid references public.profiles (id),
  reviewed_at timestamptz,
  file_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'rejected' or rejection_reason is not null),
  check ((status = 'pending') = (reviewed_at is null)),
  check (file_deleted_at is null or storage_path is null)
);

-- One open submission per customer.
create unique index kyc_submissions_one_pending
  on public.kyc_submissions (user_id) where status = 'pending';
create index kyc_submissions_queue on public.kyc_submissions (status, created_at);
create index kyc_submissions_user on public.kyc_submissions (user_id, created_at desc);

create trigger kyc_submissions_set_updated_at
  before update on public.kyc_submissions
  for each row execute function private.set_updated_at();
