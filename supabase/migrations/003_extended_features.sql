-- Administrative suspension, transactional credit packs, and processing projects.
alter table public.profiles add column if not exists status text not null default 'active' check(status in ('active','suspended'));
create table if not exists public.credit_packs(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('text','image')),
 units integer not null check(units>0),price_kes integer not null check(price_kes>0),
 enabled boolean not null default true, created_at timestamptz not null default now(),
 unique(kind,units)
);
insert into public.credit_packs(kind,units,price_kes) values('text',100,99),('image',10,199)
on conflict(kind,units) do nothing;
alter table public.credit_packs enable row level security;
create policy packs_read on public.credit_packs for select to authenticated using(enabled);
alter table public.payments add column if not exists credit_pack_id uuid references public.credit_packs(id);
alter table public.clip_projects add column if not exists created_by uuid references auth.users(id);
alter table public.clip_projects add column if not exists credit_tx_id uuid references public.credit_transactions(id);
alter table public.clip_projects add column if not exists output_media_id uuid references public.media_assets(id);
alter table public.clip_projects add column if not exists error_message text;
alter table public.clip_projects add column if not exists updated_at timestamptz not null default now();
create index if not exists clip_projects_status_idx on public.clip_projects(status);

-- fulfill_verified_payment is defined once, in 004_multicurrency_paypal.sql.
