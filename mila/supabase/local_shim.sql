-- שכבת תאימות ל-Postgres מקומי בלבד (לא מופעל ב-Supabase):
-- מדמה את סכמת auth ואת התפקידים anon/authenticated כדי להריץ את המיגרציות והבדיקות.
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
