-- SocialOrbit no longer uploads or processes video. Videos are shared as links to copies that already live on
-- Facebook/YouTube. This migration (1) adds a link column for posts and (2) removes the 'clips' credit kind.
--
-- Ordering matters: functions that mention "clips" are replaced FIRST, then data, then constraints/columns.
-- Non-destructive choices: credit_transactions history is kept untouched, and the inert clip_projects table is
-- left in place (drop it yourself later with: drop table public.clip_projects;).

-- 0. Safety: refuse to run if any workspace holds purchased (top-up) clip credits that would be destroyed.
do $$
begin
 if exists(select 1 from public.credit_wallets where kind='clips' and topup_balance>0) then
  raise exception 'Refusing to remove clips wallets: some hold purchased top-up credits. Refund or convert them first.';
 end if;
end $$;

-- 1. Link column used for Facebook link posts (an explicit link; imported videos already have source_url).
alter table public.content_items add column if not exists link_url text;
alter table public.content_items drop constraint if exists content_items_link_url_https;
alter table public.content_items add constraint content_items_link_url_https
 check(link_url is null or (length(link_url)<=2048 and link_url ~ '^https://[^/@[:space:]]+[.][^/@[:space:]]+'));

-- 2a. New workspaces no longer get a clips wallet.
create or replace function public.on_workspace_created() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.workspace_members(workspace_id,user_id,role) values(new.id,new.owner_id,'owner');
 insert into public.subscriptions(workspace_id,plan_key) values(new.id,'free');
 insert into public.credit_wallets(workspace_id,kind,monthly_balance)
 values(new.id,'text',20),(new.id,'image',2),(new.id,'publishing',20),(new.id,'old_video',20);
 return new;
end;$$;

-- 2b. Payment fulfillment no longer reads plans.clips (the column is dropped below).
create or replace function public.fulfill_verified_payment(p_payment uuid,p_provider_reference text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_payment public.payments%rowtype;v_plan public.plans%rowtype;v_pack public.credit_packs%rowtype;v_expected integer;
begin
 select * into v_payment from public.payments where id=p_payment for update;
 if not found then raise exception 'Payment not found';end if;
 if v_payment.status='verified' then return false;end if;
 if v_payment.status not in ('pending','processing') then raise exception 'Payment cannot be fulfilled';end if;
 if v_payment.provider_reference is distinct from p_provider_reference then raise exception 'Provider reference mismatch';end if;
 if v_payment.purpose='subscription' then
  select * into v_plan from public.plans where key=v_payment.plan_key;
  if not found then raise exception 'Plan not found';end if;
  v_expected:=case v_payment.currency when 'KES' then v_plan.price_kes*100 else v_plan.price_usd_cents end;
  if v_expected<=0 or v_expected<>v_payment.amount_minor then raise exception 'Plan amount mismatch';end if;
  insert into public.subscriptions(workspace_id,plan_key,status,current_period_start,current_period_end)
  values(v_payment.workspace_id,v_plan.key,'active',now(),now()+interval '1 month')
  on conflict(workspace_id) do update set plan_key=excluded.plan_key,status='active',
  current_period_start=excluded.current_period_start,current_period_end=excluded.current_period_end,updated_at=now();
  update public.credit_wallets set monthly_balance=case kind
   when 'text' then v_plan.text_credits when 'image' then v_plan.image_credits
   when 'publishing' then v_plan.publishing_jobs
   when 'old_video' then v_plan.old_videos else monthly_balance end
   where workspace_id=v_payment.workspace_id;
 elsif v_payment.purpose='topup' then
  select * into v_pack from public.credit_packs where id=v_payment.credit_pack_id;
  if not found or not v_pack.enabled then raise exception 'Credit pack unavailable';end if;
  v_expected:=case v_payment.currency when 'KES' then v_pack.price_kes*100 else v_pack.price_usd_cents end;
  if v_expected<=0 or v_expected<>v_payment.amount_minor or v_pack.units<>v_payment.credit_quantity or v_pack.kind<>v_payment.credit_kind then
   raise exception 'Credit pack mismatch';
  end if;
  update public.credit_wallets set topup_balance=topup_balance+v_pack.units
   where workspace_id=v_payment.workspace_id and kind=v_pack.kind;
 else raise exception 'Unsupported payment purpose';end if;
 update public.payments set status='verified',verified_at=now() where id=p_payment;
 insert into public.invoices(workspace_id,payment_id,invoice_number,total_kes,currency,total_minor)
 values(v_payment.workspace_id,p_payment,'SO-'||replace(p_payment::text,'-',''),
  case when v_payment.currency='KES' then v_payment.amount_minor/100 else null end,v_payment.currency,v_payment.amount_minor)
 on conflict(invoice_number) do nothing;
 return true;
end;$$;
revoke execute on function public.fulfill_verified_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.fulfill_verified_payment(uuid,text) to service_role;

-- 3. Data: release any clip reservation still held so nothing is stuck, then remove the empty clip wallets.
update public.credit_transactions set status='released',updated_at=now() where kind='clips' and status='reserved';
delete from public.credit_wallets where kind='clips';

-- 4. Constraints and columns last.
alter table public.credit_wallets drop constraint if exists credit_wallets_kind_check;
alter table public.credit_wallets add constraint credit_wallets_kind_check check(kind in ('text','image','publishing','old_video'));
alter table public.plans drop column if exists clips;
