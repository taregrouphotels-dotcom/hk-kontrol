-- AI maliyeti küçük tutarlarda 0.00 görünmesin: 4 haneye yuvarla
create or replace function ai_stats(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with u as (select * from ai_usage where is_admin()
               and (created_at at time zone 'Europe/Istanbul')::date between p_from and p_to),
       r as (select sr.*, s.title, s.step_order, t.code from step_results sr
             join cleanings c on c.id = sr.cleaning_id
             join check_steps s on s.id = sr.step_id join room_types t on t.id = s.room_type_id
             where is_admin() and sr.ai_status <> 'pending' and not sr.skipped
               and (c.started_at at time zone 'Europe/Istanbul')::date between p_from and p_to)
  select jsonb_build_object(
    'photos', (select count(*) from u),
    'input_tokens', (select coalesce(sum(input_tokens), 0) from u),
    'output_tokens', (select coalesce(sum(output_tokens), 0) from u),
    'cost_usd', (select round(coalesce(sum(input_tokens), 0) / 1e6 * (select value::text::numeric from settings where key = 'ai_price_input_per_mtok')
                       + coalesce(sum(output_tokens), 0) / 1e6 * (select value::text::numeric from settings where key = 'ai_price_output_per_mtok'), 4) from u),
    'by_status', (select coalesce(jsonb_object_agg(ai_status, n), '{}') from (select ai_status, count(*) n from r group by 1) x),
    'flagged', (select count(*) from r where ai_status in ('warn', 'fail', 'unclear')),
    'false_alarms', (select count(*) from r where ai_false_alarm),
    'retakes', (select count(*) from r where attempt > 1),
    'top_steps', (select coalesce(jsonb_agg(x order by x.n desc), '[]') from (
                   select code || ' · ' || step_order || '. ' || title as step, count(*) n from r
                   where ai_status in ('warn', 'fail', 'unclear') and not ai_false_alarm group by 1 order by 2 desc limit 10) x)
  )
$$;
