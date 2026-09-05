-- ============================================================
--  ALCANCÍA VI · hitos por COPIAS (reemplaza los hitos por porcentaje)
--  Requiere discord.sql y bolsa.sql. Pega todo en SQL Editor → Run.
--
--  Ahora cada hito es una copia del juego asegurada por el grupo.
--  Nunca retroceden aunque se una gente nueva.
--
--  Para cambiar un premio:
--    update public.hitos set premio = 'Lo que ustedes decidan' where copias = 2;
-- ============================================================

-- 1) Migrar la tabla vieja (pct) a la nueva (copias), conservando los premios
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'hitos' and column_name = 'pct') then
    create table if not exists public.hitos_nueva (
      copias     int primary key check (copias between 1 and 50),
      titulo     text not null,
      premio     text not null,
      desbloquea text
    );
    -- 25% → copia 1, 50% → copia 2, 75% → copia 3, 100% → copia 4
    insert into public.hitos_nueva (copias, titulo, premio, desbloquea)
    select (row_number() over (order by pct))::int, titulo, premio, desbloquea
    from public.hitos
    on conflict (copias) do nothing;
    drop table public.hitos cascade;
    alter table public.hitos_nueva rename to hitos;
  end if;
end $$;

create table if not exists public.hitos (
  copias     int primary key check (copias between 1 and 50),
  titulo     text not null,
  premio     text not null,
  desbloquea text
);

insert into public.hitos (copias, titulo, premio, desbloquea) values
  (1, 'Vice Beach',    'Noche de pizza. La paga el último del ranking.',   'la bolsa en modo neón'),
  (2, 'Grassrivers',   'Maratón de GTA Online en Discord.',                'el arte completo del póster en la portada'),
  (3, 'Mount Kalaga',  'El primero del ranking elige el nombre del crew.', 'marco dorado en las cards'),
  (4, 'Port Gellhorn', 'Ronda de lo que el grupo decida.',                 'lluvia de confeti y título de crew'),
  (5, 'Ambrosia',      'Ronda de lo que el grupo decida.',                 null),
  (6, 'Hamlet',        'Ronda de lo que el grupo decida.',                 null),
  (7, 'Leonida Keys',  'Ronda de lo que el grupo decida.',                 null),
  (8, 'Little Cuba',   'Ronda de lo que el grupo decida.',                 null)
on conflict (copias) do nothing;

alter table public.hitos enable row level security;
drop policy if exists "hitos: lectura publica" on public.hitos;
create policy "hitos: lectura publica" on public.hitos
  for select to anon, authenticated using (true);
revoke all on public.hitos from anon, authenticated;
grant select on public.hitos to anon, authenticated;

-- 2) Aviso a Discord: un solo mensaje por cada copia asegurada, con su premio
create or replace function public.trg_discord_bolsa()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_total numeric; v_antes numeric; v_n int; v_meta numeric;
  v_copias_antes int; v_copias int; k int; h record;
  v_titulo text; v_premio text; v_desb text; v_todas boolean;
begin
  select coalesce(sum(monto), 0) into v_total from public.aportes;
  v_antes := v_total - new.monto;
  select count(*) into v_n from public.alcancias;
  v_meta := private.cfg('meta_cop')::numeric;
  v_copias_antes := least(v_n, floor(v_antes / v_meta));
  v_copias       := least(v_n, floor(v_total / v_meta));
  if v_copias <= v_copias_antes then return new; end if;

  for k in (v_copias_antes + 1)..v_copias loop
    select * into h from public.hitos where copias = k;
    v_titulo := coalesce(h.titulo, format('Copia %s', k));
    v_premio := coalesce(h.premio, 'El grupo decide el premio.');
    v_desb   := h.desbloquea;
    v_todas  := (k = v_n);

    perform private.discord_post(jsonb_build_object(
      'username', 'Alcancía VI',
      'content', case when v_todas then '@here' else null end,
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', case when v_todas
                      then format('🏁 ¡%s COPIAS! Nadie se queda sin GTA VI', v_n)
                      else format('🎟️ Copia %s de %s asegurada · %s', k, v_n, v_titulo) end,
        'description', format('**Premio:** %s%s%s',
          v_premio,
          case when v_desb is not null then E'\n**Desbloqueado en la web:** ' || v_desb else '' end,
          format(E'\n\nLa bolsa del grupo suma **%s**. %s',
                 private.cop(v_total),
                 case when v_todas then 'Meta comunitaria cumplida. 🌴'
                      else format('Faltan %s para la copia %s.', private.cop((k + 1) * v_meta - v_total), k + 1) end)),
        'url', private.cfg('sitio_url'),
        'color', case when v_todas then 5170850 else 16764749 end
      ))
    ));
  end loop;
  return new;
end $$;

drop trigger if exists discord_bolsa on public.aportes;
create trigger discord_bolsa after insert on public.aportes
  for each row execute function public.trg_discord_bolsa();
