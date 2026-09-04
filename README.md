# Alcancía VI 🐷

Alcancía compartida entre amigos para ahorrar los **$430.000 COP** de Grand Theft Auto VI antes del lanzamiento estimado (1 de febrero de 2027, editable por persona).

- **Sitio:** https://zuk4ritass.github.io/alcancia-gta6/
- **Stack:** HTML + CSS + JS vanilla (GitHub Pages) + Supabase (Postgres + RPC + Realtime).
- Sin build, sin dependencias: se edita y se sube.

## Cómo funciona

1. Cada amigo entra al enlace y toca **Crear mi alcancía** (nombre, emoji, PIN de 4–6 dígitos, fecha meta).
2. Registra sus aportes con fecha y nota. El PIN se pide una vez por dispositivo.
3. La página calcula cuánto le falta, cuántos meses quedan y la **cuota mensual y semanal necesaria** para llegar a tiempo, y si va adelantado o atrasado según el plan.
4. En la portada se ve el ranking del grupo en tiempo real.

## Configurar Supabase (una sola vez)

1. Crea un proyecto gratis en https://supabase.com.
2. En **SQL Editor**, pega y ejecuta `supabase/schema.sql`.
3. En **Settings → API** copia la *Project URL* y la *anon public key*.
4. Pégalas en `js/config.js` y sube el cambio:

```js
SUPABASE_URL: 'https://xxxxx.supabase.co',
SUPABASE_ANON_KEY: 'eyJ...',
```

Mientras esas dos variables estén vacías la página funciona en **modo demo** (los datos viven solo en el navegador de cada persona).

### Seguridad

- La anon key es pública por diseño. Las tablas tienen RLS: cualquiera puede **leer** (ranking), nadie puede escribir directamente.
- Toda escritura pasa por funciones RPC `security definer` que verifican el PIN (bcrypt) de la alcancía.
- El `pin_hash` nunca se expone: el `grant select` es por columnas.

## Discord (avisos automáticos)

Todo corre dentro de Supabase con `pg_net` + `pg_cron`; no hay bots ni servidores.

1. Crea un webhook en el canal de Discord (Editar canal → Integraciones → Webhooks).
2. Ejecuta `supabase/discord.sql` en el SQL Editor.
3. Guarda la URL del webhook:

```sql
insert into private.config (clave, valor) values ('discord_webhook', 'https://discord.com/api/webhooks/...')
on conflict (clave) do update set valor = excluded.valor;
```

Qué publica:

- **Al instante**: cada aporte ("🐊 El Pato metió $50.000 · va en 47%") y cada alcancía nueva. Si alguien llega al 100%, mensaje especial.
- **Viernes 6 pm** (Colombia): recordatorio con quienes no han aportado en la semana.
- **Domingo 7 pm**: ranking semanal con totales del grupo.

Prueba manual: `select public.enviar_recordatorio_discord();`

## PWA

La página es instalable (manifest + service worker). En Android/Chrome aparece el botón **Instalar**; en iPhone: Compartir → Añadir a pantalla de inicio.

## Desarrollo local

```bash
python -m http.server 8090
```

Abre http://localhost:8090.

## Créditos

Arte, logo y tipografía son propiedad de Rockstar Games / Take-Two. Uso interno entre amigos, sin fines comerciales.
