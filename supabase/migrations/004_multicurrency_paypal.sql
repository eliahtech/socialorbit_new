-- Multi-currency (KES / USD) checkout, PayPal support, and the single authoritative fulfillment function.
-- Prices below are PROPOSED defaults; a Super Admin can edit them. Verify against your business plan.

alter table public.plans add column if not exists price_usd_cents integer not null default 0 check(price_usd_cents>=0);
update public.plans set price_usd_cents=case key when 'creator' then 399 when 'pro' then 1199 when 'agency' then 2999 else 0 end
 where price_usd_cents=0 and key<>'free';

alter table public.credit_packs add column if not exists price_usd_cents integer not null default 0 check(price_usd_cents>=0);
update public.credit_packs set price_usd_cents=case kind when 'text' then 99 when 'image' then 199 else 99 end where price_usd_cents=0;

-- Payments: provider list (mpesa kept only so historical rows stay valid), currency and minor-unit amount.
alter table public.payments drop constraint if exists payments_provider_check;
alter table public.payments add constraint payments_provider_check check(provider in ('mpesa','pesapal','paypal'));
alter table public.payments add column if not exists currency text not null default 'KES' check(currency in ('KES','USD'));
alter table public.payments add column if not exists amount_minor integer;
update public.payments set amount_minor=amount_kes*100 where amount_minor is null;
alter table public.payments alter column amount_minor set not null;
alter table public.payments alter column amount_kes drop not null;
alter table public.payments drop constraint if exists payments_amount_minor_positive;
alter table public.payments add constraint payments_amount_minor_positive check(amount_minor>0);
alter table public.payments drop constraint if exists payments_paypal_usd_only;
alter table public.payments add constraint payments_paypal_usd_only check(provider<>'paypal' or currency='USD');
create unique index if not exists payments_provider_ref_unique on public.payments(provider,provider_reference) where provider_reference is not null;

alter table public.invoices add column if not exists currency text not null default 'KES';
alter table public.invoices add column if not exists total_minor integer;
update public.invoices set total_minor=total_kes*100 where total_minor is null;
alter table public.invoices alter column total_kes drop not null;

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
   when 'clips' then v_plan.clips when 'publishing' then v_plan.publishing_jobs
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
