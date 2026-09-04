-- ============================================================
--  ALCANCÍA VI · aportes en otras monedas (USD, GBP, EUR)
--  Requiere schema.sql (y discord.sql si usas Discord).
--  Pega todo en SQL Editor → Run.
-- ============================================================

alter table public.aportes
  add column if not exists moneda         text    not null default 'COP' check (moneda in ('COP','USD','GBP','EUR')),
  add column if not exists monto_original numeric(14,2),
  add column if not exists tasa           numeric(14,4);

-- La firma cambia, así que se elimina la versión anterior.
drop function if exists public.agregar_aporte(uuid, text, integer, date, text);

create or replace function public.agregar_aporte(
  p_alcancia uuid, p_pin text, p_monto integer, p_fecha date, p_nota text,
  p_moneda text default 'COP', p_monto_original numeric default null, p_tasa numeric default null
)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid; v_moneda text;
begin
  perform public._exigir_pin(p_alcancia, p_pin);
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  if p_fecha > current_date + 1 then raise exception 'La fecha no puede ser futura'; end if;
  v_moneda := upper(coalesce(p_moneda, 'COP'));
  if v_moneda not in ('COP','USD','GBP','EUR') then raise exception 'Moneda no soportada'; end if;
  if v_moneda <> 'COP' and (p_monto_original is null or p_monto_original <= 0 or p_tasa is null or p_tasa <= 0) then
    raise exception 'Falta el monto original o la tasa de cambio';
  end if;
  insert into public.aportes (alcancia_id, monto, fecha, nota, moneda, monto_original, tasa)
  values (p_alcancia, p_monto, coalesce(p_fecha, current_date), nullif(trim(p_nota), ''),
          v_moneda,
          case when v_moneda = 'COP' then null else p_monto_original end,
          case when v_moneda = 'COP' then null else p_tasa end)
  returning id into v_id;
  return json_build_object('id', v_id);
end $$;

grant execute on function public.agregar_aporte(uuid, text, integer, date, text, text, numeric, numeric) to anon, authenticated;

-- ---------- Discord: mostrar la moneda original ----------
create or replace function private.monto_original_txt(p_moneda text, p_original numeric)
returns text language sql immutable as $$
  select case
    when p_moneda is null or p_moneda = 'COP' or p_original is null then ''
    else ' (' || case p_moneda when 'USD' then 'US$' when 'GBP' then '£' when 'EUR' then '€' else p_moneda || ' ' end
         || rtrim(rtrim(to_char(p_original, 'FM999999990.00'), '0'), '.') || ')'
  end
$$;

create or replace function public.trg_discord_aporte()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare e record; v_titulo text; v_desc text; v_color int; v_url text; v_orig text;
begin
  select * into e from private.estado_alcancia(new.alcancia_id);
  if not found then return new; end if;
  v_url  := private.cfg('sitio_url') || '#/a/' || e.slug;
  v_orig := private.monto_original_txt(new.moneda, new.monto_original);

  if e.completo and e.total - new.monto < e.meta then
    v_titulo := format('🏆 ¡%s %s COMPLETÓ LA META!', e.emoji, e.nombre);
    v_desc   := format('Metió %s%s y llegó a **%s**. Ya tiene asegurado su GTA VI. 🎉%s', private.cop(new.monto), v_orig, private.cop(e.total),
                       case when new.nota is not null then E'\n> ' || new.nota else '' end);
    v_color  := 5170850;
  else
    v_titulo := format('%s %s metió %s%s', e.emoji, e.nombre, private.cop(new.monto), v_orig);
    v_desc   := format('Va en **%s%%** · lleva **%s** · le faltan %s%s%s',
                       e.pct, private.cop(e.total), private.cop(e.falta),
                       case when e.completo then '' else format(E'\nNecesita **%s/mes** durante %s meses', private.cop(e.cuota_mes), e.meses) end,
                       case when new.nota is not null then E'\n> ' || new.nota else '' end);
    v_color  := 16732067;
  end if;

  perform private.discord_post(jsonb_build_object(
    'username', 'Alcancía VI',
    'embeds', jsonb_build_array(jsonb_build_object(
      'title', v_titulo, 'description', v_desc, 'url', v_url, 'color', v_color,
      'footer', jsonb_build_object('text', format('Faltan %s días para el %s', e.dias, to_char(e.fecha_meta, 'DD/MM/YYYY')))
    ))
  ));
  return new;
end $$;
