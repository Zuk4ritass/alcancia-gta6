-- ============================================================
--  ALCANCÍA VI · bolsa comunitaria e hitos grupales
--  Requiere discord.sql. Pega todo en SQL Editor → Run.
--
--  Para cambiar los premios luego:
--    update public.hitos set premio = 'Lo que ustedes decidan' where pct = 50;
-- ============================================================

create table if not exists public.hitos (
  pct        int primary key check (pct between 1 and 100),
  titulo     text not null,
  premio     text not null,
  desbloquea text
);
alter table public.hitos enable row level security;
drop policy if exists "hitos: lectura publica" on public.hitos;
create policy "hitos: lectura publica" on public.hitos for select to anon, authenticated using (true);
revoke all on public.hitos from anon, authenticated;
grant select on public.hitos to anon, authenticated;

insert into public.hitos (pct, titulo, premio, desbloquea) values
  (25,  'Vice Beach',    'Noche de pizza. La paga el último del ranking.',          'la bolsa en modo neón'),
  (50,  'Grassrivers',   'Maratón de GTA Online en Discord.',                       'el arte completo del póster en la portada'),
  (75,  'Mount Kalaga',  'El primero del ranking elige el nombre del crew.',        'marco dorado en las cards'),
  (100, 'Leonida Keys',  'Día 1 todos juntos. Nadie se queda sin copia.',           'lluvia de confeti y título de crew')
on conflict (pct) do nothing;

-- Aviso a Discord cuando el grupo asegura una copia más o cruza un hito
create or replace function public.trg_discord_bolsa()
returns trigger language plpgsql security definer set search_path = public, private as $$
declare
  v_total numeric; v_antes numeric; v_n int; v_meta numeric; v_meta_grupo numeric;
  v_pct_antes int; v_pct int; v_copias_antes int; v_copias int; h record;
begin
  select coalesce(sum(monto), 0) into v_total from public.aportes;
  v_antes := v_total - new.monto;
  select count(*) into v_n from public.alcancias;
  v_meta := private.cfg('meta_cop')::numeric;
  v_meta_grupo := v_meta * greatest(1, v_n);
  v_pct_antes := floor(v_antes / v_meta_grupo * 100);
  v_pct       := floor(v_total / v_meta_grupo * 100);
  v_copias_antes := floor(v_antes / v_meta);
  v_copias       := floor(v_total / v_meta);

  if v_copias > v_copias_antes then
    perform private.discord_post(jsonb_build_object('username', 'Alcancía VI', 'embeds', jsonb_build_array(jsonb_build_object(
      'title', format('🎟️ ¡Otra copia asegurada! Van %s de %s', v_copias, v_n),
      'description', format('La bolsa del grupo ya suma **%s**. Cada %s que juntamos entre todos es un GTA VI más en la mesa.', private.cop(v_total), private.cop(v_meta)),
      'url', private.cfg('sitio_url'), 'color', 16764749))));
  end if;

  for h in select * from public.hitos where pct > v_pct_antes and pct <= v_pct order by pct loop
    perform private.discord_post(jsonb_build_object('username', 'Alcancía VI',
      'content', case when h.pct = 100 then '@here' else null end,
      'embeds', jsonb_build_array(jsonb_build_object(
        'title', format('🏁 Hito grupal: %s (%s%% de la bolsa)', h.titulo, h.pct),
        'description', format('**Premio:** %s%s%s', h.premio,
                              case when h.desbloquea is not null then E'\n**Desbloqueado en la web:** ' || h.desbloquea else '' end,
                              format(E'\n\nBolsa: **%s** de %s entre %s.', private.cop(v_total), private.cop(v_meta_grupo), v_n)),
        'url', private.cfg('sitio_url'), 'color', 5170850))));
  end loop;
  return new;
end $$;

drop trigger if exists discord_bolsa on public.aportes;
create trigger discord_bolsa after insert on public.aportes
  for each row execute function public.trg_discord_bolsa();
