-- Apply the whole file in Supabase SQL Editor.
-- File: supabase/migrations/013_security_advisor_hardening.sql

create schema if not exists extensions;

do $migration$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'citext'
      and n.nspname = 'public'
  ) then
    alter extension citext set schema extensions;
  end if;
end
$migration$;

do $migration$
begin
  if to_regclass('public.v_package_balances') is not null then
    alter view public.v_package_balances set (security_invoker = true);
    revoke all on public.v_package_balances from public, anon, authenticated;
    grant select on public.v_package_balances to service_role;
  end if;
end
$migration$;

do $migration$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    revoke execute on function public.rls_auto_enable()
      from public, anon, authenticated;
  end if;
end
$migration$;
