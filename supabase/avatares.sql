-- ============================================================
--  ALCANCÍA VI · avatares del póster oficial
--  La web guarda en `alcancias.emoji` claves como 'av1'..'av9' cuando la
--  persona elige un personaje del póster. Para Discord se traducen a emoji.
--  Requiere discord.sql. Pega todo en SQL Editor → Run.
-- ============================================================

create or replace function private.emoji_txt(p text)
returns text language sql immutable as $$
  select case p
    when 'av1' then '🚁' when 'av2' then '👫' when 'av3' then '🦩'
    when 'av4' then '🕶️' when 'av5' then '🍹' when 'av6' then '🚗'
    when 'av7' then '🐊' when 'av8' then '⛓️' when 'av9' then '🏍️'
    else coalesce(p, '🐷') end
$$;

-- estado_alcancia ya devuelve el emoji traducido (lo usan aporte, ranking y recordatorio)
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
  select nombre, private.emoji_txt(emoji), slug, fecha_meta, total, meta,
         greatest(0, meta - total) as falta,
         least(100, floor(total / meta * 100))::int as pct,
         dias,
         greatest(1, ceil(dias / 30.4375))::int as meses,
         ceil(greatest(0, meta - total) / greatest(1, ceil(dias / 30.4375)) / 100) * 100 as cuota_mes,
         n, (total >= meta) as completo
  from c
$$;

-- El aviso de alcancía nueva usa new.emoji directamente: traducirlo
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
      'title', format('%s %s abrió su alcancía', private.emoji_txt(new.emoji), new.nombre),
      'description', format('Meta **%s** para el %s. Necesita **%s/mes**. ¡A darle!',
                            private.cop(private.cfg('meta_cop')::numeric), to_char(new.fecha_meta, 'DD/MM/YYYY'), private.cop(v_cuota)),
      'url', private.cfg('sitio_url') || '#/a/' || new.slug,
      'color', 5989350
    ))
  ));
  return new;
end $$;
