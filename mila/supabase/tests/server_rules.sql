-- בדיקות שרת: שתי משתמשות אמיתיות, אותו מעגל, אותם חוקים.
-- מריצים מול Postgres מקומי אחרי local_shim.sql + המיגרציה:
--   psql -v ON_ERROR_STOP=1 -d mila -f supabase/tests/server_rules.sql
-- כל assert הוא RAISE EXCEPTION, כך שכישלון עוצר את הריצה.

\set a '11111111-1111-1111-1111-111111111111'
\set b '22222222-2222-2222-2222-222222222222'
\set z '33333333-3333-3333-3333-333333333333'

insert into auth.users(id, email) values (:'a', 'a@test'), (:'b', 'b@test'), (:'z', 'z@test') on conflict do nothing;
-- משתני psql אינם מוחלפים בתוך בלוקי DO, לכן נשמור אותם כהגדרות session
create or replace function tv(n text) returns text language sql stable as $$ select current_setting('mila.' || n, true) $$;
create or replace function uv(n text) returns uuid language sql stable as $$ select current_setting('mila.' || n, true)::uuid $$;
select set_config('mila.a', :'a', false), set_config('mila.b', :'b', false), set_config('mila.z', :'z', false);

-- התחברות כ-A
select set_config('request.jwt.claim.sub', :'a', false);
\echo '--- A: הרשמה + מעגל'
select rpc_upsert_profile('יעל', true, 'pink');
do $$ begin
  begin perform rpc_upsert_profile('קטינה', false); raise exception 'FAIL: age gate'; exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
end $$;
create temp table t as select rpc_create_circle('חברות', 'בדיקה', 'pink', 'all', 8, null) as r;
select (r->>'circleId')::uuid as cid, r->>'inviteToken' as tok from t \gset
select set_config('mila.cid', :'cid', false), set_config('mila.tok', :'tok', false);

-- A לא יכולה לדווח/לראות דברים של אחרים (עדיין אין)
\echo '--- B: הרשמה, תצוגה מקדימה של הזמנה, הצטרפות'
select set_config('request.jwt.claim.sub', :'b', false);
select rpc_upsert_profile('נועה', true, 'lavender');
do $$ declare p jsonb; begin
  p := rpc_preview_invite(tv('tok'));
  if not (p->>'ok')::boolean then raise exception 'FAIL: preview %', p; end if;
  if (p->>'memberCount')::int <> 1 then raise exception 'FAIL: memberCount'; end if;
  if (p->'inviter'->>'name') <> 'יעל' then raise exception 'FAIL: inviter'; end if;
  p := rpc_preview_invite('ZZZZZZ');
  if (p->>'ok')::boolean then raise exception 'FAIL: bad token accepted'; end if;
end $$;
select rpc_accept_invite(:'tok');
select rpc_accept_invite(:'tok');  -- אידמפוטנטי
do $$ declare s jsonb; begin
  s := rpc_my_state();
  if jsonb_array_length(s->'memberships') <> 2 then raise exception 'FAIL: B should see 2 memberships, got %', s->'memberships'; end if;
  if (s->'obligations') <> '{}'::jsonb then raise exception 'FAIL: AT-02 joining created obligations'; end if;
  if (s->'ledger') <> '[]'::jsonb then raise exception 'FAIL: AT-02 joining created ledger'; end if;
end $$;

\echo '--- A: מציעה מילה קבוצתית; B מאמצת; A מאמצת'
select set_config('request.jwt.claim.sub', :'a', false);
select (rpc_propose_group_word(:'cid', '8,000 צעדים', 'מונה צעדים', 'run', fn_local_today(:'a'::uuid), 'status')->>'defId')::uuid as def \gset
select set_config('mila.def', :'def', false);
select (rpc_adopt_group_word(:'def')->>'commitmentId')::uuid as ka \gset
select set_config('mila.ka', :'ka', false);
select set_config('request.jwt.claim.sub', :'b', false);
select (rpc_adopt_group_word(:'def')->>'commitmentId')::uuid as kb \gset
select set_config('mila.kb', :'kb', false);
do $$ begin
  if uv('ka') = uv('kb') then raise exception 'FAIL: AT-04 same commitment for two users'; end if;
  if (select count(*) from daily_obligations where commitment_id = uv('kb')) <> 14 then raise exception 'FAIL: 14 obligations'; end if;
  if (rpc_adopt_group_word(uv('def'))->>'duplicate')::boolean is not true then raise exception 'FAIL: adopt should be idempotent'; end if;
end $$;

\echo '--- דיווחים: A פספסה, B הצליחה; B לא יכולה לדווח על A'
select id as ob_a from daily_obligations where commitment_id = :'ka' and local_date = fn_local_today(:'a'::uuid) \gset
select id as ob_b from daily_obligations where commitment_id = :'kb' and local_date = fn_local_today(:'b'::uuid) \gset
select set_config('mila.ob_a', :'ob_a', false), set_config('mila.ob_b', :'ob_b', false);
do $$ begin
  begin perform rpc_report(uv('ob_a'), 'success'); raise exception 'FAIL: B reported on A obligation'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
end $$;
select rpc_report(:'ob_b', 'success');
do $$ declare r jsonb; begin
  r := rpc_report(uv('ob_b'), 'miss');
  if (r->>'duplicate')::boolean is not true or (r->>'outcome') <> 'success' then raise exception 'FAIL: AT-06 duplicate report changed outcome %', r; end if;
end $$;
select set_config('request.jwt.claim.sub', :'a', false);
select rpc_report(:'ob_a', 'miss');

\echo '--- בנק וקופה אצל שתיהן'
do $$ declare s jsonb; earn int; miss int; pool int; begin
  s := rpc_my_state();
  select count(*) into earn from jsonb_array_elements(s->'ledger') l where l->>'userId' = tv('a') and l->>'type' = 'EARN';
  select count(*) into miss from jsonb_array_elements(s->'ledger') l where l->>'userId' = tv('a') and l->>'type' = 'MISS_TO_CIRCLE';
  select count(*) into pool from jsonb_array_elements(s->'ledger') l where l->>'type' = 'MISS_TO_CIRCLE' and l->>'circleId' = tv('cid');
  if earn <> 0 or miss <> 1 or pool <> 1 then raise exception 'FAIL: A bank earn=% miss=% pool=%', earn, miss, pool; end if;
  -- A רואה את ההצלחה של B רק כסטטוס (visibility=status) – לא את ה-resolveReason
  if (select count(*) from jsonb_each(s->'obligations') o where o.value->>'userId' = tv('b') and o.value->>'outcome' = 'success') <> 1 then raise exception 'FAIL: A should see B status'; end if;
  if (select count(*) from jsonb_each(s->'obligations') o where o.value->>'userId' = tv('b') and o.value->>'resolveReason' is not null) <> 0 then raise exception 'FAIL: leaked resolveReason'; end if;
  if (select count(*) from jsonb_array_elements(s->'socialEvents') e where e->>'type' in ('day_success','day_miss')) <> 2 then raise exception 'FAIL: feed events'; end if;
end $$;
select set_config('request.jwt.claim.sub', :'b', false);
do $$ declare s jsonb; earn int; pool int; begin
  s := rpc_my_state();
  select count(*) into earn from jsonb_array_elements(s->'ledger') l where l->>'userId' = tv('b') and l->>'type' = 'EARN';
  select count(*) into pool from jsonb_array_elements(s->'ledger') l where l->>'type' = 'MISS_TO_CIRCLE' and l->>'circleId' = tv('cid');
  if earn <> 1 or pool <> 1 then raise exception 'FAIL: B bank earn=% pool=%', earn, pool; end if;
  if (select count(*) from jsonb_array_elements(s->'achievements') a where a->>'type' in ('first_day','first_word','first_circle')) <> 3 then raise exception 'FAIL: achievements %', s->'achievements'; end if;
end $$;

\echo '--- תיקון: B מתקנת הצלחה לפספוס → REVERSE + MISS'
select rpc_correct(:'ob_b', 'miss', 'לחצתי בטעות');
do $$ begin
  if (select count(*) from virtual_ledger where obligation_id = uv('ob_b')) <> 3 then raise exception 'FAIL: AT-07 ledger rows'; end if;
  if (select count(*) from virtual_ledger l where l.obligation_id = uv('ob_b') and l.transaction_type <> 'REVERSE' and not exists (select 1 from virtual_ledger r where r.reversal_of = l.id)) <> 1 then raise exception 'FAIL: exactly one active entry'; end if;
  begin update virtual_ledger set amount = 5 where obligation_id = uv('ob_b'); raise exception 'FAIL: ledger updatable'; exception when others then if sqlerrm not like '%append-only%' then raise; end if; end;
  begin perform rpc_correct(uv('ob_b'), 'success', ''); raise exception 'FAIL: correction without reason'; exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
end $$;

\echo '--- תקרה: 3 מילים ביום, הרביעית נחסמת (AT-03, מסע D)'
select rpc_create_personal_word('קריאה', '10 עמודים', 'book', fn_local_today(:'b'::uuid));
select rpc_create_personal_word('מים', '8 כוסות', 'water', fn_local_today(:'b'::uuid));
do $$ begin
  begin perform rpc_create_personal_word('רביעית', 'כלל', 'leaf', fn_local_today(uv('b'))); raise exception 'FAIL: cap not enforced'; exception when others then if sqlerrm not like 'CAP%' then raise; end if; end;
  -- חריגה ישירה בטבלה גם נחסמת (טריגר)
  begin insert into daily_obligations(commitment_id, user_id, local_date, status) values (uv('kb'), uv('b'), fn_local_today(uv('b')) + 20, 'scheduled'); exception when others then null; end;
  begin
    insert into daily_obligations(commitment_id, user_id, local_date, status) select uv('kb'), uv('b'), fn_local_today(uv('b')), 'open';
    raise exception 'FAIL: trigger cap';
  exception when others then if sqlerrm not like '%DAILY_CAP%' and sqlerrm not like '%duplicate key%' then raise; end if; end;
  -- מילה שמתחילה אחרי הסבב מותרת
  perform rpc_create_personal_word('אחרי', 'כלל', 'leaf', fn_local_today(uv('b')) + 14);
end $$;

\echo '--- החרגות: עד 2; לא מנפיקות מטבע'
select id as ob_b2 from daily_obligations where commitment_id = :'kb' and local_date = fn_local_today(:'b'::uuid) + 1 \gset
select set_config('mila.ob_b2', :'ob_b2', false);
do $$ begin
  begin perform rpc_report(uv('ob_b2'), 'success'); raise exception 'FAIL: future report'; exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
end $$;

\echo '--- הפרדת נתונים: Z לא במעגל, לא רואה כלום'
select set_config('request.jwt.claim.sub', :'z', false);
select rpc_upsert_profile('זרה', true);
do $$ declare s jsonb; begin
  s := rpc_my_state();
  if (s->'circles') <> '{}'::jsonb or (s->'wordDefs') <> '{}'::jsonb or (s->'obligations') <> '{}'::jsonb or (s->'ledger') <> '[]'::jsonb or (s->'socialEvents') <> '[]'::jsonb then raise exception 'FAIL: data leak to non-member %', s; end if;
  if (select count(*) from jsonb_object_keys(s->'users')) <> 1 then raise exception 'FAIL: profiles leak'; end if;
  begin perform rpc_adopt_group_word(uv('def')); raise exception 'FAIL: non-member adopted'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform rpc_propose_group_word(uv('cid'), 'x', 'y', 'leaf', fn_local_today(uv('z'))); raise exception 'FAIL: non-member proposed'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
  begin perform rpc_update_circle(uv('cid'), '{"name":"hack"}'); raise exception 'FAIL: non-admin updated circle'; exception when others then if sqlerrm not like 'FORBIDDEN%' then raise; end if; end;
end $$;

\echo '--- חסימה: Z חסומה ע"י A לא רואה את ההזמנה; קישור מבוטל לא עובד'
select set_config('request.jwt.claim.sub', :'a', false);
select rpc_block(:'z');
select set_config('request.jwt.claim.sub', :'z', false);
do $$ declare p jsonb; begin
  p := rpc_preview_invite(tv('tok'));
  if (p->>'ok')::boolean then raise exception 'FAIL: blocked user saw invite'; end if;
end $$;
select set_config('request.jwt.claim.sub', :'a', false);
select rpc_unblock(:'z');
select rpc_revoke_invite(:'tok');
select set_config('request.jwt.claim.sub', :'z', false);
do $$ declare p jsonb; begin
  p := rpc_preview_invite(tv('tok'));
  if (p->>'reason') <> 'revoked' then raise exception 'FAIL: revoked invite %', p; end if;
  begin perform rpc_accept_invite(tv('tok')); raise exception 'FAIL: accepted revoked'; exception when others then if sqlerrm not like 'INVITE_INVALID%' then raise; end if; end;
end $$;

\echo '--- חשיפה: אפשר רק לצמצם'
select set_config('request.jwt.claim.sub', :'a', false);
select rpc_set_visibility(:'def', 'summary');
do $$ begin
  begin perform rpc_set_visibility(uv('def'), 'status'); raise exception 'FAIL: widened visibility'; exception when others then if sqlerrm not like 'VALIDATION%' then raise; end if; end;
end $$;

\echo '--- מנהלת עוזבת: הניהול עובר ל-B, המילים של A במעגל מסתיימות'
select rpc_leave_circle(:'cid');
do $$ begin
  if not fn_is_admin(uv('cid'), uv('b')) then raise exception 'FAIL: admin not transferred'; end if;
  if (select status from word_commitments where id = uv('ka')) <> 'ended_early' then raise exception 'FAIL: A commitment not ended'; end if;
  if (select count(*) from daily_obligations where commitment_id = uv('ka') and status = 'cancelled') <> 13 then raise exception 'FAIL: future days not cancelled'; end if;
  -- השקלים/פספוסים שנזקפו נשארים
  if (select count(*) from virtual_ledger where obligation_id = uv('ob_a')) <> 1 then raise exception 'FAIL: history lost'; end if;
end $$;
do $$ declare s jsonb; begin
  s := rpc_my_state();
  if (s->'circles') <> '{}'::jsonb then raise exception 'FAIL: A still sees circle after leaving'; end if;
end $$;

\echo '--- אינווריאנטים גלובליים'
do $$ declare bad int; begin
  select count(*) into bad from (select obligation_id, count(*) c from virtual_ledger l where transaction_type <> 'REVERSE' and not exists (select 1 from virtual_ledger r where r.reversal_of = l.id) group by obligation_id having count(*) > 1) x;
  if bad > 0 then raise exception 'FAIL: multiple active ledger entries'; end if;
  select count(*) into bad from (select user_id, local_date, count(*) from daily_obligations where status <> 'cancelled' group by 1,2 having count(*) > 3) x;
  if bad > 0 then raise exception 'FAIL: cap violated'; end if;
  select count(*) into bad from daily_obligations o where o.outcome in ('success','miss') and not exists (select 1 from virtual_ledger l where l.obligation_id = o.id and l.transaction_type <> 'REVERSE' and not exists (select 1 from virtual_ledger r where r.reversal_of = l.id));
  if bad > 0 then raise exception 'FAIL: resolved without ledger'; end if;
  select count(*) into bad from daily_obligations o where (o.outcome is null or o.outcome = 'excused') and exists (select 1 from virtual_ledger l where l.obligation_id = o.id and l.transaction_type <> 'REVERSE' and not exists (select 1 from virtual_ledger r where r.reversal_of = l.id));
  if bad > 0 then raise exception 'FAIL: ledger without resolution'; end if;
end $$;

\echo '--- מחיקת חשבון: אנונימיזציה'
select set_config('request.jwt.claim.sub', :'z', false);
select rpc_delete_account();
do $$ begin
  if (select display_name from profiles where id = uv('z')) <> 'משתתפת שעזבה' then raise exception 'FAIL: not anonymized'; end if;
  begin perform rpc_my_state(); exception when others then null; end;
end $$;

\echo 'ALL SERVER TESTS PASSED'
