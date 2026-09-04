-- ============================================================
--  ALCANCÍA VI · integración con Discord (100% dentro de Supabase)
--  Requisito: haber corrido antes schema.sql
--
--  1) Pega TODO este archivo en SQL Editor → Run
--  2) Luego corre, en una consulta aparte, con tu URL real:
--
--     insert into private.config (clave, valor)
--     values ('discord_webhook', 'https://discord.com/api/webhooks/XXXX/YYYY')
--     on conflict (clave) do update set valor = excluded.valor;
--
--  3) Prueba manual:  select public.enviar_resumen_discord();
-- ============================================================

-- Si alguna de estas dos líneas falla, activa "pg_net" y "pg_cron" desde
-- Database → Extensions en el dashboard y vuelve a correr el archivo.
create extension if not exists pg_net  with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ---------- Configuración privada (no visible desde la web) ----------
create schema if not exists private;
create table if not exists private.config (
  clave text primary key,
  valor text not null
);
revoke all on schema private from anon, authenticated;
revoke all on private.config from anon, authenticated;

-- Valores por defecto (se pueden cambiar con update)
insert into private.config (clave, valor) values
  ('sitio_url',   'https://zuk4ritass.github.io/alcancia-gta6/'),
  ('meta_cop',    '430000'),
  ('fecha_meta',  '2027-02-01')
on conflict (clave) do nothing;

-- ---------- Helpers ----------
create or replace function private.cfg(p_clave text)
returns text language sql stable security definer set search_path = private as $$
  select valor from private.config where clave = p_clave
$$;

create or replace function private.cop(p_n numeric)
returns text language sql immutable as $$
  select '$' || replace(to_char(coalesce(p_n, 0), 'FM999G999G999G999'), ',', '.')
$$;

create or replace function private.discord_post(p_payload jsonb)
returns void language plpgsql security definer set search_path = private, extensions, net as $$
declare v_url text;
begin
  v_url := private.cfg('discord_webhook');
  if v_url is null or v_url = '' then return; end if;
  perform net.http_post(
    url     := v_url,
    body    := p_payload,
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
exception when others then
  raise warning 'discord_post falló: %', sqlerrm;
end $$;

-- Estado calculado de una alcancía (mismas fórmulas que la web)
create or replace function private.estado_alcancia(p_id uuid)
returns table (
  nombre text, emoji text, slug text, fecha_meta date,
  total numeric, meta numeric, falta numeric, pct int,
  dias int, meses int, cuota_mes numeric, n_aportes int, completo boolean
) language sql stable security definer set search_path = public, private as $$
  with a as (
    select al.*, coalesce((select sum(ap.monto) from public.aportes ap where ap.alcancia_id = al.id), 0)::numeric as total,
           (select count(*) from public.aportes ap where ap.alcancia_id = al.id)::int as n
    from public.alcancias al where al.id = p_id
  ), c as (
    select *, private.cfg('meta_cop')::numeric as meta,
      greatest(0, (a.fecha_meta - (now() at time zone 'America/Bogota')::date))::int as dias
    from a
  )
  select nombre, emoji, slug, fecha_meta, total, meta,
         greatest(0, meta - total) as falta,
         least(100, floor(total / meta * 100))::int as pct,
         dias,
         greatest(1, ceil(dias / 30.4375))::int as meses,
         ceil(greatest(0, meta - total) / greatest(1, ceil(dias / 30.4375)) / 100) * 100 as cuota_mes,
         n, (total >= meta) as completo
  from c
$$;

-- ---------- 1) Aviso instantáneo por cada aporte ----------
create or replace function public.trg_discord_aporte()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare e record; v_titulo text; v_desc text; v_color int; v_url text;
begin
  select * into e from private.estado_alcancia(new.alcancia_id);
  if not found then return new; end if;
  v_url := private.cfg('sitio_url') || '#/a/' || e.slug;

  if e.completo and e.total - new.monto < e.meta then
    v_titulo := format('🏆 ¡%s %s COMPLETÓ LA META!', e.emoji, e.nombre);
    v_desc   := format('Metió %s y llegó a **%s**. Ya tiene asegurado su GTA VI. 🎉%s', private.cop(new.monto), private.cop(e.total),
                       case when new.nota is not null then E'\n> ' || new.nota else '' end);
    v_color  := 5170850;  -- verde
  else
    v_titulo := format('%s %s metió %s', e.emoji, e.nombre, private.cop(new.monto));
    v_desc   := format('Va en **%s%%** · lleva **%s** · le faltan %s%s%s',
                       e.pct, private.cop(e.total), private.cop(e.falta),
                       case when e.completo then '' else format(E'\nNecesita **%s/mes** durante %s meses', private.cop(e.cuota_mes), e.meses) end,
                       case when new.nota is not null then E'\n> ' || new.nota else '' end);
    v_color  := 16732067; -- rosa VI
  end if;

  perform private.discord_post(jsonb_build_object(
    'username', 'Alcancía VI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', v_titulo,
      'description', v_desc,
      'url', v_url,
      'color', v_color,
      'footer', jsonb_build_object('text', format('Faltan %s días para el %s', e.dias, to_char(e.fecha_meta, 'DD/MM/YYYY')))
    ))
  ));
  return new;
end $$;

drop trigger if exists discord_aporte on public.aportes;
create trigger discord_aporte after insert on public.aportes
  for each row execute function public.trg_discord_aporte();

-- ---------- 2) Aviso cuando alguien abre su alcancía ----------
create or replace function public.trg_discord_nueva_alcancia()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare v_dias int; v_meses int; v_cuota numeric;
begin
  v_dias  := greatest(0, new.fecha_meta - (now() at time zone 'America/Bogota')::date);
  v_meses := greatest(1, ceil(v_dias / 30.4375));
  v_cuota := ceil(private.cfg('meta_cop')::numeric / v_meses / 100) * 100;
  perform private.discord_post(jsonb_build_object(
    'username', 'Alcancía VI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('%s %s abrió su alcancía', new.emoji, new.nombre),
      'description', format('Meta **%s** para el %s. Necesita **%s/mes**. ¡A darle!',
                            private.cop(private.cfg('meta_cop')::numeric), to_char(new.fecha_meta, 'DD/MM/YYYY'), private.cop(v_cuota)),
      'url', private.cfg('sitio_url') || '#/a/' || new.slug,
      'color', 5989350 -- azul VI
    ))
  ));
  return new;
end $$;

drop trigger if exists discord_nueva_alcancia on public.alcancias;
create trigger discord_nueva_alcancia after insert on public.alcancias
  for each row execute function public.trg_discord_nueva_alcancia();

-- ---------- 3) Resumen semanal (domingo 7 pm Colombia) ----------
create or replace function public.enviar_resumen_discord()
returns void language plpgsql security definer set search_path = public, private as $$
declare
  v_lineas text; v_total numeric; v_n int; v_sem_n int; v_sem_total numeric;
  v_dias int; v_fecha date; v_semana_ini date;
begin
  v_fecha := private.cfg('fecha_meta')::date;
  v_dias  := greatest(0, v_fecha - (now() at time zone 'America/Bogota')::date);
  v_semana_ini := (now() at time zone 'America/Bogota')::date - 7;

  select count(*), coalesce(sum(t.total), 0) into v_n, v_total
  from (select al.id, (select coalesce(sum(monto),0) from public.aportes where alcancia_id = al.id) as total from public.alcancias al) t;

  select count(*), coalesce(sum(monto), 0) into v_sem_n, v_sem_total
  from public.aportes where fecha >= v_semana_ini;

  if v_n = 0 then return; end if;

  select string_agg(
    format('%s %s %s **%s** — %s (%s%%)%s',
      case r when 1 then '🥇' when 2 then '🥈' when 3 then '🥉' else '`#' || r || '`' end,
      e.emoji, case when e.completo then '🏆' else '' end, e.nombre, private.cop(e.total), e.pct,
      case when e.completo then '' else format(' · faltan %s · %s/mes', private.cop(e.falta), private.cop(e.cuota_mes)) end
    ), E'\n' order by r)
  into v_lineas
  from (
    select row_number() over (order by e.total desc, al.creado_en) as r, e.*
    from public.alcancias al, lateral private.estado_alcancia(al.id) e
  ) e;

  perform private.discord_post(jsonb_build_object(
    'username', 'Alcancía VI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('📊 Ranking semanal · faltan %s días', v_dias),
      'description', v_lineas,
      'url', private.cfg('sitio_url'),
      'color', 16744279, -- naranja VI
      'fields', jsonb_build_array(
        jsonb_build_object('name', 'Esta semana', 'value', format('%s aportes · %s', v_sem_n, private.cop(v_sem_total)), 'inline', true),
        jsonb_build_object('name', 'El grupo lleva', 'value', format('%s entre %s', private.cop(v_total), v_n), 'inline', true)
      ),
      'footer', jsonb_build_object('text', format('Meta %s por cabeza · lanzamiento estimado %s', private.cop(private.cfg('meta_cop')::numeric), to_char(v_fecha, 'DD/MM/YYYY')))
    ))
  ));
end $$;

-- ---------- 4) Recordatorio del viernes a los que no han aportado ----------
create or replace function public.enviar_recordatorio_discord()
returns void language plpgsql security definer set search_path = public, private as $$
declare v_lista text; v_n int; v_semana_ini date;
begin
  v_semana_ini := (now() at time zone 'America/Bogota')::date - 6;  -- desde el sábado pasado
  select string_agg(format('%s **%s** (va en %s%%)', e.emoji, e.nombre, e.pct), ', ' order by e.total desc), count(*)
  into v_lista, v_n
  from public.alcancias al, lateral private.estado_alcancia(al.id) e
  where not e.completo
    and not exists (select 1 from public.aportes ap where ap.alcancia_id = al.id and ap.fecha >= v_semana_ini);

  if v_n = 0 then
    perform private.discord_post(jsonb_build_object('username', 'Alcancía VI',
      'content', '✅ Todo el mundo aportó esta semana. Leonida se acerca. 🌴'));
    return;
  end if;

  perform private.discord_post(jsonb_build_object(
    'username', 'Alcancía VI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', '👀 Es viernes y estas alcancías siguen en cero esta semana',
      'description', v_lista || E'\n\nAún alcanzan a meter algo antes del ranking del domingo.',
      'url', private.cfg('sitio_url'),
      'color', 16752732 -- ámbar
    ))
  ));
end $$;

-- ---------- Programación (pg_cron corre en UTC; Colombia es UTC-5) ----------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('alcancia_resumen_semanal', 'alcancia_recordatorio_viernes');
exception when others then null;
end $$;
select cron.schedule('alcancia_resumen_semanal',     '0 0 * * 1',  $$select public.enviar_resumen_discord()$$);      -- lunes 00:00 UTC = domingo 7 pm
select cron.schedule('alcancia_recordatorio_viernes', '0 23 * * 5', $$select public.enviar_recordatorio_discord()$$); -- viernes 23:00 UTC = 6 pm

-- Nadie desde la web puede disparar estos envíos:
revoke all on function public.enviar_resumen_discord() from public, anon, authenticated;
revoke all on function public.enviar_recordatorio_discord() from public, anon, authenticated;
