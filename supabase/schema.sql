-- ============================================================
--  ALCANCÍA VI · esquema de Supabase
--  Pega este archivo completo en: Supabase → SQL Editor → Run
-- ============================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas ----------
create table if not exists public.alcancias (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,
  nombre      text not null check (char_length(nombre) between 2 and 30),
  emoji       text not null default '🐷' check (char_length(emoji) <= 8),
  pin_hash    text not null,
  fecha_meta  date not null default '2027-02-01',
  creado_en   timestamptz not null default now()
);

create table if not exists public.aportes (
  id           uuid primary key default gen_random_uuid(),
  alcancia_id  uuid not null references public.alcancias(id) on delete cascade,
  monto        integer not null check (monto > 0 and monto <= 5000000),
  fecha        date not null default current_date,
  nota         text check (nota is null or char_length(nota) <= 80),
  creado_en    timestamptz not null default now()
);
create index if not exists aportes_alcancia_idx on public.aportes (alcancia_id, fecha desc);

-- ---------- Seguridad ----------
-- Lectura pública (para el ranking) pero NUNCA del pin_hash.
-- Escrituras solo a través de las funciones RPC que validan el PIN.
alter table public.alcancias enable row level security;
alter table public.aportes   enable row level security;

drop policy if exists "alcancias: lectura publica" on public.alcancias;
create policy "alcancias: lectura publica" on public.alcancias
  for select to anon, authenticated using (true);

drop policy if exists "aportes: lectura publica" on public.aportes;
create policy "aportes: lectura publica" on public.aportes
  for select to anon, authenticated using (true);

revoke all on public.alcancias from anon, authenticated;
revoke all on public.aportes   from anon, authenticated;
grant select (id, slug, nombre, emoji, fecha_meta, creado_en) on public.alcancias to anon, authenticated;
grant select on public.aportes to anon, authenticated;

-- ---------- Helpers ----------
create or replace function public._validar_pin(p_pin text)
returns void language plpgsql immutable as $$
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    raise exception 'El PIN debe tener entre 4 y 6 dígitos';
  end if;
end $$;

create or replace function public._exigir_pin(p_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_hash text;
begin
  select pin_hash into v_hash from public.alcancias where id = p_id;
  if v_hash is null then raise exception 'La alcancía no existe'; end if;
  if v_hash <> extensions.crypt(coalesce(p_pin, ''), v_hash) then
    raise exception 'PIN incorrecto';
  end if;
end $$;

create or replace function public._slugify(p_txt text)
returns text language sql immutable as $$
  select trim(both '-' from regexp_replace(
           lower(translate(p_txt, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
           '[^a-z0-9]+', '-', 'g'))
$$;

revoke all on function public._validar_pin(text) from public, anon, authenticated;
revoke all on function public._exigir_pin(uuid, text) from public, anon, authenticated;
revoke all on function public._slugify(text) from public, anon, authenticated;

-- ---------- RPC públicas ----------
create or replace function public.crear_alcancia(p_nombre text, p_emoji text, p_pin text, p_fecha_meta date)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id   uuid;
  v_slug text;
  v_base text;
begin
  perform public._validar_pin(p_pin);
  if p_nombre is null or char_length(trim(p_nombre)) < 2 then
    raise exception 'El nombre debe tener al menos 2 caracteres';
  end if;
  if p_fecha_meta is null or p_fecha_meta <= current_date then
    raise exception 'La fecha meta debe ser futura';
  end if;

  v_base := coalesce(nullif(public._slugify(trim(p_nombre)), ''), 'alcancia');
  v_slug := v_base;
  while exists (select 1 from public.alcancias where slug = v_slug) loop
    v_slug := v_base || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into public.alcancias (slug, nombre, emoji, pin_hash, fecha_meta)
  values (v_slug, trim(p_nombre), coalesce(nullif(p_emoji, ''), '🐷'),
          extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), p_fecha_meta)
  returning id into v_id;

  return json_build_object('id', v_id, 'slug', v_slug);
end $$;

create or replace function public.verificar_pin(p_id uuid, p_pin text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_pin(p_id, p_pin);
  return true;
exception when others then
  return false;
end $$;

create or replace function public.agregar_aporte(p_alcancia uuid, p_pin text, p_monto integer, p_fecha date, p_nota text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  perform public._exigir_pin(p_alcancia, p_pin);
  if p_monto is null or p_monto <= 0 then raise exception 'El monto debe ser mayor a cero'; end if;
  if p_fecha > current_date + 1 then raise exception 'La fecha no puede ser futura'; end if;
  insert into public.aportes (alcancia_id, monto, fecha, nota)
  values (p_alcancia, p_monto, coalesce(p_fecha, current_date), nullif(trim(p_nota), ''))
  returning id into v_id;
  return json_build_object('id', v_id);
end $$;

create or replace function public.eliminar_aporte(p_aporte uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare v_alc uuid;
begin
  select alcancia_id into v_alc from public.aportes where id = p_aporte;
  if v_alc is null then raise exception 'El aporte no existe'; end if;
  perform public._exigir_pin(v_alc, p_pin);
  delete from public.aportes where id = p_aporte;
end $$;

create or replace function public.actualizar_alcancia(p_id uuid, p_pin text, p_nombre text, p_emoji text, p_fecha_meta date)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_pin(p_id, p_pin);
  if p_fecha_meta is not null and p_fecha_meta <= current_date then
    raise exception 'La fecha meta debe ser futura';
  end if;
  update public.alcancias set
    nombre     = coalesce(nullif(trim(p_nombre), ''), nombre),
    emoji      = coalesce(nullif(p_emoji, ''), emoji),
    fecha_meta = coalesce(p_fecha_meta, fecha_meta)
  where id = p_id;
end $$;

create or replace function public.cambiar_pin(p_id uuid, p_pin_actual text, p_pin_nuevo text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_pin(p_id, p_pin_actual);
  perform public._validar_pin(p_pin_nuevo);
  update public.alcancias set pin_hash = extensions.crypt(p_pin_nuevo, extensions.gen_salt('bf', 8)) where id = p_id;
end $$;

create or replace function public.eliminar_alcancia(p_id uuid, p_pin text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public._exigir_pin(p_id, p_pin);
  delete from public.alcancias where id = p_id;
end $$;

grant execute on function public.crear_alcancia(text, text, text, date) to anon, authenticated;
grant execute on function public.verificar_pin(uuid, text) to anon, authenticated;
grant execute on function public.agregar_aporte(uuid, text, integer, date, text) to anon, authenticated;
grant execute on function public.eliminar_aporte(uuid, text) to anon, authenticated;
grant execute on function public.actualizar_alcancia(uuid, text, text, text, date) to anon, authenticated;
grant execute on function public.cambiar_pin(uuid, text, text) to anon, authenticated;
grant execute on function public.eliminar_alcancia(uuid, text) to anon, authenticated;

-- ---------- Realtime (el ranking se actualiza solo) ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'aportes') then
    alter publication supabase_realtime add table public.aportes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'alcancias') then
    alter publication supabase_realtime add table public.alcancias;
  end if;
end $$;
