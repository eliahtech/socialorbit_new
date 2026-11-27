-- SocialOrbit v0.2, first-install migration. Run once in a new Supabase project.
-- API uses service role strictly server-side and checks authenticated workspace membership.
-- RLS grants SELECT to tenant members and denies most writes unless the trusted API performs them.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', username text unique,
 avatar_url text, phone text, country text, timezone text not null default 'Africa/Nairobi',
 language text not null default 'en', created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.workspaces (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(trim(name)) between 2 and 100),
 slug text not null unique check(length(slug) between 3 and 60),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.workspace_members (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role text not null check(role in ('owner','admin','editor','analyst','viewer')),
 joined_at timestamptz not null default now(), primary key(workspace_id,user_id)
);
create index if not exists workspace_members_user_idx on public.workspace_members(user_id);
create table if not exists public.admin_roles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 role text not null check(role in ('super_admin','operations','billing','support','moderator','analyst')),
 created_at timestamptz not null default now()
);
-- Only a trusted administrator through Supabase SQL Editor may bootstrap admin_roles.
create or replace function public.is_member(p_workspace uuid) returns boolean language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=(select auth.uid()));
$$;
create or replace function public.member_role(p_workspace uuid) returns text language sql stable security definer set search_path = '' as $$
 select m.role from public.workspace_members m where m.workspace_id=p_workspace and m.user_id=(select auth.uid()) limit 1;
$$;

create table if not exists public.plans (
 key text primary key check(key in ('free','creator','pro','agency')),
 price_kes integer not null check(price_kes>=0),
 accounts integer not null, old_videos integer not null, publishing_jobs integer not null,
 text_credits integer not null, image_credits integer not null, clips integer not null,
 evergreen_rules integer not null, inbox_threads integer not null, analytics_days integer not null,
 updated_at timestamptz not null default now()
);
insert into public.plans values
 ('free',0,2,20,20,20,2,1,1,20,7,now()),
 ('creator',499,5,200,300,500,20,10,5,200,30,now()),
 ('pro',1499,15,1000,1500,2000,100,50,20,1000,90,now()),
 ('agency',3999,50,5000,6000,8000,400,200,100,5000,365,now())
on conflict(key) do nothing;
create table if not exists public.subscriptions (
 workspace_id uuid primary key references public.workspaces(id) on delete cascade,
 plan_key text not null default 'free' references public.plans(key),
 status text not null default 'active' check(status in ('active','past_due','cancelled','expired')),
 current_period_start timestamptz not null default now(),
 current_period_end timestamptz not null default (now()+interval '1 month'),
 updated_at timestamptz not null default now()
);
create table if not exists public.credit_wallets (
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 kind text not null check(kind in ('text','image','clips','publishing','old_video')),
 monthly_balance integer not null default 0 check(monthly_balance>=0),
 topup_balance integer not null default 0 check(topup_balance>=0),
 reserved integer not null default 0 check(reserved>=0),
 primary key(workspace_id,kind)
);
create table if not exists public.credit_transactions (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id) on delete cascade,
 kind text not null, units integer not null check(units>0),
 idempotency_key text not null, status text not null check(status in ('reserved','settled','released')),
 monthly_spent integer not null default 0, topup_spent integer not null default 0,
 reason text not null default '', created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), unique(workspace_id,idempotency_key)
);
create index if not exists credit_transactions_workspace_idx on public.credit_transactions(workspace_id,created_at desc);

-- Transactional and idempotent credit reservation. Grant EXECUTE only to trusted service_role.
create or replace function public.credit_reserve(p_workspace uuid,p_kind text,p_units integer,p_key text,p_reason text default '')
returns uuid language plpgsql security definer set search_path='' as $$
declare v_wallet public.credit_wallets%rowtype; v_tx public.credit_transactions%rowtype; v_id uuid;
begin
 if p_units<1 or p_units>100000 or length(p_key)<8 then raise exception 'Invalid credit request'; end if;
 select * into v_wallet from public.credit_wallets where workspace_id=p_workspace and kind=p_kind for update;
 if not found then raise exception 'Credit wallet not found'; end if;
 select * into v_tx from public.credit_transactions where workspace_id=p_workspace and idempotency_key=p_key;
 if found then
  if v_tx.kind<>p_kind or v_tx.units<>p_units then raise exception 'Idempotency key reused with different parameters'; end if;
  if v_tx.status='released' then raise exception 'Reservation already released'; end if;
  return v_tx.id;
 end if;
 if v_wallet.monthly_balance+v_wallet.topup_balance-v_wallet.reserved < p_units then raise exception 'Insufficient credits'; end if;
 update public.credit_wallets set reserved=reserved+p_units where workspace_id=p_workspace and kind=p_kind;
 insert into public.credit_transactions(workspace_id,kind,units,idempotency_key,status,reason)
 values(p_workspace,p_kind,p_units,p_key,'reserved',left(p_reason,300)) returning id into v_id;
 return v_id;
end;$$;
create or replace function public.credit_settle(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_tx public.credit_transactions%rowtype; v_wallet public.credit_wallets%rowtype; v_monthly integer; v_topup integer;
begin
 select * into v_tx from public.credit_transactions where id=p_id for update;
 if not found then raise exception 'Reservation missing'; end if;
 if v_tx.status='settled' then return; end if;
 if v_tx.status<>'reserved' then raise exception 'Reservation not settleable'; end if;
 select * into v_wallet from public.credit_wallets where workspace_id=v_tx.workspace_id and kind=v_tx.kind for update;
 v_monthly:=least(v_tx.units,v_wallet.monthly_balance);v_topup:=v_tx.units-v_monthly;
 if v_wallet.reserved<v_tx.units or v_wallet.topup_balance<v_topup then raise exception 'Inconsistent credit wallet';end if;
 update public.credit_wallets set monthly_balance=monthly_balance-v_monthly,topup_balance=topup_balance-v_topup,
 reserved=reserved-v_tx.units where workspace_id=v_tx.workspace_id and kind=v_tx.kind;
 update public.credit_transactions set status='settled',monthly_spent=v_monthly,topup_spent=v_topup,updated_at=now() where id=p_id;
end;$$;
create or replace function public.credit_release(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare v_tx public.credit_transactions%rowtype;
begin
 select * into v_tx from public.credit_transactions where id=p_id for update;
 if not found then raise exception 'Reservation missing';end if;
 if v_tx.status='released' then return;end if;
 if v_tx.status<>'reserved' then raise exception 'Settled transaction cannot be released';end if;
 update public.credit_wallets set reserved=reserved-v_tx.units where workspace_id=v_tx.workspace_id and kind=v_tx.kind;
 update public.credit_transactions set status='released',updated_at=now() where id=p_id;
end;$$;
revoke execute on function public.credit_reserve(uuid,text,integer,text,text) from public,anon,authenticated;
revoke execute on function public.credit_settle(uuid) from public,anon,authenticated;
revoke execute on function public.credit_release(uuid) from public,anon,authenticated;
grant execute on function public.credit_reserve(uuid,text,integer,text,text) to service_role;
grant execute on function public.credit_settle(uuid) to service_role;
grant execute on function public.credit_release(uuid) to service_role;

create or replace function public.on_auth_user() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'full_name','')) on conflict(id) do nothing;return new;end;$$;
drop trigger if exists socialorbit_auth_user on auth.users;
create trigger socialorbit_auth_user after insert on auth.users for each row execute function public.on_auth_user();
insert into public.profiles(id) select id from auth.users on conflict do nothing;
create or replace function public.on_workspace_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_members(workspace_id,user_id,role) values(new.id,new.owner_id,'owner');
 insert into public.subscriptions(workspace_id,plan_key) values(new.id,'free');
 insert into public.credit_wallets(workspace_id,kind,monthly_balance)
 values(new.id,'text',20),(new.id,'image',2),(new.id,'clips',1),(new.id,'publishing',20),(new.id,'old_video',20);
 return new;
end;$$;
drop trigger if exists socialorbit_workspace on public.workspaces;
create trigger socialorbit_workspace after insert on public.workspaces for each row execute function public.on_workspace_created();

create table if not exists public.social_accounts (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 provider text not null check(provider in ('facebook','youtube','instagram','tiktok','x','linkedin')),
 provider_account_id text not null, display_name text not null, status text not null default 'connected'
 check(status in ('connected','expired','disconnected','needs_review')),
 granted_scopes text[] not null default '{}', last_synced_at timestamptz,
 created_at timestamptz not null default now(),unique(workspace_id,provider,provider_account_id)
);
create table if not exists public.oauth_credentials (
 account_id uuid primary key references public.social_accounts(id) on delete cascade,
 access_token_ciphertext text not null, refresh_token_ciphertext text,expires_at timestamptz,
 updated_at timestamptz not null default now()
);
create table if not exists public.oauth_sessions (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 initiated_by uuid not null references auth.users(id),provider text not null,
 nonce text not null,verifier_ciphertext text,expires_at timestamptz not null default now()+interval '10 minutes',
 consumed_at timestamptz,created_at timestamptz not null default now()
);
create table if not exists public.connection_events (
 id bigint generated always as identity primary key,workspace_id uuid not null references public.workspaces(id) on delete cascade,
 account_id uuid references public.social_accounts(id) on delete set null,event text not null,
 details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);

create table if not exists public.content_items (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 created_by uuid not null references auth.users(id),title text not null check(length(title) between 1 and 160),
 body text not null default '',kind text not null default 'text' check(kind in ('text','image','video')),
 status text not null default 'draft' check(status in ('draft','awaiting_approval','scheduled','queued','processing','published','partially_published','failed','cancelled','expired')),
 is_historical boolean not null default false,source_account_id uuid references public.social_accounts(id) on delete set null,
 source_external_id text, source_url text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,source_account_id,source_external_id)
);
create index if not exists content_items_recent on public.content_items(workspace_id,created_at desc);
create table if not exists public.media_assets (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 content_id uuid references public.content_items(id) on delete set null,owner_id uuid not null references auth.users(id),
 bucket text not null,storage_path text not null unique,kind text not null check(kind in ('image','video')),
 mime_type text not null,bytes bigint not null check(bytes>0 and bytes<=104857600),
 status text not null default 'pending' check(status in ('pending','uploaded','verified','expired','deleted','failed')),
 expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default now()
);
create index if not exists media_expiry_idx on public.media_assets(expires_at) where status not in ('deleted','expired');
create table if not exists public.content_fingerprints (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 content_id uuid not null references public.content_items(id) on delete cascade,
 fingerprint text not null,method text not null check(method in ('sha256','perceptual','external_id')),
 unique(workspace_id,method,fingerprint)
);
create table if not exists public.content_variants (
 id uuid primary key default gen_random_uuid(),content_id uuid not null references public.content_items(id) on delete cascade,
 provider text not null,caption text not null default '',title text,language text not null default 'en',
 unique(content_id,provider,language)
);
create table if not exists public.publishing_jobs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 content_id uuid not null references public.content_items(id) on delete cascade,
 account_id uuid not null references public.social_accounts(id) on delete cascade,
 media_id uuid references public.media_assets(id),scheduled_at timestamptz not null,
 status text not null default 'scheduled' check(status in ('scheduled','queued','processing','published','failed','cancelled','needs_reconciliation')),
 idempotency_key text not null,external_post_id text,attempt_count integer not null default 0,
 error_code text,error_message text,credit_tx_id uuid references public.credit_transactions(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(workspace_id,idempotency_key)
);
create index if not exists jobs_due on public.publishing_jobs(status,scheduled_at);
create table if not exists public.publication_attempts (
 id bigint generated always as identity primary key,job_id uuid not null references public.publishing_jobs(id) on delete cascade,
 attempt_number integer not null,started_at timestamptz not null default now(),finished_at timestamptz,
 result text not null default 'started',error_code text,error_details text,
 unique(job_id,attempt_number)
);
create table if not exists public.automation_rules (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source_account_id uuid references public.social_accounts(id) on delete set null,
 title text not null,rule_type text not null check(rule_type in ('new_content','historical_video','evergreen')),
 is_enabled boolean not null default false, require_approval boolean not null default true,
 config jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);
create table if not exists public.sync_runs (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 account_id uuid not null references public.social_accounts(id) on delete cascade,
 status text not null,items_seen integer not null default 0,items_added integer not null default 0,
 error_message text,started_at timestamptz not null default now(),finished_at timestamptz
);
create table if not exists public.recycling_history (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 rule_id uuid not null references public.automation_rules(id) on delete cascade,
 content_id uuid not null references public.content_items(id) on delete cascade,
 published_at timestamptz not null default now()
);

create table if not exists public.ai_requests (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id),kind text not null,model text,provider text,
 status text not null check(status in ('processing','completed','failed')),
 tokens_in integer,tokens_out integer,credit_tx_id uuid references public.credit_transactions(id),
 error_message text,created_at timestamptz not null default now()
);
create table if not exists public.brand_kits (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 name text not null,colors jsonb not null default '[]'::jsonb,fonts jsonb not null default '[]'::jsonb,
 logo_url text,created_at timestamptz not null default now()
);
create table if not exists public.design_projects (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 title text not null,layers jsonb not null default '[]'::jsonb,canvas jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.clip_projects (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 source_media_id uuid references public.media_assets(id),status text not null default 'draft',
 segments jsonb not null default '[]'::jsonb,created_at timestamptz not null default now()
);
create table if not exists public.content_translations (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 content_id uuid not null references public.content_items(id) on delete cascade,
 language text not null,caption text not null,status text not null default 'review',unique(content_id,language)
);
create table if not exists public.metric_snapshots (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 job_id uuid references public.publishing_jobs(id) on delete set null,provider text not null,
 metrics jsonb not null default '{}'::jsonb,observed_at timestamptz not null default now()
);
create table if not exists public.inbox_threads (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 account_id uuid not null references public.social_accounts(id),external_id text not null,status text not null default 'open',
 assigned_to uuid references auth.users(id),created_at timestamptz not null default now(),unique(account_id,external_id)
);
create table if not exists public.inbox_messages (
 id uuid primary key default gen_random_uuid(),thread_id uuid not null references public.inbox_threads(id) on delete cascade,
 external_id text not null,body text not null,created_at timestamptz not null default now(),unique(thread_id,external_id)
);

create table if not exists public.support_tickets (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 user_id uuid not null references auth.users(id),subject text not null,category text not null
 check(category in ('bug','technical','feature','improvement','billing','other')),
 description text not null,priority text not null default 'normal' check(priority in ('low','normal','high')),
 status text not null default 'open' check(status in ('open','in_progress','under_review','resolved','closed')),
 assigned_to uuid references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table if not exists public.ticket_messages (
 id uuid primary key default gen_random_uuid(),ticket_id uuid not null references public.support_tickets(id) on delete cascade,
 sender_id uuid not null references auth.users(id),body text not null,internal boolean not null default false,
 created_at timestamptz not null default now()
);
create table if not exists public.feature_requests (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 created_by uuid not null references auth.users(id),title text not null,description text not null,
 status text not null default 'under_review' check(status in ('under_review','planned','in_development','released','declined')),
 created_at timestamptz not null default now()
);
create table if not exists public.feature_votes (
 feature_id uuid not null references public.feature_requests(id) on delete cascade,user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(feature_id,user_id)
);
create table if not exists public.notifications (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id) on delete cascade,
 workspace_id uuid references public.workspaces(id) on delete cascade,title text not null,body text not null,
 type text not null default 'info',read_at timestamptz,created_at timestamptz not null default now()
);
create table if not exists public.payments (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 initiated_by uuid references auth.users(id),provider text not null check(provider in ('mpesa','pesapal')),
 purpose text not null check(purpose in ('subscription','topup')),
 plan_key text references public.plans(key),credit_kind text,credit_quantity integer,
 amount_kes integer not null check(amount_kes>0),status text not null default 'pending'
 check(status in ('pending','processing','verified','failed','refunded')),
 merchant_reference text not null unique,provider_reference text,provider_payload jsonb,
 created_at timestamptz not null default now(),verified_at timestamptz
);
create table if not exists public.payment_events (
 id uuid primary key default gen_random_uuid(),provider text not null,external_id text not null,
 payload jsonb not null,received_at timestamptz not null default now(),unique(provider,external_id)
);
create table if not exists public.invoices (
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id) on delete cascade,
 payment_id uuid references public.payments(id),invoice_number text not null unique,
 total_kes integer not null,issued_at timestamptz not null default now()
);
create table if not exists public.feature_flags (
 key text primary key,enabled boolean not null default false,description text,updated_at timestamptz not null default now()
);
create table if not exists public.system_alerts (
 id uuid primary key default gen_random_uuid(),level text not null,message text not null,resolved_at timestamptz,created_at timestamptz not null default now()
);
create table if not exists public.audit_logs (
 id bigint generated always as identity primary key,actor_id uuid references auth.users(id),
 workspace_id uuid references public.workspaces(id) on delete set null,action text not null,
 object_id text,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now()
);

-- Enable row-level security everywhere, including sensitive tables with NO authenticated direct policies.
do $$ declare v_table text; begin
 foreach v_table in array array[
  'profiles','workspaces','workspace_members','admin_roles','plans','subscriptions','credit_wallets','credit_transactions',
  'social_accounts','oauth_credentials','oauth_sessions','connection_events','content_items','media_assets','content_fingerprints',
  'content_variants','publishing_jobs','publication_attempts','automation_rules','sync_runs','recycling_history',
  'ai_requests','brand_kits','design_projects','clip_projects','content_translations','metric_snapshots',
  'inbox_threads','inbox_messages','support_tickets','ticket_messages','feature_requests','feature_votes','notifications',
  'payments','payment_events','invoices','feature_flags','system_alerts','audit_logs']
 loop execute format('alter table public.%I enable row level security',v_table); end loop;
end;$$;
create policy profile_read on public.profiles for select to authenticated using(id=(select auth.uid()));
create policy workspace_read on public.workspaces for select to authenticated using(public.is_member(id));
create policy members_read on public.workspace_members for select to authenticated using(public.is_member(workspace_id));
create policy plans_read on public.plans for select to anon,authenticated using(true);
create policy subscription_read on public.subscriptions for select to authenticated using(public.is_member(workspace_id));
create policy wallet_read on public.credit_wallets for select to authenticated using(public.is_member(workspace_id));
create policy transaction_read on public.credit_transactions for select to authenticated using(public.is_member(workspace_id));
create policy accounts_read on public.social_accounts for select to authenticated using(public.is_member(workspace_id));
create policy content_read on public.content_items for select to authenticated using(public.is_member(workspace_id));
create policy media_read on public.media_assets for select to authenticated using(public.is_member(workspace_id));
create policy variants_read on public.content_variants for select to authenticated using(exists(select 1 from public.content_items c where c.id=content_id and public.is_member(c.workspace_id)));
create policy jobs_read on public.publishing_jobs for select to authenticated using(public.is_member(workspace_id));
create policy automation_read on public.automation_rules for select to authenticated using(public.is_member(workspace_id));
create policy ai_requests_read on public.ai_requests for select to authenticated using(public.is_member(workspace_id));
create policy design_read on public.design_projects for select to authenticated using(public.is_member(workspace_id));
create policy brand_read on public.brand_kits for select to authenticated using(public.is_member(workspace_id));
create policy clips_read on public.clip_projects for select to authenticated using(public.is_member(workspace_id));
create policy metrics_read on public.metric_snapshots for select to authenticated using(public.is_member(workspace_id));
create policy inbox_read on public.inbox_threads for select to authenticated using(public.is_member(workspace_id));
create policy support_read on public.support_tickets for select to authenticated using(user_id=(select auth.uid()));
create policy feature_read on public.feature_requests for select to authenticated using(public.is_member(workspace_id));
create policy notifications_read on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy payments_read on public.payments for select to authenticated using(public.is_member(workspace_id));
create policy invoices_read on public.invoices for select to authenticated using(public.is_member(workspace_id));

-- Deny direct public media bucket access; media operations must use authenticated API and signed URLs.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('socialorbit-media','socialorbit-media',false,104857600,array['image/jpeg','image/png','image/webp','video/mp4','video/quicktime','video/webm'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- Do not create permissive storage.objects policies. API issues short-lived signed upload/download URLs.
