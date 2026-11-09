-- ============================================================
-- מילה — סכמת שרת (Supabase / PostgreSQL)
-- השרת הוא מקור האמת: כל כתיבה עוברת דרך פונקציות RPC (SECURITY DEFINER)
-- שמאמתות auth.uid(), הרשאות, תקרת 3 ביום ויומן append-only.
-- גישה ישירה לטבלאות מהלקוח חסומה ב-RLS (אין מדיניות = אין גישה).
-- קריאה: rpc_my_state() מחזירה רק את מה שהמשתמשת רשאית לראות.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- טבלאות ----------
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null check (char_length(display_name) between 1 and 30),
  color         text not null default 'sky',
  timezone      text not null default 'Asia/Jerusalem',
  age_confirmed boolean not null default false,
  settings      jsonb not null default '{"reminderTime":"20:00","pushReminders":true,"socialDigest":true,"hideFromLeaderboard":false,"lockScreenPrivacy":true}',
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

create table if not exists circles (
  id              uuid primary key default gen_random_uuid(),
  name            text not null check (char_length(name) between 1 and 50),
  description     text not null default '' check (char_length(description) <= 120),
  owner_id        uuid not null references profiles(id),
  color           text not null default 'pink',
  who_can_propose text not null default 'all' check (who_can_propose in ('all','admins')),
  max_members     int  not null default 8 check (max_members between 2 and 50),
  round_start     date not null,
  status          text not null default 'active' check (status in ('active','archived')),
  created_at      timestamptz not null default now()
);

create table if not exists circle_memberships (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  role       text not null default 'member' check (role in ('admin','member')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  removed_by uuid references profiles(id)
);
create unique index if not exists uq_active_membership on circle_memberships(circle_id, user_id) where left_at is null;
create index if not exists idx_membership_user on circle_memberships(user_id) where left_at is null;

create table if not exists circle_invites (
  token_hash text primary key,
  token_hint text not null,                 -- 2 תווים ראשונים, לתצוגה בלבד
  circle_id  uuid not null references circles(id) on delete cascade,
  inviter_id uuid not null references profiles(id),
  expires_at timestamptz not null,
  max_uses   int not null default 20,
  uses       int not null default 0,
  status     text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now()
);

create table if not exists word_definitions (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('personal','group')),
  circle_id  uuid references circles(id),
  owner_id   uuid not null references profiles(id),
  title      text not null check (char_length(title) between 1 and 60),
  rule       text not null check (char_length(rule) between 1 and 200),
  icon       text not null default 'leaf',
  visibility text not null default 'private' check (visibility in ('private','status','summary')),
  version    int  not null default 1,
  start_date date not null,
  end_date   date,
  status     text not null default 'active' check (status in ('proposed','active','cancelled')),
  created_at timestamptz not null default now(),
  check (kind = 'personal' or circle_id is not null)
);

create table if not exists word_commitments (
  id            uuid primary key default gen_random_uuid(),
  definition_id uuid not null references word_definitions(id),
  user_id       uuid not null references profiles(id),
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'active' check (status in ('active','completed','ended_early','cancelled')),
  end_reason    text,
  summary_seen  boolean not null default false,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  check (end_date >= start_date)
);
create unique index if not exists uq_commitment_per_def on word_commitments(definition_id, user_id) where status <> 'cancelled';
create index if not exists idx_commitments_user on word_commitments(user_id);

create table if not exists daily_obligations (
  id             uuid primary key default gen_random_uuid(),
  commitment_id  uuid not null references word_commitments(id) on delete cascade,
  user_id        uuid not null references profiles(id),
  local_date     date not null,
  status         text not null default 'scheduled' check (status in ('scheduled','open','confirmed_success','confirmed_miss','excused','cancelled')),
  outcome        text check (outcome in ('success','miss','excused')),
  resolve_reason text,
  resolved_at    timestamptz,
  corrected_at   timestamptz,
  note           text,
  unique (commitment_id, local_date)
);
create index if not exists idx_obligations_user_date on daily_obligations(user_id, local_date);

create table if not exists resolution_history (
  id            uuid primary key default gen_random_uuid(),
  obligation_id uuid not null references daily_obligations(id) on delete cascade,
  from_state    text,
  to_state      text not null,
  reason        text not null,
  actor_id      uuid,
  created_at    timestamptz not null default now()
);

create table if not exists virtual_ledger (
  id               uuid primary key default gen_random_uuid(),
  obligation_id    uuid not null references daily_obligations(id),
  user_id          uuid not null references profiles(id),
  definition_id    uuid not null references word_definitions(id),
  circle_id        uuid references circles(id),
  transaction_type text not null check (transaction_type in ('EARN','MISS_TO_CIRCLE','MISS_PERSONAL','REVERSE')),
  amount           int  not null check (amount in (1,-1)),
  reversal_of      uuid references virtual_ledger(id),
  local_date       date not null,
  created_at       timestamptz not null default now()
);
create unique index if not exists uq_ledger_reversal on virtual_ledger(reversal_of) where reversal_of is not null;
create index if not exists idx_ledger_user on virtual_ledger(user_id);
create index if not exists idx_ledger_circle on virtual_ledger(circle_id) where circle_id is not null;

create table if not exists achievements (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,
  source_ref text,
  earned_at  timestamptz not null default now(),
  unique (user_id, type)
);

create table if not exists social_events (
  id         uuid primary key default gen_random_uuid(),
  circle_id  uuid not null references circles(id) on delete cascade,
  actor_id   uuid not null references profiles(id),
  type       text not null,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_events_circle on social_events(circle_id, created_at desc);

create table if not exists encouragements (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references social_events(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  reaction   text not null check (reaction in ('clap','heart','muscle','fire','star')),
  created_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table if not exists user_blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

create table if not exists abuse_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id),
  entity_type text not null,
  entity_id   text not null,
  reason      text not null,
  details     text,
  status      text not null default 'open',
  created_at  timestamptz not null default now()
);

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text not null default '',
  ref        jsonb not null default '{}',
  read       boolean not null default false,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);

-- ---------- RLS: הכול נעול. הגישה היחידה מהלקוח היא דרך RPC ----------
do $$ declare t text; begin
  for t in select unnest(array['profiles','circles','circle_memberships','circle_invites','word_definitions','word_commitments','daily_obligations','resolution_history','virtual_ledger','achievements','social_events','encouragements','user_blocks','abuse_reports','notifications']) loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from anon, authenticated', t);
  end loop;
end $$;

-- יומן תנועות: append-only גם עבור בעל הסכמה
create or replace function ledger_append_only() returns trigger language plpgsql as $$
begin raise exception 'virtual_ledger is append-only'; end $$;
drop trigger if exists trg_ledger_ro on virtual_ledger;
create trigger trg_ledger_ro before update or delete on virtual_ledger for each row execute function ledger_append_only();

-- תקרה יומית: הגנה אחרונה ברמת הטבלה (ה-RPC בודק קודם, תחת נעילה)
create or replace function enforce_daily_cap() returns trigger language plpgsql as $$
declare n int;
begin
  if new.status = 'cancelled' then return new; end if;
  select count(*) into n from daily_obligations
   where user_id = new.user_id and local_date = new.local_date and status <> 'cancelled' and id <> new.id;
  if n >= 3 then raise exception 'DAILY_CAP_EXCEEDED' using errcode = 'P0001', hint = 'יש לך כבר שלוש מילים על הכף ביום הזה'; end if;
  return new;
end $$;
drop trigger if exists trg_daily_cap on daily_obligations;
create trigger trg_daily_cap before insert or update on daily_obligations for each row execute function enforce_daily_cap();

-- ---------- עזרים ----------
create or replace function fn_uid() returns uuid language sql stable as $$
  select coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
$$;

create or replace function fn_require_user() returns uuid language plpgsql stable as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'AUTH_REQUIRED' using hint = 'צריך להתחבר'; end if;
  if not exists (select 1 from profiles where id = u and status = 'active') then raise exception 'PROFILE_REQUIRED' using hint = 'צריך להשלים הרשמה'; end if;
  return u;
end $$;

create or replace function fn_tz(u uuid) returns text language sql stable as $$
  select coalesce((select timezone from profiles where id = u), 'Asia/Jerusalem')
$$;

create or replace function fn_local_today(u uuid) returns date language sql stable as $$
  select (now() at time zone fn_tz(u))::date
$$;

-- חלון דיווח: מתחילת היום המקומי עד 10:00 למחרת
create or replace function fn_window_opens(d date, tz text) returns timestamptz language sql immutable as $$
  select (d::timestamp) at time zone tz
$$;
create or replace function fn_window_closes(d date, tz text) returns timestamptz language sql immutable as $$
  select ((d + 1)::timestamp + time '10:00') at time zone tz
$$;

create or replace function fn_is_member(c uuid, u uuid) returns boolean language sql stable as $$
  select exists (select 1 from circle_memberships where circle_id = c and user_id = u and left_at is null)
$$;
create or replace function fn_is_admin(c uuid, u uuid) returns boolean language sql stable as $$
  select exists (select 1 from circle_memberships where circle_id = c and user_id = u and left_at is null and role = 'admin')
$$;
create or replace function fn_is_blocked(blocker uuid, blocked uuid) returns boolean language sql stable as $$
  select exists (select 1 from user_blocks where blocker_id = blocker and blocked_id = blocked)
$$;

create or replace function fn_notify(u uuid, typ text, title text, body text, ref jsonb) returns void language plpgsql as $$
begin
  insert into notifications(user_id, type, title, body, ref, dedupe_key)
  values (u, typ, title, coalesce(body,''), coalesce(ref,'{}'), typ || '|' || title || '|' || fn_local_today(u)::text)
  on conflict (user_id, dedupe_key) do nothing;
end $$;

create or replace function fn_event(c uuid, actor uuid, typ text, payload jsonb) returns uuid language plpgsql as $$
declare eid uuid;
begin
  insert into social_events(circle_id, actor_id, type, payload) values (c, actor, typ, coalesce(payload,'{}')) returning id into eid;
  return eid;
end $$;

create or replace function fn_grant(u uuid, typ text, src text) returns void language plpgsql as $$
declare titles jsonb := '{"first_word":["נתתי מילה","יצרת את ההתחייבות הראשונה שלך"],"first_day":["יום ראשון","הצלחה ראשונה שנשמרה"],"streak_7":["7 ברצף","שבעה ימי הצלחה רצופים באותה מילה"],"streak_14":["14 ברצף","סבב מושלם באותה מילה"],"first_circle":["מעגל ראשון","הצטרפת למעגל"],"round_complete":["סבב שלם","סיימת 14 ימי משחק, גם אם היו פספוסים"],"second_round":["עוד סיבוב?","חזרת לסבב שני"]}';
        inserted int;
begin
  insert into achievements(user_id, type, source_ref) values (u, typ, src) on conflict do nothing;
  get diagnostics inserted = row_count;
  if inserted > 0 then
    perform fn_notify(u, 'achievement', 'הישג חדש: ' || (titles->typ->>0), titles->typ->>1, jsonb_build_object('type', typ));
  end if;
end $$;

-- רצף נוכחי של התחייבות (החרגה לא שוברת ולא מוסיפה)
create or replace function fn_current_streak(k uuid) returns int language plpgsql stable as $$
declare r record; s int := 0;
begin
  for r in select outcome from daily_obligations where commitment_id = k and status <> 'cancelled' and outcome is not null order by local_date desc loop
    if r.outcome = 'success' then s := s + 1;
    elsif r.outcome = 'miss' then exit;
    end if;
  end loop;
  return s;
end $$;

-- בדיקת תקרה לטווח תאריכים (ללא נעילה; הנעילה ב-RPC)
create or replace function fn_cap_ok(u uuid, s date, e date) returns boolean language sql stable as $$
  select not exists (
    select 1 from daily_obligations
    where user_id = u and status <> 'cancelled' and local_date between s and e
    group by local_date having count(*) >= 3)
$$;

create or replace function fn_validate_word(title text, rule text) returns void language plpgsql immutable as $$
begin
  if title is null or btrim(title) = '' then raise exception 'VALIDATION' using hint = 'צריך כותרת למילה'; end if;
  if char_length(btrim(title)) > 60 then raise exception 'VALIDATION' using hint = 'הכותרת ארוכה מדי (עד 60 תווים)'; end if;
  if rule is null or btrim(rule) = '' then raise exception 'VALIDATION' using hint = 'מה נחשב הצלחה? בלי כלל הצלחה אי אפשר לתת מילה'; end if;
  if char_length(btrim(rule)) > 200 then raise exception 'VALIDATION' using hint = 'הכלל ארוך מדי (עד 200 תווים)'; end if;
  if (title || ' ' || rule) ~ '(הרעב|לא לאכול כלום|צום של|להקיא|לפגוע|חיתוך|סמים|לשתות עד|להשמין)' then
    raise exception 'VALIDATION' using hint = 'הניסוח הזה עלול להיות מסוכן. נסי מילה שמוסיפה משהו טוב ליום.';
  end if;
end $$;

-- ---------- הכרעה ותנועות ----------
create or replace function fn_resolve(o daily_obligations, outcome text, reason text, actor uuid, at_ts timestamptz) returns void language plpgsql as $$
declare k word_commitments; d word_definitions; new_status text; s int;
begin
  select * into k from word_commitments where id = o.commitment_id;
  select * into d from word_definitions where id = k.definition_id;
  new_status := case outcome when 'success' then 'confirmed_success' when 'miss' then 'confirmed_miss' else 'excused' end;
  update daily_obligations set outcome = fn_resolve.outcome, status = new_status, resolved_at = at_ts, resolve_reason = reason where id = o.id;
  insert into resolution_history(obligation_id, from_state, to_state, reason, actor_id, created_at) values (o.id, o.status, new_status, reason, actor, at_ts);
  if outcome <> 'excused' then
    insert into virtual_ledger(obligation_id, user_id, definition_id, circle_id, transaction_type, amount, local_date, created_at)
    values (o.id, o.user_id, d.id, d.circle_id, case when outcome = 'success' then 'EARN' when d.circle_id is not null then 'MISS_TO_CIRCLE' else 'MISS_PERSONAL' end, 1, o.local_date, at_ts);
  end if;
  if outcome = 'success' then
    perform fn_grant(o.user_id, 'first_day', o.id::text);
    s := fn_current_streak(k.id);
    if s >= 7 then perform fn_grant(o.user_id, 'streak_7', k.id::text); end if;
    if s >= 14 then perform fn_grant(o.user_id, 'streak_14', k.id::text); end if;
    if d.circle_id is not null and d.visibility = 'status' and s in (3,7,14) then
      perform fn_event(d.circle_id, o.user_id, 'streak', jsonb_build_object('title', d.title, 'streak', s, 'defId', d.id));
    end if;
  end if;
  if d.circle_id is not null and d.visibility = 'status' and reason = 'self_report' then
    perform fn_event(d.circle_id, o.user_id, case outcome when 'success' then 'day_success' when 'miss' then 'day_miss' else 'day_excused' end,
      jsonb_build_object('title', d.title, 'defId', d.id, 'date', o.local_date));
  end if;
end $$;

-- רענון סטטוסים למשתמשת: פתיחת ימים, זקיפה אוטומטית אחרי חלון, סיום התחייבויות
create or replace function fn_settle(u uuid) returns void language plpgsql as $$
declare tz text := fn_tz(u); o daily_obligations; k record; completed_cnt int;
begin
  for o in select ob.* from daily_obligations ob join word_commitments k2 on k2.id = ob.commitment_id
           where ob.user_id = u and ob.outcome is null and ob.status in ('scheduled','open') and k2.status = 'active'
           order by ob.local_date loop
    if now() >= fn_window_closes(o.local_date, tz) then
      perform fn_resolve(o, 'miss', 'auto_unreported', null, fn_window_closes(o.local_date, tz));
    elsif now() >= fn_window_opens(o.local_date, tz) and o.status = 'scheduled' then
      update daily_obligations set status = 'open' where id = o.id;
    end if;
  end loop;
  for k in select * from word_commitments where user_id = u and status = 'active' and end_date < fn_local_today(u)
           and not exists (select 1 from daily_obligations where commitment_id = word_commitments.id and outcome is null and status <> 'cancelled') loop
    update word_commitments set status = 'completed', completed_at = now() where id = k.id;
    perform fn_grant(u, 'round_complete', k.id::text);
    select count(*) into completed_cnt from word_commitments where user_id = u and status = 'completed';
    if completed_cnt >= 2 then perform fn_grant(u, 'second_round', k.id::text); end if;
  end loop;
end $$;

-- ---------- RPC: פרופיל ----------
create or replace function rpc_upsert_profile(p_name text, p_age_confirmed boolean, p_color text default null, p_timezone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); colors text[] := array['lime','pink','lavender','mint','peach','sky'];
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  if not coalesce(p_age_confirmed,false) then raise exception 'VALIDATION' using hint = 'בגרסת הבטא המשחק פתוח לבנות 18 ומעלה'; end if;
  insert into profiles(id, display_name, age_confirmed, color, timezone)
  values (u, btrim(p_name), true, coalesce(p_color, colors[1 + (abs(hashtext(p_name)) % 6)]), coalesce(p_timezone, 'Asia/Jerusalem'))
  on conflict (id) do update set display_name = excluded.display_name, age_confirmed = true, timezone = coalesce(p_timezone, profiles.timezone), status = 'active';
  return jsonb_build_object('id', u);
end $$;

create or replace function rpc_update_settings(p_patch jsonb) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin
  update profiles set settings = settings || p_patch where id = u;
end $$;

create or replace function rpc_rename(p_name text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin
  update profiles set display_name = btrim(p_name) where id = u;
end $$;

-- ---------- RPC: מעגלים והזמנות ----------
create or replace function fn_new_invite(c uuid, u uuid) returns text language plpgsql as $$
declare tok text;
begin
  tok := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6));
  insert into circle_invites(token_hash, token_hint, circle_id, inviter_id, expires_at, max_uses)
  values (encode(digest(tok, 'sha256'), 'hex'), substr(tok, 1, 2), c, u, now() + interval '7 days', 20);
  return tok;
end $$;

create or replace function rpc_create_circle(p_name text, p_description text default '', p_color text default 'pink', p_who_can_propose text default 'all', p_max_members int default 8, p_round_start date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); cid uuid; tok text;
begin
  insert into circles(name, description, owner_id, color, who_can_propose, max_members, round_start)
  values (btrim(p_name), coalesce(btrim(p_description),''), u, coalesce(p_color,'pink'), coalesce(p_who_can_propose,'all'), coalesce(p_max_members,8), coalesce(p_round_start, fn_local_today(u)))
  returning id into cid;
  insert into circle_memberships(circle_id, user_id, role) values (cid, u, 'admin');
  tok := fn_new_invite(cid, u);
  perform fn_event(cid, u, 'circle_created', '{}');
  perform fn_grant(u, 'first_circle', cid::text);
  return jsonb_build_object('circleId', cid, 'inviteToken', tok);
end $$;

create or replace function rpc_update_circle(p_circle uuid, p_patch jsonb) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin
  if not fn_is_admin(p_circle, u) then raise exception 'FORBIDDEN' using hint = 'רק מנהלת המעגל יכולה לשנות את פרטיו'; end if;
  update circles set
    name = coalesce(p_patch->>'name', name),
    description = coalesce(p_patch->>'description', description),
    color = coalesce(p_patch->>'color', color),
    who_can_propose = coalesce(p_patch->>'whoCanPropose', who_can_propose),
    max_members = coalesce((p_patch->>'maxMembers')::int, max_members)
  where id = p_circle;
end $$;

create or replace function rpc_create_invite(p_circle uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); tok text;
begin
  if not fn_is_member(p_circle, u) then raise exception 'FORBIDDEN'; end if;
  tok := fn_new_invite(p_circle, u);
  return jsonb_build_object('token', tok);
end $$;

create or replace function rpc_revoke_invite(p_token text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); inv circle_invites;
begin
  select * into inv from circle_invites where token_hash = encode(digest(upper(p_token),'sha256'),'hex');
  if inv.circle_id is null then return; end if;
  if not fn_is_admin(inv.circle_id, u) and inv.inviter_id <> u then raise exception 'FORBIDDEN'; end if;
  update circle_invites set status = 'revoked' where token_hash = inv.token_hash;
end $$;

create or replace function rpc_revoke_circle_invites(p_circle uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); tok text;
begin
  if not fn_is_admin(p_circle, u) then raise exception 'FORBIDDEN' using hint = 'רק מנהלת יכולה לבטל קישורים'; end if;
  update circle_invites set status = 'revoked' where circle_id = p_circle and status = 'active';
  tok := fn_new_invite(p_circle, u);
  return jsonb_build_object('token', tok);
end $$;

create or replace function rpc_preview_invite(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); inv circle_invites; c circles; inviter profiles; members int; sample word_definitions; rs record;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into inv from circle_invites where token_hash = encode(digest(upper(btrim(p_token)),'sha256'),'hex');
  if inv.circle_id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  if inv.status <> 'active' then return jsonb_build_object('ok', false, 'reason', 'revoked'); end if;
  if inv.expires_at < now() then return jsonb_build_object('ok', false, 'reason', 'expired'); end if;
  if inv.uses >= inv.max_uses then return jsonb_build_object('ok', false, 'reason', 'full'); end if;
  select * into c from circles where id = inv.circle_id and status = 'active';
  if c.id is null then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  -- משתמשת חסומה (בשני הכיוונים) לא נחשפת לפרטי המעגל
  if fn_is_blocked(inv.inviter_id, u) or fn_is_blocked(u, inv.inviter_id) then return jsonb_build_object('ok', false, 'reason', 'not_found'); end if;
  select * into inviter from profiles where id = inv.inviter_id;
  select count(*) into members from circle_memberships where circle_id = c.id and left_at is null;
  select * into sample from word_definitions where circle_id = c.id and kind = 'group' and status <> 'cancelled' order by created_at desc limit 1;
  select * into rs from fn_circle_round(c.id, fn_local_today(u));
  return jsonb_build_object('ok', true,
    'inv', jsonb_build_object('token', upper(btrim(p_token)), 'expiresAt', inv.expires_at, 'uses', inv.uses, 'maxUses', inv.max_uses),
    'circle', jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'color', c.color),
    'inviter', jsonb_build_object('id', inviter.id, 'name', inviter.display_name, 'color', inviter.color),
    'memberCount', members, 'maxMembers', c.max_members, 'alreadyMember', fn_is_member(c.id, u),
    'sampleWord', case when sample.id is null then null else jsonb_build_object('title', sample.title) end,
    'round', jsonb_build_object('index', rs.idx, 'start', rs.start_d, 'end', rs.end_d, 'dayIndex', rs.day_index, 'nextStart', rs.next_start));
end $$;

create or replace function rpc_accept_invite(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); p jsonb; inv circle_invites; cid uuid; members int; maxm int;
begin
  p := rpc_preview_invite(p_token);
  if not (p->>'ok')::boolean then raise exception 'INVITE_INVALID' using hint = p->>'reason'; end if;
  cid := (p->'circle'->>'id')::uuid;
  if (p->>'alreadyMember')::boolean then return jsonb_build_object('circleId', cid); end if;
  select * into inv from circle_invites where token_hash = encode(digest(upper(btrim(p_token)),'sha256'),'hex') for update;
  select count(*) into members from circle_memberships where circle_id = cid and left_at is null;
  select max_members into maxm from circles where id = cid;
  if members >= maxm then raise exception 'CIRCLE_FULL' using hint = 'המעגל מלא. אפשר לבקש ממנהלת המעגל להגדיל את מספר המקומות.'; end if;
  insert into circle_memberships(circle_id, user_id, role) values (cid, u, 'member');
  update circle_invites set uses = uses + 1 where token_hash = inv.token_hash;
  perform fn_event(cid, u, 'member_joined', '{}');
  perform fn_grant(u, 'first_circle', cid::text);
  return jsonb_build_object('circleId', cid);
end $$;

create or replace function rpc_leave_circle(p_circle uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); m circle_memberships; other uuid; k record;
begin
  select * into m from circle_memberships where circle_id = p_circle and user_id = u and left_at is null;
  if m.id is null then return; end if;
  if m.role = 'admin' then
    select user_id into other from circle_memberships where circle_id = p_circle and user_id <> u and left_at is null order by joined_at limit 1;
    if other is not null then
      update circle_memberships set role = 'admin' where circle_id = p_circle and user_id = other and left_at is null;
      perform fn_event(p_circle, other, 'admin_transferred', '{}');
    else
      update circles set status = 'archived' where id = p_circle;
    end if;
  end if;
  update circle_memberships set left_at = now() where id = m.id;
  for k in select k2.id from word_commitments k2 join word_definitions d on d.id = k2.definition_id where k2.user_id = u and k2.status = 'active' and d.circle_id = p_circle loop
    perform fn_end_commitment(k.id, u, 'left_circle');
  end loop;
  perform fn_event(p_circle, u, 'member_left', '{}');
end $$;

create or replace function rpc_remove_member(p_circle uuid, p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin
  if not fn_is_admin(p_circle, u) then raise exception 'FORBIDDEN' using hint = 'רק מנהלת המעגל יכולה להסיר חברות'; end if;
  if p_user = u then raise exception 'VALIDATION' using hint = 'כדי לצאת בעצמך השתמשי ב״לעזוב את המעגל״'; end if;
  update circle_memberships set left_at = now(), removed_by = u where circle_id = p_circle and user_id = p_user and left_at is null;
  perform fn_event(p_circle, u, 'member_removed', jsonb_build_object('userId', p_user));
end $$;

-- סבב של מעגל: חלונות של 14 יום מעוגנים ל-round_start
create or replace function fn_circle_round(c uuid, d date) returns table(idx int, start_d date, end_d date, day_index int, next_start date) language plpgsql stable as $$
declare rs date; i int;
begin
  select round_start into rs from circles where id = c;
  i := floor((d - rs)::numeric / 14);
  start_d := rs + (i * 14); end_d := start_d + 13; idx := i + 1;
  day_index := least(greatest((d - start_d) + 1, 0), 14);
  next_start := start_d + 14;
  return next;
end $$;

-- ---------- RPC: מילים ----------
create or replace function fn_create_commitment(def uuid, u uuid, s date, e date) returns uuid language plpgsql as $$
declare kid uuid; d date;
begin
  -- נעילה לכל משתמשת: שתי בקשות במקביל לא יעקפו את התקרה
  perform pg_advisory_xact_lock(hashtext('cap:' || u::text));
  if not fn_cap_ok(u, s, e) then raise exception 'CAP' using hint = 'יש לך כבר שלוש מילים על הכף בימים האלה'; end if;
  insert into word_commitments(definition_id, user_id, start_date, end_date) values (def, u, s, e) returning id into kid;
  d := s;
  while d <= e loop
    insert into daily_obligations(commitment_id, user_id, local_date, status) values (kid, u, d, case when d <= fn_local_today(u) then 'open' else 'scheduled' end);
    d := d + 1;
  end loop;
  return kid;
end $$;

create or replace function rpc_create_personal_word(p_title text, p_rule text, p_icon text, p_start date, p_circle uuid default null, p_visibility text default 'private')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); did uuid; kid uuid; vis text;
begin
  perform fn_validate_word(p_title, p_rule);
  if p_start < fn_local_today(u) then raise exception 'VALIDATION' using hint = 'אי אפשר לתת מילה על ימים שעברו'; end if;
  if p_circle is not null and not fn_is_member(p_circle, u) then raise exception 'FORBIDDEN' using hint = 'את לא חברה במעגל הזה'; end if;
  vis := case when p_circle is null then 'private' else coalesce(p_visibility, 'status') end;
  insert into word_definitions(kind, circle_id, owner_id, title, rule, icon, visibility, start_date, end_date, status)
  values ('personal', p_circle, u, btrim(p_title), btrim(p_rule), coalesce(p_icon,'leaf'), vis, p_start, p_start + 13, 'active') returning id into did;
  kid := fn_create_commitment(did, u, p_start, p_start + 13);
  if p_circle is not null and vis <> 'private' then perform fn_event(p_circle, u, 'word_committed', jsonb_build_object('defId', did, 'title', btrim(p_title))); end if;
  perform fn_grant(u, 'first_word', did::text);
  return jsonb_build_object('defId', did, 'commitmentId', kid);
end $$;

create or replace function rpc_propose_group_word(p_circle uuid, p_title text, p_rule text, p_icon text, p_start date, p_visibility text default 'status')
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); c circles; did uuid; me_name text; m record;
begin
  select * into c from circles where id = p_circle and status = 'active';
  if c.id is null then raise exception 'NOT_FOUND' using hint = 'מעגל לא נמצא'; end if;
  if not fn_is_member(p_circle, u) then raise exception 'FORBIDDEN' using hint = 'את לא חברה במעגל הזה'; end if;
  if c.who_can_propose = 'admins' and not fn_is_admin(p_circle, u) then raise exception 'FORBIDDEN' using hint = 'במעגל הזה רק מנהלות מציעות מילים'; end if;
  perform fn_validate_word(p_title, p_rule);
  if p_start < fn_local_today(u) then raise exception 'VALIDATION' using hint = 'אי אפשר להציע מילה על ימים שעברו'; end if;
  insert into word_definitions(kind, circle_id, owner_id, title, rule, icon, visibility, start_date, end_date, status)
  values ('group', p_circle, u, btrim(p_title), btrim(p_rule), coalesce(p_icon,'leaf'), coalesce(p_visibility,'status'), p_start, p_start + 13, 'proposed') returning id into did;
  perform fn_event(p_circle, u, 'group_word_proposed', jsonb_build_object('defId', did, 'title', btrim(p_title)));
  select display_name into me_name from profiles where id = u;
  for m in select user_id from circle_memberships where circle_id = p_circle and left_at is null and user_id <> u loop
    perform fn_notify(m.user_id, 'group_word', 'מילה חדשה במעגל ' || c.name, me_name || ' מציעה: ' || btrim(p_title), jsonb_build_object('defId', did, 'circleId', p_circle));
  end loop;
  return jsonb_build_object('defId', did);
end $$;

create or replace function rpc_adopt_group_word(p_def uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); d word_definitions; existing uuid; s date; kid uuid;
begin
  select * into d from word_definitions where id = p_def and kind = 'group';
  if d.id is null then raise exception 'NOT_FOUND' using hint = 'מילה לא נמצאה'; end if;
  if not fn_is_member(d.circle_id, u) then raise exception 'FORBIDDEN' using hint = 'את לא חברה במעגל הזה'; end if;
  if d.status = 'cancelled' then raise exception 'VALIDATION' using hint = 'ההצעה בוטלה'; end if;
  select id into existing from word_commitments where definition_id = p_def and user_id = u and status <> 'cancelled';
  if existing is not null then return jsonb_build_object('commitmentId', existing, 'duplicate', true); end if;
  s := greatest(d.start_date, fn_local_today(u));
  if s > d.end_date then raise exception 'VALIDATION' using hint = 'המילה הזו כבר הסתיימה. אפשר להציע אותה מחדש לסבב הבא.'; end if;
  kid := fn_create_commitment(p_def, u, s, d.end_date);
  if d.status = 'proposed' then update word_definitions set status = 'active' where id = p_def; end if;
  perform fn_event(d.circle_id, u, 'group_word_adopted', jsonb_build_object('defId', d.id, 'title', d.title));
  perform fn_grant(u, 'first_word', d.id::text);
  return jsonb_build_object('commitmentId', kid, 'duplicate', false);
end $$;

create or replace function rpc_cancel_proposal(p_def uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); d word_definitions;
begin
  select * into d from word_definitions where id = p_def;
  if d.id is null then raise exception 'NOT_FOUND'; end if;
  if d.owner_id <> u and not fn_is_admin(d.circle_id, u) then raise exception 'FORBIDDEN'; end if;
  if exists (select 1 from word_commitments where definition_id = p_def and status <> 'cancelled') then raise exception 'VALIDATION' using hint = 'כבר הצטרפו למילה. אפשר לסיים אותה רק דרך סיום מסודר.'; end if;
  update word_definitions set status = 'cancelled' where id = p_def;
end $$;

create or replace function fn_end_commitment(k uuid, u uuid, reason text) returns void language plpgsql as $$
begin
  update word_commitments set status = 'ended_early', end_reason = reason where id = k and user_id = u and status = 'active';
  update daily_obligations set status = 'cancelled' where commitment_id = k and status in ('scheduled','open') and outcome is null;
end $$;

create or replace function rpc_end_commitment(p_k uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin
  if not exists (select 1 from word_commitments where id = p_k and user_id = u) then raise exception 'FORBIDDEN'; end if;
  perform fn_end_commitment(p_k, u, 'ended_by_user');
end $$;

create or replace function rpc_set_visibility(p_def uuid, p_vis text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); cur text;
begin
  select visibility into cur from word_definitions where id = p_def and owner_id = u;
  if cur is null then raise exception 'FORBIDDEN'; end if;
  -- אפשר רק לצמצם חשיפה: status -> summary -> private
  if (cur = 'status' and p_vis in ('summary','private')) or (cur = 'summary' and p_vis = 'private') then
    update word_definitions set visibility = p_vis where id = p_def;
  else raise exception 'VALIDATION' using hint = 'אי אפשר להרחיב חשיפה בדיעבד'; end if;
end $$;

-- ---------- RPC: דיווח ותיקון ----------
create or replace function rpc_report(p_obligation uuid, p_outcome text, p_note text default '') returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); o daily_obligations; tz text := fn_tz(u); used int;
begin
  if p_outcome not in ('success','miss','excused') then raise exception 'VALIDATION'; end if;
  select * into o from daily_obligations where id = p_obligation for update;
  if o.id is null then raise exception 'NOT_FOUND' using hint = 'אירוע לא נמצא'; end if;
  if o.user_id <> u then raise exception 'FORBIDDEN' using hint = 'רק בעלת המילה יכולה לדווח'; end if;
  if o.status = 'cancelled' then raise exception 'VALIDATION' using hint = 'האירוע בוטל'; end if;
  if o.outcome is not null then return jsonb_build_object('duplicate', true, 'outcome', o.outcome); end if;  -- idempotent
  if now() < fn_window_opens(o.local_date, tz) then raise exception 'VALIDATION' using hint = 'עוד אי אפשר לדווח על יום שלא התחיל'; end if;
  if now() >= fn_window_closes(o.local_date, tz) then raise exception 'VALIDATION' using hint = 'חלון הדיווח ליום הזה נסגר. אפשר לבקש תיקון.'; end if;
  if p_outcome = 'excused' then
    select count(*) into used from daily_obligations where commitment_id = o.commitment_id and outcome = 'excused';
    if used >= 2 then raise exception 'VALIDATION' using hint = 'כבר השתמשת ב-2 החרגות בסבב הזה'; end if;
  end if;
  if coalesce(p_note,'') <> '' then update daily_obligations set note = left(p_note, 60) where id = o.id; end if;
  perform fn_resolve(o, p_outcome, 'self_report', u, now());
  return jsonb_build_object('duplicate', false, 'outcome', p_outcome);
end $$;

create or replace function rpc_correct(p_obligation uuid, p_outcome text, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); o daily_obligations; k word_commitments; d word_definitions; orig virtual_ledger; used int; new_status text;
begin
  if p_outcome not in ('success','miss','excused') then raise exception 'VALIDATION'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'VALIDATION' using hint = 'צריך סיבה קצרה לתיקון'; end if;
  select * into o from daily_obligations where id = p_obligation for update;
  if o.id is null or o.user_id <> u then raise exception 'FORBIDDEN'; end if;
  if o.outcome is null then raise exception 'VALIDATION' using hint = 'אין עדיין הכרעה לתקן'; end if;
  if now() - o.resolved_at >= interval '24 hours' then raise exception 'VALIDATION' using hint = 'חלון התיקון (24 שעות) נסגר'; end if;
  if o.outcome = p_outcome then return; end if;
  select * into k from word_commitments where id = o.commitment_id;
  select * into d from word_definitions where id = k.definition_id;
  if p_outcome = 'excused' then
    select count(*) into used from daily_obligations where commitment_id = k.id and outcome = 'excused';
    if used >= 2 then raise exception 'VALIDATION' using hint = 'כבר השתמשת ב-2 החרגות בסבב הזה'; end if;
  end if;
  -- היפוך התנועה הפעילה (אם יש)
  select l.* into orig from virtual_ledger l where l.obligation_id = o.id and l.transaction_type <> 'REVERSE'
    and not exists (select 1 from virtual_ledger r where r.reversal_of = l.id) limit 1;
  if orig.id is not null then
    insert into virtual_ledger(obligation_id, user_id, definition_id, circle_id, transaction_type, amount, reversal_of, local_date)
    values (o.id, u, d.id, orig.circle_id, 'REVERSE', -1, orig.id, o.local_date);
  end if;
  new_status := case p_outcome when 'success' then 'confirmed_success' when 'miss' then 'confirmed_miss' else 'excused' end;
  insert into resolution_history(obligation_id, from_state, to_state, reason, actor_id) values (o.id, o.status, 'corrected:' || new_status, btrim(p_reason), u);
  update daily_obligations set outcome = p_outcome, status = new_status, corrected_at = now(), resolved_at = now(), resolve_reason = 'correction' where id = o.id;
  if p_outcome <> 'excused' then
    insert into virtual_ledger(obligation_id, user_id, definition_id, circle_id, transaction_type, amount, local_date)
    values (o.id, u, d.id, d.circle_id, case when p_outcome = 'success' then 'EARN' when d.circle_id is not null then 'MISS_TO_CIRCLE' else 'MISS_PERSONAL' end, 1, o.local_date);
  end if;
end $$;

-- ---------- RPC: חברתי ובטיחות ----------
create or replace function rpc_encourage(p_event uuid, p_reaction text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); cid uuid; cur text;
begin
  select circle_id into cid from social_events where id = p_event;
  if cid is null or not fn_is_member(cid, u) then raise exception 'FORBIDDEN'; end if;
  select reaction into cur from encouragements where event_id = p_event and user_id = u;
  if cur = p_reaction then delete from encouragements where event_id = p_event and user_id = u;
  else insert into encouragements(event_id, user_id, reaction) values (p_event, u, p_reaction) on conflict (event_id, user_id) do update set reaction = excluded.reaction; end if;
end $$;

create or replace function rpc_send_encouragement(p_circle uuid, p_to uuid, p_reaction text) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); me_name text;
begin
  if not fn_is_member(p_circle, u) or not fn_is_member(p_circle, p_to) then raise exception 'FORBIDDEN'; end if;
  if fn_is_blocked(p_to, u) then return; end if;
  if p_reaction not in ('clap','heart','muscle','fire','star') then raise exception 'VALIDATION'; end if;
  perform fn_event(p_circle, u, 'encouragement', jsonb_build_object('toUserId', p_to, 'reaction', p_reaction));
  select display_name into me_name from profiles where id = u;
  perform fn_notify(p_to, 'encouragement', me_name || ' שלחה לך עידוד', '', jsonb_build_object('circleId', p_circle));
end $$;

create or replace function rpc_block(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin
  if p_user = u then return; end if;
  insert into user_blocks(blocker_id, blocked_id) values (u, p_user) on conflict do nothing;
end $$;
create or replace function rpc_unblock(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin delete from user_blocks where blocker_id = u and blocked_id = p_user; end $$;

create or replace function rpc_report_abuse(p_type text, p_id text, p_reason text, p_details text default '') returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin
  insert into abuse_reports(reporter_id, entity_type, entity_id, reason, details) values (u, p_type, p_id, p_reason, left(coalesce(p_details,''), 500));
end $$;

create or replace function rpc_mark_notifications_read() returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin update notifications set read = true where user_id = u and read = false; end $$;

create or replace function rpc_mark_summary_seen(p_k uuid) returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user();
begin update word_commitments set summary_seen = true where id = p_k and user_id = u; end $$;

create or replace function rpc_delete_account() returns void language plpgsql security definer set search_path = public as $$
declare u uuid := fn_require_user(); c record;
begin
  for c in select circle_id from circle_memberships where user_id = u and left_at is null loop
    perform rpc_leave_circle(c.circle_id);
  end loop;
  -- הפרופיל הופך לאנונימי; תנועות היסטוריות נשארות לצורך תקינות קופות המעגלים
  update profiles set display_name = 'משתתפת שעזבה', color = 'sky', status = 'deleted', settings = '{}' where id = u;
  delete from notifications where user_id = u;
  delete from user_blocks where blocker_id = u;
  begin
    delete from auth.users where id = u;
  exception when others then null;
  end;
end $$;

-- ---------- RPC: קריאת המצב של המשתמשת ----------
create or replace function rpc_my_state() returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid := auth.uid(); p profiles; my_circles uuid[]; out jsonb;
begin
  if u is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into p from profiles where id = u;
  if p.id is null then return jsonb_build_object('me', null); end if;
  perform fn_settle(u);
  select coalesce(array_agg(circle_id), '{}') into my_circles from circle_memberships where user_id = u and left_at is null;

  with
  mates as (select distinct m.user_id from circle_memberships m where m.circle_id = any(my_circles) and m.left_at is null),
  cmates as (select user_id from mates union select u union select actor_id from social_events where circle_id = any(my_circles)),
  defs as (
    select d.* from word_definitions d
    where d.owner_id = u
       or (d.circle_id = any(my_circles) and d.status <> 'cancelled' and (d.kind = 'group' or d.visibility <> 'private'))
  ),
  kms as (
    select k.* from word_commitments k join defs d on d.id = k.definition_id
    where k.user_id = u or (d.circle_id is not null and k.status <> 'cancelled' and d.visibility <> 'private')
  ),
  obs as (
    select o.* from daily_obligations o join kms k on k.id = o.commitment_id
    where o.user_id = u or k.user_id <> u
  ),
  led as (
    select l.* from virtual_ledger l
    where l.user_id = u or (l.circle_id = any(my_circles) and l.transaction_type in ('MISS_TO_CIRCLE','REVERSE'))
  ),
  evs as (select e.* from social_events e where e.circle_id = any(my_circles) order by e.created_at desc limit 300)
  select jsonb_build_object(
    'me', u,
    'serverNow', now(),
    'users', coalesce((select jsonb_object_agg(pr.id, jsonb_build_object('id', pr.id, 'name', pr.display_name, 'color', pr.color, 'deleted', pr.status = 'deleted',
                'settings', case when pr.id = u then pr.settings else jsonb_build_object('hideFromLeaderboard', coalesce((pr.settings->>'hideFromLeaderboard')::boolean,false)) end,
                'timezone', case when pr.id = u then pr.timezone else null end, 'createdAt', pr.created_at, 'ageConfirmed', pr.age_confirmed))
              from profiles pr where pr.id in (select user_id from cmates)), '{}'),
    'circles', coalesce((select jsonb_object_agg(c.id, jsonb_build_object('id', c.id, 'name', c.name, 'description', c.description, 'ownerId', c.owner_id, 'color', c.color,
                'whoCanPropose', c.who_can_propose, 'maxMembers', c.max_members, 'roundStart', c.round_start, 'status', c.status, 'createdAt', c.created_at))
              from circles c where c.id = any(my_circles)), '{}'),
    'memberships', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'circleId', m.circle_id, 'userId', m.user_id, 'role', m.role, 'joinedAt', m.joined_at, 'leftAt', m.left_at))
              from circle_memberships m where m.circle_id = any(my_circles)), '[]'),
    'invites', coalesce((select jsonb_object_agg(i.token_hash, jsonb_build_object('tokenHash', i.token_hash, 'hint', i.token_hint, 'circleId', i.circle_id, 'inviterId', i.inviter_id, 'createdAt', i.created_at, 'expiresAt', i.expires_at, 'status', i.status, 'uses', i.uses, 'maxUses', i.max_uses))
              from circle_invites i where i.circle_id = any(my_circles) and i.status = 'active' and i.expires_at > now()), '{}'),
    'wordDefs', coalesce((select jsonb_object_agg(d.id, jsonb_build_object('id', d.id, 'kind', d.kind, 'circleId', d.circle_id, 'ownerId', d.owner_id, 'title', d.title, 'rule', d.rule, 'icon', d.icon,
                'visibility', d.visibility, 'version', d.version, 'startDate', d.start_date, 'endDate', d.end_date, 'status', d.status, 'createdAt', d.created_at)) from defs d), '{}'),
    'commitments', coalesce((select jsonb_object_agg(k.id, jsonb_build_object('id', k.id, 'defId', k.definition_id, 'userId', k.user_id, 'startDate', k.start_date, 'endDate', k.end_date, 'status', k.status,
                'endReason', k.end_reason, 'summarySeen', k.summary_seen, 'createdAt', k.created_at, 'completedAt', k.completed_at)) from kms k), '{}'),
    'obligations', coalesce((select jsonb_object_agg(o.id, jsonb_build_object('id', o.id, 'commitmentId', o.commitment_id, 'userId', o.user_id, 'localDate', o.local_date, 'status', o.status, 'outcome', o.outcome,
                'resolveReason', case when o.user_id = u then o.resolve_reason else null end, 'resolvedAt', o.resolved_at, 'correctedAt', o.corrected_at, 'note', case when o.user_id = u then o.note else null end)) from obs o), '{}'),
    'ledger', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'obligationId', l.obligation_id, 'userId', l.user_id, 'defId', l.definition_id, 'circleId', l.circle_id, 'type', l.transaction_type,
                'amount', l.amount, 'reversalOf', l.reversal_of, 'localDate', l.local_date, 'createdAt', l.created_at) order by l.created_at) from led l), '[]'),
    'resolutionHistory', coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'obligationId', h.obligation_id, 'from', h.from_state, 'to', h.to_state, 'reason', h.reason, 'actorId', h.actor_id, 'at', h.created_at))
                from resolution_history h join daily_obligations o on o.id = h.obligation_id where o.user_id = u), '[]'),
    'achievements', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'userId', a.user_id, 'type', a.type, 'earnedAt', a.earned_at, 'sourceRef', a.source_ref)) from achievements a where a.user_id = u), '[]'),
    'socialEvents', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'circleId', e.circle_id, 'actorId', e.actor_id, 'type', e.type, 'payload', e.payload, 'createdAt', e.created_at)) from evs e), '[]'),
    'encouragements', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'eventId', r.event_id, 'userId', r.user_id, 'reaction', r.reaction, 'createdAt', r.created_at))
                from encouragements r where r.event_id in (select id from evs)), '[]'),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object('blockerId', b.blocker_id, 'blockedId', b.blocked_id, 'at', b.created_at)) from user_blocks b where b.blocker_id = u), '[]'),
    'notifications', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'userId', n.user_id, 'type', n.type, 'title', n.title, 'body', n.body, 'ref', n.ref, 'read', n.read, 'createdAt', n.created_at))
                from notifications n where n.user_id = u), '[]')
  ) into out;
  return out;
end $$;

-- ---------- הרשאות הפעלה ----------
revoke execute on all functions in schema public from public, anon;
do $$ declare f text; begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'rpc\_%' loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
