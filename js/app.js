/* ============================================================
   ALCANCÍA VI · app.js
   SPA sin dependencias (hash routing) + Supabase o modo demo.
   ============================================================ */
(() => {
  'use strict';

  const CFG = window.ALCANCIA_CONFIG || {};
  const META = Number(CFG.META_COP) || 430000;
  const FECHA_DEFAULT = CFG.FECHA_META_DEFAULT || '2027-02-01';
  const EMOJIS = ['🐷', '💰', '🌴', '🦩', '🐊', '🚗', '🏍️', '🚁', '🛥️', '🕶️', '💎', '🔫', '🌅', '🏝️', '🎮', '🔥'];

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const app = $('#app');

  // ---------- Utilidades ----------
  const fmtCOP = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(n || 0));
  const fmtNum = (n) => new Intl.NumberFormat('es-CO').format(Math.round(n || 0));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hoyISO = () => isoLocal(new Date());
  const parseISO = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const fmtFecha = (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => parseISO(iso).toLocaleDateString('es-CO', opts);
  const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const redondear = (n) => Math.ceil(n / 100) * 100;
  const slugify = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'alcancia';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
  const plural = (n, s, p) => (n === 1 ? s : p);

  function tiempoRelativo(iso) {
    const ms = Date.now() - new Date(iso).getTime();
    const m = Math.floor(ms / 6e4), h = Math.floor(ms / 36e5), d = Math.floor(ms / 864e5);
    if (m < 1) return 'ahora mismo';
    if (m < 60) return `hace ${m} min`;
    if (h < 24) return `hace ${h} h`;
    if (d === 1) return 'ayer';
    if (d < 7) return `hace ${d} días`;
    return fmtFecha(iso.slice(0, 10), { day: 'numeric', month: 'short' });
  }

  function calcular(total, fechaMeta, creadoEn) {
    const ahora = new Date();
    const meta = parseISO(fechaMeta);
    const ms = meta - ahora;
    const dias = Math.max(0, Math.ceil(ms / 864e5));
    const meses = Math.max(1, Math.ceil(dias / 30.4375));
    const semanas = Math.max(1, Math.ceil(dias / 7));
    const falta = Math.max(0, META - total);
    const pct = Math.min(100, (total / META) * 100);
    const inicio = creadoEn ? new Date(creadoEn) : ahora;
    const durTotal = Math.max(1, meta - inicio);
    const transcurrido = Math.min(durTotal, Math.max(0, ahora - inicio));
    const esperado = Math.round(META * (transcurrido / durTotal));
    return {
      dias, meses, semanas, falta, pct,
      cuotaMes: redondear(falta / meses),
      cuotaSem: redondear(falta / semanas),
      esperado, diff: total - esperado,
      completo: falta === 0, vencido: ms < 0,
    };
  }

  // ---------- Gamificación: rachas y medallas ----------
  // Índice de semana (lunes a domingo) para una fecha ISO.
  function semanaIdx(iso) {
    const t = parseISO(iso);
    const lunes = new Date(t); lunes.setDate(t.getDate() - ((t.getDay() + 6) % 7)); lunes.setHours(12, 0, 0, 0);
    return Math.floor(lunes.getTime() / (7 * 864e5));
  }
  function calcularRacha(fechas) {
    if (!fechas || !fechas.length) return { racha: 0, estaSemana: false };
    const set = new Set(fechas.map(semanaIdx));
    const actual = semanaIdx(hoyISO());
    const estaSemana = set.has(actual);
    let w = estaSemana ? actual : actual - 1, racha = 0;
    while (set.has(w)) { racha++; w--; }
    return { racha, estaSemana };
  }
  const MEDALLAS = [
    { id: 'primer', e: '🎬', n: 'Primer paso', d: 'Tu primer aporte registrado', ok: (x) => x.n >= 1 },
    { id: 'p25', e: '🌴', n: 'Un cuarto', d: '25% de la meta', ok: (x) => x.pct >= 25 },
    { id: 'p50', e: '🌅', n: 'Mitad del camino', d: '50% de la meta', ok: (x) => x.pct >= 50 },
    { id: 'p75', e: '🦩', n: 'Ya se ve Leonida', d: '75% de la meta', ok: (x) => x.pct >= 75 },
    { id: 'meta', e: '🏆', n: 'Listo para Leonida', d: 'Meta cumplida', ok: (x) => x.completo },
    { id: 'racha3', e: '🔥', n: 'Racha x3', d: '3 semanas seguidas aportando', ok: (x) => x.racha >= 3 },
    { id: 'racha8', e: '⚡', n: 'Imparable', d: '8 semanas seguidas aportando', ok: (x) => x.racha >= 8 },
    { id: 'const', e: '📆', n: 'Constante', d: '5 aportes o más', ok: (x) => x.n >= 5 },
    { id: 'coco', e: '🐊', n: 'Cocodrilo', d: 'Un aporte de $100.000 o más', ok: (x) => x.max >= 100000 },
    { id: 'deuna', e: '💎', n: 'De una', d: 'Toda la meta en un solo aporte', ok: (x) => x.max >= META },
    { id: 'adel', e: '🚀', n: 'Adelantado', d: 'Más de una cuota por delante del plan', ok: (x) => !x.completo && x.cuotaMes > 0 && x.diff >= x.cuotaMes },
  ];
  const medallasCtx = (ctx) => MEDALLAS.map((m) => ({ ...m, ganada: !!m.ok(ctx) }));
  function medallasDe(aportes, c) {
    const { racha } = calcularRacha(aportes.map((x) => x.fecha));
    return medallasCtx({ n: aportes.length, pct: c.pct, completo: c.completo, racha, max: aportes.reduce((m, x) => Math.max(m, x.monto), 0), diff: c.diff, cuotaMes: c.cuotaMes });
  }

  // ---------- Toast (con acción opcional) ----------
  function toast(msg, tipo = '', accion = null) {
    const el = $('#toast');
    el.className = `toast show ${tipo ? 'toast--' + tipo : ''}`;
    el.innerHTML = `<div>${esc(msg)}${accion ? ` <button type="button" class="toast__btn">${esc(accion.texto)}</button>` : ''}</div>`;
    if (accion) $('.toast__btn', el).addEventListener('click', () => { el.classList.remove('show'); accion.fn(); });
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), accion ? 6000 : 3200);
  }

  // ---------- PIN guardado por dispositivo ----------
  const pinKey = (id) => `alcancia_vi_pin_${id}`;
  const getPin = (id) => { try { return localStorage.getItem(pinKey(id)); } catch { return null; } };
  const setPin = (id, pin) => { try { localStorage.setItem(pinKey(id), pin); } catch { /* sin storage */ } };
  const clearPin = (id) => { try { localStorage.removeItem(pinKey(id)); } catch { /* nada */ } };
  const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* nada */ } };

  // Agrupa aportes por alcancía → { total, fechas, n, max }
  function resumirAportes(aportes) {
    const r = {};
    for (const a of aportes) {
      const x = r[a.alcancia_id] || (r[a.alcancia_id] = { total: 0, fechas: [], n: 0, max: 0 });
      x.total += a.monto; x.n++; x.max = Math.max(x.max, a.monto); if (a.fecha) x.fechas.push(a.fecha);
    }
    return r;
  }

  // ============================================================
  //  STORE · Supabase
  // ============================================================
  function crearStoreSupabase(url, key) {
    const sb = window.supabase.createClient(url, key, { realtime: { params: { eventsPerSecond: 5 } } });
    const COLS = 'id,slug,nombre,emoji,fecha_meta,creado_en';
    const chk = (r) => { if (r.error) throw new Error(r.error.message || 'Error de Supabase'); return r.data; };
    return {
      modo: 'supabase',
      async listar() {
        const [al, ap] = await Promise.all([
          sb.from('alcancias').select(COLS).order('creado_en', { ascending: true }),
          sb.from('aportes').select('alcancia_id,monto,fecha'),
        ]);
        const alcs = chk(al), res = resumirAportes(chk(ap));
        return alcs.map((a) => ({ ...a, ...(res[a.id] || { total: 0, fechas: [], n: 0, max: 0 }) }));
      },
      async obtener(slug) {
        const a = chk(await sb.from('alcancias').select(COLS).eq('slug', slug).maybeSingle());
        if (!a) return null;
        const aportes = chk(await sb.from('aportes').select('id,monto,fecha,nota,creado_en')
          .eq('alcancia_id', a.id).order('fecha', { ascending: false }).order('creado_en', { ascending: false }));
        return { ...a, aportes, total: aportes.reduce((s, x) => s + x.monto, 0) };
      },
      async actividad(limite = 8) {
        const rows = chk(await sb.from('aportes').select('id,alcancia_id,monto,fecha,nota,creado_en,alcancias(nombre,emoji,slug)')
          .order('creado_en', { ascending: false }).limit(limite));
        return rows.filter((r) => r.alcancias).map((r) => ({ ...r, nombre: r.alcancias.nombre, emoji: r.alcancias.emoji, slug: r.alcancias.slug }));
      },
      async crear({ nombre, emoji, pin, fecha_meta }) {
        return chk(await sb.rpc('crear_alcancia', { p_nombre: nombre, p_emoji: emoji, p_pin: pin, p_fecha_meta: fecha_meta }));
      },
      async verificarPin(id, pin) { return chk(await sb.rpc('verificar_pin', { p_id: id, p_pin: pin })) === true; },
      async agregarAporte({ alcancia_id, pin, monto, fecha, nota }) {
        return chk(await sb.rpc('agregar_aporte', { p_alcancia: alcancia_id, p_pin: pin, p_monto: monto, p_fecha: fecha, p_nota: nota || null }));
      },
      async eliminarAporte(aporte_id, pin) { chk(await sb.rpc('eliminar_aporte', { p_aporte: aporte_id, p_pin: pin })); },
      async actualizar({ id, pin, nombre, emoji, fecha_meta }) {
        chk(await sb.rpc('actualizar_alcancia', { p_id: id, p_pin: pin, p_nombre: nombre ?? null, p_emoji: emoji ?? null, p_fecha_meta: fecha_meta ?? null }));
      },
      async eliminarAlcancia(id, pin) { chk(await sb.rpc('eliminar_alcancia', { p_id: id, p_pin: pin })); },
      suscribir(cb) {
        const ch = sb.channel('alcancia-vi-' + Math.random().toString(36).slice(2))
          .on('postgres_changes', { event: '*', schema: 'public', table: 'aportes' }, cb)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'alcancias' }, cb)
          .subscribe();
        return () => sb.removeChannel(ch);
      },
    };
  }

  // ============================================================
  //  STORE · Demo (localStorage). Mismo contrato que Supabase.
  // ============================================================
  function crearStoreLocal() {
    const KEY = 'alcancia_vi_demo_v1';
    const leer = () => { try { return JSON.parse(localStorage.getItem(KEY)) || { alcancias: [], aportes: [] }; } catch { return { alcancias: [], aportes: [] }; } };
    const guardar = (db) => { localStorage.setItem(KEY, JSON.stringify(db)); window.dispatchEvent(new Event('alcancia:cambio')); };
    const checkPin = (db, id, pin) => {
      const a = db.alcancias.find((x) => x.id === id);
      if (!a) throw new Error('La alcancía no existe');
      if (a.pin !== String(pin)) throw new Error('PIN incorrecto');
      return a;
    };
    const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
    const pub = ({ pin, ...a }) => a;
    return {
      modo: 'demo',
      async listar() {
        await wait();
        const db = leer(), res = resumirAportes(db.aportes);
        return db.alcancias.map((a) => ({ ...pub(a), ...(res[a.id] || { total: 0, fechas: [], n: 0, max: 0 }) }));
      },
      async obtener(slug) {
        await wait();
        const db = leer();
        const a = db.alcancias.find((x) => x.slug === slug);
        if (!a) return null;
        const aportes = db.aportes.filter((x) => x.alcancia_id === a.id).sort((p, q) => (q.fecha + q.creado_en).localeCompare(p.fecha + p.creado_en));
        return { ...pub(a), aportes, total: aportes.reduce((s, x) => s + x.monto, 0) };
      },
      async actividad(limite = 8) {
        await wait();
        const db = leer();
        return db.aportes.slice().sort((p, q) => q.creado_en.localeCompare(p.creado_en)).slice(0, limite).map((ap) => {
          const a = db.alcancias.find((x) => x.id === ap.alcancia_id) || {};
          return { ...ap, nombre: a.nombre, emoji: a.emoji, slug: a.slug };
        }).filter((x) => x.nombre);
      },
      async crear({ nombre, emoji, pin, fecha_meta }) {
        await wait();
        if (!/^\d{4,6}$/.test(pin)) throw new Error('El PIN debe tener entre 4 y 6 dígitos');
        if (parseISO(fecha_meta) <= new Date()) throw new Error('La fecha meta debe ser futura');
        const db = leer();
        const base = slugify(nombre); let slug = base;
        while (db.alcancias.some((x) => x.slug === slug)) slug = `${base}-${Math.random().toString(36).slice(2, 6)}`;
        const a = { id: uid(), slug, nombre: nombre.trim(), emoji: emoji || '🐷', pin: String(pin), fecha_meta, creado_en: new Date().toISOString() };
        db.alcancias.push(a); guardar(db);
        return { id: a.id, slug };
      },
      async verificarPin(id, pin) { await wait(); try { checkPin(leer(), id, pin); return true; } catch { return false; } },
      async agregarAporte({ alcancia_id, pin, monto, fecha, nota }) {
        await wait();
        const db = leer(); checkPin(db, alcancia_id, pin);
        if (!(monto > 0)) throw new Error('El monto debe ser mayor a cero');
        const ap = { id: uid(), alcancia_id, monto, fecha: fecha || hoyISO(), nota: (nota || '').trim() || null, creado_en: new Date().toISOString() };
        db.aportes.push(ap); guardar(db);
        return { id: ap.id };
      },
      async eliminarAporte(aporte_id, pin) {
        await wait();
        const db = leer(); const ap = db.aportes.find((x) => x.id === aporte_id);
        if (!ap) throw new Error('El aporte no existe');
        checkPin(db, ap.alcancia_id, pin);
        db.aportes = db.aportes.filter((x) => x.id !== aporte_id); guardar(db);
      },
      async actualizar({ id, pin, nombre, emoji, fecha_meta }) {
        await wait();
        const db = leer(); const a = checkPin(db, id, pin);
        if (fecha_meta && parseISO(fecha_meta) <= new Date()) throw new Error('La fecha meta debe ser futura');
        if (nombre && nombre.trim()) a.nombre = nombre.trim();
        if (emoji) a.emoji = emoji;
        if (fecha_meta) a.fecha_meta = fecha_meta;
        guardar(db);
      },
      async eliminarAlcancia(id, pin) {
        await wait();
        const db = leer(); checkPin(db, id, pin);
        db.alcancias = db.alcancias.filter((x) => x.id !== id);
        db.aportes = db.aportes.filter((x) => x.alcancia_id !== id); guardar(db);
      },
      suscribir(cb) {
        const h = () => cb();
        window.addEventListener('alcancia:cambio', h);
        window.addEventListener('storage', h);
        return () => { window.removeEventListener('alcancia:cambio', h); window.removeEventListener('storage', h); };
      },
    };
  }

  // ?demo=1 en la URL fuerza el modo demo (útil para probar sin tocar datos reales)
  const forzarDemo = /(\?|&)demo=1/.test(location.search);
  const store = (!forzarDemo && CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)
    ? crearStoreSupabase(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY)
    : crearStoreLocal();

  // ============================================================
  //  Modal genérico
  // ============================================================
  function abrirModal(html, { onClose } = {}) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-bg" role="dialog" aria-modal="true"><div class="modal">${html}<button class="modal__close" type="button" aria-label="Cerrar">✕</button></div></div>`;
    const bg = $('.modal-bg', root);
    const cerrar = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); onClose && onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
    document.addEventListener('keydown', onKey);
    $('.modal__close', bg).addEventListener('click', cerrar);
    bg.addEventListener('click', (e) => { if (e.target === bg) cerrar(); });
    setTimeout(() => { const f = $('input, button.emoji', bg); f && f.focus(); }, 30);
    return { el: bg, cerrar };
  }

  function pedirPin({ titulo = 'Ingresa tu PIN', texto = 'Es el PIN que creaste con tu alcancía. Solo se pide una vez por dispositivo.' } = {}) {
    return new Promise((resolve) => {
      let resuelto = false;
      const m = abrirModal(`
        <h2>${esc(titulo)}</h2>
        <p class="lead">${esc(texto)}</p>
        <form class="form" id="f-pin" autocomplete="off">
          <div class="field">
            <label for="pin">PIN</label>
            <input class="input input--pin" id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="••••" required autocomplete="one-time-code">
          </div>
          <div class="error" id="pin-err" hidden></div>
          <div class="form__actions"><button class="btn btn--primary" type="submit">Continuar</button></div>
        </form>`, { onClose: () => { if (!resuelto) { resuelto = true; resolve(null); } } });
      $('#f-pin', m.el).addEventListener('submit', (e) => {
        e.preventDefault();
        const v = $('#pin', m.el).value.trim();
        if (!/^\d{4,6}$/.test(v)) { const er = $('#pin-err', m.el); er.hidden = false; er.textContent = 'El PIN debe tener entre 4 y 6 dígitos.'; return; }
        resuelto = true; m.cerrar(); resolve(v);
      });
    });
  }

  // Ejecuta `accion(pin)` con el PIN guardado o pidiéndolo. Reintenta si es incorrecto.
  async function conPin(alcanciaId, accion, opts) {
    let pin = getPin(alcanciaId);
    let pedido = false;
    for (let intento = 0; intento < 3; intento++) {
      if (!pin) { pin = await pedirPin(opts); pedido = true; if (!pin) return { cancelado: true }; }
      try {
        const r = await accion(pin);
        if (pedido) setPin(alcanciaId, pin);
        return { ok: true, r };
      } catch (err) {
        if (/pin incorrecto/i.test(err.message || '')) { clearPin(alcanciaId); pin = null; toast('PIN incorrecto, intenta de nuevo', 'bad'); continue; }
        throw err;
      }
    }
    return { cancelado: true };
  }

  // Aporte de un toque (con deshacer). Devuelve true si se guardó.
  async function aporteRapido(a, monto, despues) {
    try {
      const res = await conPin(a.id, (pin) => store.agregarAporte({ alcancia_id: a.id, pin, monto, fecha: hoyISO(), nota: 'Aporte rápido' }));
      if (res.cancelado) return false;
      const nuevoTotal = (a.total || 0) + monto;
      const c = calcular(nuevoTotal, a.fecha_meta, a.creado_en);
      toast(c.completo ? '🎉 ¡Meta cumplida! Nos vemos en Leonida.' : `+${fmtCOP(monto)} guardados · te faltan ${fmtCOP(c.falta)}`, 'ok', {
        texto: 'Deshacer',
        fn: async () => {
          try { await conPin(a.id, (pin) => store.eliminarAporte(res.r.id, pin)); toast('Aporte deshecho'); despues && despues(); }
          catch (e) { toast(e.message || 'No se pudo deshacer', 'bad'); }
        },
      });
      despues && despues();
      return true;
    } catch (e) { toast(e.message || 'No se pudo guardar', 'bad'); return false; }
  }

  // ============================================================
  //  PWA: instalación
  // ============================================================
  let promptInstalar = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); promptInstalar = e; $$('.js-instalar').forEach((b) => { b.hidden = false; }); });
  window.addEventListener('appinstalled', () => { promptInstalar = null; $$('.js-instalar').forEach((b) => { b.hidden = true; }); toast('App instalada 🎉', 'ok'); });
  const esStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  async function instalar() {
    if (promptInstalar) { promptInstalar.prompt(); const { outcome } = await promptInstalar.userChoice; if (outcome === 'accepted') promptInstalar = null; return; }
    abrirModal(`
      <h2>Instalar la app</h2>
      <p class="lead">Así te queda el ícono del VI en la pantalla de inicio y abres tu alcancía en un toque.</p>
      ${esIOS()
        ? '<ol class="pasos"><li>Toca el botón <b>Compartir</b> (el cuadrado con la flecha) en Safari.</li><li>Elige <b>Añadir a pantalla de inicio</b>.</li><li>Confirma con <b>Añadir</b>.</li></ol>'
        : '<ol class="pasos"><li>Abre el menú del navegador (⋮ o ⋯).</li><li>Elige <b>Instalar app</b> o <b>Añadir a pantalla de inicio</b>.</li></ol>'}
    `);
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }

  // ============================================================
  //  Router
  // ============================================================
  let limpiarVista = () => {};
  const ruta = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const ir = (h) => { location.hash = h; };

  async function render() {
    limpiarVista(); limpiarVista = () => {};
    $('#modal-root').innerHTML = '';
    window.scrollTo({ top: 0 });
    const p = ruta();
    try {
      if (p[0] === 'nueva') return await vistaNueva();
      if (p[0] === 'a' && p[1]) return await vistaDetalle(p[1]);
      return await vistaHome();
    } catch (err) {
      console.error(err);
      app.innerHTML = `<div class="page"><main class="wrap"><div class="empty" style="margin-top:80px"><h3>Algo salió mal</h3><p>${esc(err.message || err)}</p><p style="margin-top:16px"><a class="btn btn--ghost" href="#/">Volver al inicio</a></p></div></main></div>`;
    }
  }
  window.addEventListener('hashchange', render);

  // ============================================================
  //  Piezas compartidas
  // ============================================================
  const bannerDemo = () => store.modo === 'demo' ? `
    <div class="banner" role="note">
      <span aria-hidden="true">⚠️</span>
      <div><b>Modo demo:</b> las alcancías se guardan solo en este navegador. Para que todo el grupo vea el ranking, configura Supabase en <code>js/config.js</code>.</div>
    </div>` : '';

  const footer = () => `
    <footer class="footer">
      <img src="assets/logo_gta.png" alt="">
      <p>Alcancía VI · proyecto entre amigos, sin fines comerciales. Arte y marcas de <a href="https://www.rockstargames.com/VI" target="_blank" rel="noopener">Rockstar Games</a>.</p>
      <p style="margin-top:6px">Meta: <b>${fmtCOP(META)}</b> · fecha estimada por defecto: ${fmtFecha(FECHA_DEFAULT)}</p>
      ${esStandalone() ? '' : '<p style="margin-top:10px"><button class="btn btn--ghost btn--sm js-instalar-siempre" type="button">📲 Instalar como app</button></p>'}
    </footer>`;

  function iniciarCountdown(el, fechaISO) {
    const meta = parseISO(fechaISO);
    const tick = () => {
      let ms = Math.max(0, meta - new Date());
      const d = Math.floor(ms / 864e5); ms -= d * 864e5;
      const h = Math.floor(ms / 36e5); ms -= h * 36e5;
      const m = Math.floor(ms / 6e4); ms -= m * 6e4;
      const s = Math.floor(ms / 1e3);
      const vals = [d, pad2(h), pad2(m), pad2(s)];
      $$('b', el).forEach((b, i) => { if (b.textContent !== String(vals[i])) b.textContent = vals[i]; });
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }
  const countdownHTML = () => `
    <div class="countdown" id="countdown" aria-label="Cuenta regresiva al lanzamiento">
      <div class="cd"><b>0</b><small>días</small></div>
      <div class="cd"><b>00</b><small>horas</small></div>
      <div class="cd"><b>00</b><small>min</small></div>
      <div class="cd"><b>00</b><small>seg</small></div>
    </div>`;

  function cardAlcancia(a, i) {
    const c = calcular(a.total, a.fecha_meta, a.creado_en);
    const r = calcularRacha(a.fechas);
    const nMedallas = medallasCtx({ n: a.n, pct: c.pct, completo: c.completo, racha: r.racha, max: a.max || 0, diff: c.diff, cuotaMes: c.cuotaMes }).filter((m) => m.ganada).length;
    return `
      <a class="card ${c.completo ? 'card--done' : ''}" href="#/a/${encodeURIComponent(a.slug)}">
        <div class="card__top">
          <span class="avatar" aria-hidden="true">${esc(a.emoji)}</span>
          <div><h3>${esc(a.nombre)}</h3><small>${r.racha ? `🔥 ${r.racha} ${plural(r.racha, 'semana', 'semanas')} seguidas` : (a.n ? `${a.n} ${plural(a.n, 'aporte', 'aportes')}` : 'Sin aportes aún')}${nMedallas ? ` · 🏅 ${nMedallas}` : ''}</small></div>
          <span class="rank rank--${i + 1}">#${i + 1}</span>
        </div>
        <div class="bar ${c.completo ? 'bar--done' : ''}"><i style="width:${c.pct.toFixed(1)}%"></i></div>
        <div class="card__stats"><span><b>${fmtCOP(a.total)}</b></span><span><b>${Math.floor(c.pct)}%</b></span></div>
        <div class="card__foot">
          ${c.completo ? '<span>🎉 <b>¡Meta cumplida!</b> Listo para Leonida.</span>'
            : `<span>Falta <b>${fmtCOP(c.falta)}</b></span><span><b>${fmtCOP(c.cuotaMes)}</b>/mes</span>`}
        </div>
      </a>`;
  }

  // Panel "Tu alcancía" con aporte de un toque
  function panelMia(a) {
    const c = calcular(a.total, a.fecha_meta, a.creado_en);
    const r = calcularRacha(a.fechas);
    const montos = [...new Set([10000, 20000, 50000, c.cuotaSem].filter((n) => n > 0 && n <= c.falta + 100000))].sort((x, y) => x - y).slice(0, 4);
    const estado = c.completo ? '🏆 Meta cumplida. Ya está.'
      : r.estaSemana ? `✅ Ya aportaste esta semana${r.racha > 1 ? ` · racha de ${r.racha} semanas 🔥` : ''}`
        : r.racha > 0 ? `⏳ Aún no has aportado esta semana. Racha en juego: ${r.racha} 🔥`
          : '⏳ Esta semana todavía no has metido nada.';
    return `
      <section class="mia panel" data-id="${a.id}" aria-label="Tu alcancía">
        <div class="mia__head">
          <a class="mia__quien" href="#/a/${encodeURIComponent(a.slug)}">
            <span class="avatar" aria-hidden="true">${esc(a.emoji)}</span>
            <div><small>Tu alcancía</small><h3>${esc(a.nombre)}</h3></div>
          </a>
          <div class="mia__num"><b>${fmtCOP(a.total)}</b><small>${Math.floor(c.pct)}% · faltan ${fmtCOP(c.falta)}</small></div>
        </div>
        <div class="bar ${c.completo ? 'bar--done' : ''}"><i style="width:${c.pct.toFixed(1)}%"></i></div>
        <p class="mia__estado">${estado}</p>
        ${c.completo ? '' : `
        <div class="mia__rapido">
          <span class="mia__label">Aporte rápido de hoy</span>
          <div class="chips">
            ${montos.map((n) => `<button class="chip chip--go" type="button" data-monto="${n}">+ ${fmtCOP(n)}</button>`).join('')}
            <a class="chip chip--otro" href="#/a/${encodeURIComponent(a.slug)}?aporte=1">Otro monto…</a>
          </div>
        </div>`}
      </section>`;
  }

  function feedHTML(items) {
    if (!items.length) return '';
    return `
      <section class="feed" aria-labelledby="t-feed">
        <div class="sec-head"><div><h2 id="t-feed">Actividad</h2><p class="sub">Lo último que ha pasado en el grupo.</p></div></div>
        <ul class="feed__lista">
          ${items.map((x) => `
            <li class="feed__item">
              <a href="#/a/${encodeURIComponent(x.slug)}" class="feed__quien"><span class="avatar avatar--sm">${esc(x.emoji)}</span></a>
              <div class="feed__txt"><b>${esc(x.nombre)}</b> metió <b class="feed__monto">${fmtCOP(x.monto)}</b>${x.nota && x.nota !== 'Aporte rápido' ? ` <span class="feed__nota">“${esc(x.nota)}”</span>` : ''}</div>
              <time class="feed__cuando" datetime="${esc(x.creado_en)}">${tiempoRelativo(x.creado_en)}</time>
            </li>`).join('')}
        </ul>
      </section>`;
  }

  // ============================================================
  //  Vista · Home
  // ============================================================
  async function vistaHome() {
    const ref = calcular(0, FECHA_DEFAULT);
    app.innerHTML = `
      <header class="hero">
        <picture class="hero__bg">
          <source media="(max-width: 720px)" srcset="assets/featured_mobile.jpg">
          <img src="assets/featured.jpg" alt="" fetchpriority="high">
        </picture>
        <div class="hero__shade"></div>
        <nav class="topbar">
          <a class="brand" href="#/"><img src="assets/logo_gta.png" alt="Grand Theft Auto"></a>
          <div style="display:flex;gap:8px">
            <button class="btn btn--ghost btn--sm js-instalar" type="button" hidden>📲 Instalar</button>
            <a class="btn btn--ghost btn--sm" href="#/nueva">Crear alcancía</a>
          </div>
        </nav>
        <div class="hero__content">
          <img class="hero__logo" src="assets/logo_vi.png" alt="Grand Theft Auto VI">
          <p class="hero__kicker">Ahorro colectivo · Leonida 2027</p>
          <h1 class="hero__title">La alcancía <em>VI</em></h1>
          <p class="hero__sub">Junta <b>${fmtCOP(META)}</b> antes del lanzamiento. Crea tu alcancía, anota cada aporte y mira si vas al ritmo del grupo.</p>
          ${countdownHTML()}
          <p class="hero__meta">Fecha estimada PC: <b>${fmtFecha(FECHA_DEFAULT)}</b> · quedan <b>${ref.meses} meses</b> · desde cero necesitas <b>${fmtCOP(ref.cuotaMes)}/mes</b></p>
          <div class="hero__cta" id="hero-cta">
            <a class="btn btn--primary" href="#/nueva">Crear mi alcancía</a>
            <a class="btn btn--ghost" href="#lista" id="ver-grupo">Ver el grupo</a>
          </div>
        </div>
      </header>
      <main class="wrap">
        ${bannerDemo()}
        <div id="mias"></div>
        <section id="lista" aria-labelledby="t-grupo">
          <div class="sec-head">
            <div><h2 id="t-grupo">El grupo</h2><p class="sub">Ordenado por quién va más cerca de la meta.</p></div>
            <span class="pill ${store.modo === 'supabase' ? 'pill--live' : ''}" id="resumen">Cargando…</span>
          </div>
          <div class="grid" id="grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
        </section>
        <div id="feed"></div>
      </main>
      ${footer()}`;

    $('#ver-grupo').addEventListener('click', (e) => { e.preventDefault(); $('#lista').scrollIntoView({ behavior: 'smooth' }); });
    const stopCd = iniciarCountdown($('#countdown'), FECHA_DEFAULT);
    bindInstalar();

    let lista = [];
    const cargar = async () => {
      try {
        const [l, act] = await Promise.all([store.listar(), store.actividad(8).catch(() => [])]);
        lista = l.sort((a, b) => (b.total / META) - (a.total / META) || a.creado_en.localeCompare(b.creado_en));
        const grid = $('#grid'); if (!grid) return;
        const totalGrupo = lista.reduce((s, a) => s + a.total, 0);
        $('#resumen').innerHTML = lista.length
          ? `<b>${lista.length}</b> ${plural(lista.length, 'alcancía', 'alcancías')} · <b>${fmtCOP(totalGrupo)}</b> ahorrados`
          : 'Aún no hay alcancías';
        grid.innerHTML = lista.length
          ? lista.map(cardAlcancia).join('')
          : `<div class="empty" style="grid-column:1/-1"><h3>Nadie ha empezado a ahorrar</h3><p>Sé el primero del grupo. Toma 20 segundos.</p><p style="margin-top:16px"><a class="btn btn--primary" href="#/nueva">Crear mi alcancía</a></p></div>`;

        // Mis alcancías (las que tienen PIN guardado en este dispositivo)
        const mias = lista.filter((a) => getPin(a.id));
        $('#mias').innerHTML = mias.map(panelMia).join('');
        $$('.mia .chip--go').forEach((ch) => ch.addEventListener('click', async () => {
          const a = mias.find((x) => x.id === ch.closest('.mia').dataset.id);
          if (!a) return;
          ch.disabled = true; ch.textContent = 'Guardando…';
          const ok = await aporteRapido(a, Number(ch.dataset.monto), cargar);
          if (!ok) { ch.disabled = false; ch.textContent = `+ ${fmtCOP(Number(ch.dataset.monto))}`; }
        }));
        if (mias.length) { const cta = $('#hero-cta a.btn--primary'); if (cta) { cta.textContent = 'Ir a mi alcancía'; cta.href = `#/a/${encodeURIComponent(mias[0].slug)}`; } }

        $('#feed').innerHTML = feedHTML(act);
      } catch (err) {
        console.error(err);
        $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>No se pudo cargar el grupo</h3><p>${esc(err.message || err)}</p></div>`;
        $('#resumen').textContent = 'Sin conexión';
      }
    };
    await cargar();
    const unsub = store.suscribir(() => cargar());
    const onVis = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', onVis);
    limpiarVista = () => { stopCd(); unsub(); document.removeEventListener('visibilitychange', onVis); };
  }

  function bindInstalar() {
    $$('.js-instalar').forEach((b) => { b.hidden = !promptInstalar; b.addEventListener('click', instalar); });
    $$('.js-instalar-siempre').forEach((b) => b.addEventListener('click', instalar));
  }

  // ============================================================
  //  Vista · Nueva alcancía
  // ============================================================
  async function vistaNueva() {
    const minFecha = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoLocal(d); })();
    app.innerHTML = `
      <div class="page">
        <div class="page__bg"><img src="assets/skybox.jpg" alt=""></div>
        <nav class="topbar" style="position:relative">
          <a class="back" href="#/">← Volver</a>
          <a class="brand" href="#/"><img src="assets/logo_gta.png" alt="Grand Theft Auto" style="height:32px"></a>
        </nav>
        <main class="wrap">
          <div class="form-page">
            <h1>Tu alcancía</h1>
            <p class="lead">Ponle nombre, elige un ícono y crea un PIN para que solo tú puedas registrar aportes. Los demás podrán ver tu progreso.</p>
            <form class="form panel" id="f-nueva" autocomplete="off" novalidate>
              <div class="field">
                <label for="nombre">Tu nombre o apodo</label>
                <input class="input" id="nombre" name="nombre" maxlength="30" minlength="2" placeholder="Ej. Manu, El Pato, Lucía…" required autocomplete="nickname">
              </div>
              <div class="field">
                <label>Ícono</label>
                <div class="emojis" role="radiogroup" aria-label="Ícono">
                  ${EMOJIS.map((e, i) => `<button class="emoji" type="button" role="radio" aria-pressed="${i === 0}" aria-checked="${i === 0}" data-emoji="${e}">${e}</button>`).join('')}
                </div>
              </div>
              <div class="field">
                <label for="fecha">Fecha meta (lanzamiento estimado)</label>
                <input class="input" id="fecha" name="fecha" type="date" value="${FECHA_DEFAULT}" min="${minFecha}" required>
                <span class="hint">No hay fecha oficial para PC; asumimos ${fmtFecha(FECHA_DEFAULT)}. Puedes cambiarla luego.</span>
              </div>
              <div class="field">
                <label for="pin1">PIN (4 a 6 dígitos)</label>
                <input class="input input--pin" id="pin1" name="pin1" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="••••" required autocomplete="new-password">
                <span class="hint">Se pide una vez por dispositivo. No uses la clave de tu banco 🙃</span>
              </div>
              <div class="field">
                <label for="pin2">Repite el PIN</label>
                <input class="input input--pin" id="pin2" name="pin2" type="password" inputmode="numeric" pattern="[0-9]{4,6}" maxlength="6" placeholder="••••" required autocomplete="new-password">
              </div>
              <div class="error" id="err" hidden></div>
              <div class="form__actions">
                <a class="btn btn--ghost" href="#/">Cancelar</a>
                <button class="btn btn--primary" type="submit" id="btn-crear">Crear alcancía</button>
              </div>
            </form>
            <div style="margin-top:16px">${bannerDemo()}</div>
          </div>
        </main>
        ${footer()}
      </div>`;
    bindInstalar();

    let emoji = EMOJIS[0];
    $$('.emoji').forEach((b) => b.addEventListener('click', () => {
      emoji = b.dataset.emoji;
      $$('.emoji').forEach((x) => { const on = x === b; x.setAttribute('aria-pressed', on); x.setAttribute('aria-checked', on); });
    }));
    const err = $('#err');
    const mostrarErr = (m) => { err.hidden = false; err.textContent = m; err.scrollIntoView({ block: 'nearest' }); };

    $('#f-nueva').addEventListener('submit', async (e) => {
      e.preventDefault(); err.hidden = true;
      const nombre = $('#nombre').value.trim(), fecha = $('#fecha').value, p1 = $('#pin1').value.trim(), p2 = $('#pin2').value.trim();
      if (nombre.length < 2) return mostrarErr('Escribe un nombre de al menos 2 letras.');
      if (!fecha || parseISO(fecha) <= new Date()) return mostrarErr('La fecha meta debe ser una fecha futura.');
      if (!/^\d{4,6}$/.test(p1)) return mostrarErr('El PIN debe tener entre 4 y 6 dígitos.');
      if (p1 !== p2) return mostrarErr('Los PIN no coinciden.');
      const btn = $('#btn-crear'); btn.disabled = true; btn.textContent = 'Creando…';
      try {
        const { id, slug } = await store.crear({ nombre, emoji, pin: p1, fecha_meta: fecha });
        setPin(id, p1);
        toast('¡Alcancía creada! Ahora registra tu primer aporte.', 'ok');
        ir(`/a/${encodeURIComponent(slug)}?aporte=1`);
      } catch (ex) {
        mostrarErr(ex.message || 'No se pudo crear la alcancía.');
        btn.disabled = false; btn.textContent = 'Crear alcancía';
      }
    });
  }

  // ============================================================
  //  Vista · Detalle de alcancía
  // ============================================================
  async function vistaDetalle(slugRaw) {
    const [slug, query = ''] = slugRaw.split('?');
    const abrirAporteAlEntrar = /(^|&)aporte=1/.test(query);
    app.innerHTML = `<div class="page"><main class="wrap"><div class="skeleton" style="margin-top:80px;height:260px"></div></main></div>`;
    let a = await store.obtener(slug);
    if (!a) {
      app.innerHTML = `<div class="page"><main class="wrap"><div class="empty" style="margin-top:80px"><h3>Esa alcancía no existe</h3><p>Puede que el enlace esté mal o que la hayan eliminado.</p><p style="margin-top:16px"><a class="btn btn--primary" href="#/">Ir al inicio</a></p></div></main></div>`;
      return;
    }

    const pintar = () => {
      const c = calcular(a.total, a.fecha_meta, a.creado_en);
      const desbloqueada = !!getPin(a.id);
      const racha = calcularRacha(a.aportes.map((x) => x.fecha));
      const meds = medallasDe(a.aportes, c);
      const nMeds = meds.filter((m) => m.ganada).length;
      const ritmo = c.completo
        ? { cls: 'ok', txt: `<b>¡Meta cumplida!</b> Ya tienes el juego asegurado.` }
        : c.vencido
          ? { cls: 'bad', txt: `La fecha meta ya pasó. <b>Ajústala</b> para recalcular la cuota.` }
          : Math.abs(c.diff) < 1000
            ? { cls: 'ok', txt: `Vas <b>exactamente al ritmo</b> del plan.` }
            : c.diff > 0
              ? { cls: 'ok', txt: `Vas <b>${fmtCOP(c.diff)} adelantado</b> respecto al plan.` }
              : { cls: c.diff < -c.cuotaMes ? 'bad' : 'warn', txt: `Vas <b>${fmtCOP(-c.diff)} atrasado</b> respecto al plan. Deberías tener ${fmtCOP(c.esperado)}.` };

      const aportesHTML = a.aportes.length ? a.aportes.map((ap) => {
        const f = parseISO(ap.fecha);
        return `<li class="aporte">
            <div class="aporte__fecha"><b>${f.getDate()}</b><small>${MES_CORTO[f.getMonth()]}${f.getFullYear() !== new Date().getFullYear() ? ' ' + String(f.getFullYear()).slice(2) : ''}</small></div>
            <div class="aporte__info"><b>+${fmtCOP(ap.monto)}</b><small>${esc(ap.nota || 'Aporte')}</small></div>
            <button class="aporte__del" type="button" data-del="${ap.id}" title="Eliminar aporte" aria-label="Eliminar aporte de ${fmtCOP(ap.monto)}" ${desbloqueada ? '' : 'hidden'}>🗑</button>
          </li>`;
      }).join('') : `<li class="empty"><h3>Sin aportes todavía</h3><p>Registra lo que ya tienes guardado o tu primera consignación.</p></li>`;

      app.innerHTML = `
        <div class="page">
          <div class="page__bg"><img src="assets/poster_full.jpg" alt=""></div>
          <nav class="topbar" style="position:relative">
            <a class="back" href="#/">← El grupo</a>
            <a class="brand" href="#/"><img src="assets/logo_gta.png" alt="Grand Theft Auto" style="height:32px"></a>
          </nav>
          <main class="wrap">
            <header class="perfil">
              <span class="avatar avatar--xl" aria-hidden="true">${esc(a.emoji)}</span>
              <div>
                <h1>${esc(a.nombre)}</h1>
                <p>Meta: <b>${fmtCOP(META)}</b> para el <b>${fmtFecha(a.fecha_meta)}</b> · alcancía creada el ${fmtFecha(a.creado_en.slice(0, 10), { day: 'numeric', month: 'short' })}</p>
              </div>
              <div class="perfil__acciones">
                <button class="btn btn--ghost btn--sm" type="button" id="btn-compartir">🔗 Compartir</button>
                <button class="btn btn--ghost btn--sm" type="button" id="btn-editar">✏️ Editar</button>
                <button class="btn btn--primary btn--sm solo-desktop" type="button" id="btn-aporte-top">+ Agregar aporte</button>
              </div>
            </header>

            <section class="panel progreso" aria-label="Progreso">
              <div class="ring ${c.completo ? 'ring--done' : ''}" style="--p:${c.pct.toFixed(1)}" role="img" aria-label="${Math.floor(c.pct)} por ciento de la meta">
                <div><b>${Math.floor(c.pct)}%</b><small>de ${fmtCOP(META)}</small></div>
              </div>
              <div class="progreso__derecha">
                <div class="totales">
                  <div><small>Ahorrado</small><b>${fmtCOP(a.total)}</b></div>
                  <div><small>Falta</small><b>${fmtCOP(c.falta)}</b></div>
                </div>
                <div class="bar bar--lg ${c.completo ? 'bar--done' : ''}"><i style="width:${c.pct.toFixed(1)}%"></i></div>
                <p class="ritmo ritmo--${ritmo.cls}">${ritmo.txt}</p>
              </div>
            </section>

            <section class="stats-grid" aria-label="Plan de ahorro">
              <div class="stat stat--hero">
                <small>Cuota mensual necesaria</small>
                <b>${c.completo ? '¡Listo!' : fmtCOP(c.cuotaMes)}</b>
                <span>${c.completo ? 'Ya no necesitas ahorrar más.' : `durante ${c.meses} ${plural(c.meses, 'mes', 'meses')} para llegar el ${fmtFecha(a.fecha_meta, { day: 'numeric', month: 'short', year: 'numeric' })}`}</span>
              </div>
              <div class="stat"><small>Por semana</small><b>${c.completo ? '—' : fmtCOP(c.cuotaSem)}</b><span>${c.semanas} semanas restantes</span></div>
              <div class="stat"><small>Días para el lanzamiento</small><b>${fmtNum(c.dias)}</b><span>${c.vencido ? 'fecha vencida' : 'faltan'}</span></div>
              <div class="stat stat--racha"><small>Racha</small><b>${racha.racha ? `🔥 ${racha.racha}` : '—'}</b><span>${racha.racha ? `${plural(racha.racha, 'semana seguida', 'semanas seguidas')} · ${racha.estaSemana ? 'esta semana ✅' : 'esta semana ⏳'}` : (a.aportes.length ? 'aporta esta semana para arrancarla' : 'empieza con tu primer aporte')}</span></div>
            </section>

            <section class="medallas" aria-labelledby="t-medallas">
              <div class="sec-head"><div><h2 id="t-medallas">Medallas</h2><p class="sub">${nMeds} de ${meds.length} desbloqueadas.</p></div></div>
              <ul class="medallas__grid">
                ${meds.map((m) => `<li class="medalla ${m.ganada ? 'medalla--on' : ''}" title="${esc(m.d)}"><span class="medalla__e">${m.ganada ? m.e : '🔒'}</span><b>${esc(m.n)}</b><small>${esc(m.d)}</small></li>`).join('')}
              </ul>
            </section>

            <section aria-labelledby="t-aportes">
              <div class="sec-head">
                <div><h2 id="t-aportes">Aportes</h2><p class="sub">${desbloqueada ? 'Puedes agregar o eliminar aportes en este dispositivo.' : 'Para registrar aportes te pediremos el PIN de esta alcancía al guardar.'}</p></div>
                ${desbloqueada ? '<button class="btn btn--ghost btn--sm" type="button" id="btn-bloquear" title="Olvidar el PIN en este dispositivo">🔒 Bloquear</button>' : ''}
              </div>
              <ul class="lista-aportes" id="aportes">${aportesHTML}</ul>
            </section>
          </main>
          <div class="fab-bar"><button class="btn btn--primary" type="button" id="btn-aporte-fab">+ Agregar aporte</button></div>
          ${footer()}
        </div>`;

      ['#btn-aporte-top', '#btn-aporte-fab'].forEach((s) => { const b = $(s); b && b.addEventListener('click', abrirAporte); });
      $('#btn-compartir').addEventListener('click', compartir);
      $('#btn-editar').addEventListener('click', abrirEditar);
      const bl = $('#btn-bloquear'); bl && bl.addEventListener('click', () => {
        if (!confirm('¿Olvidar el PIN en este dispositivo? Tus aportes no se borran; solo te lo volveremos a pedir la próxima vez.')) return;
        clearPin(a.id); toast('PIN olvidado en este dispositivo'); pintar();
      });
      $$('[data-del]').forEach((b) => b.addEventListener('click', () => eliminarAporte(b.dataset.del)));
      bindInstalar();
    };

    const recargar = async () => { const n = await store.obtener(slug); if (n) { a = n; pintar(); } };

    async function compartir() {
      const url = `${location.origin}${location.pathname}#/a/${encodeURIComponent(a.slug)}`;
      const c = calcular(a.total, a.fecha_meta, a.creado_en);
      const texto = `${a.emoji} ${a.nombre} lleva ${fmtCOP(a.total)} (${Math.floor(c.pct)}%) para GTA VI. ¡Mira la alcancía!`;
      try {
        if (navigator.share) { await navigator.share({ title: 'Alcancía VI', text: texto, url }); return; }
        await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok');
      } catch (e) { if (e && e.name !== 'AbortError') { try { await navigator.clipboard.writeText(url); toast('Enlace copiado', 'ok'); } catch { toast(url); } } }
    }

    function abrirAporte() {
      const c = calcular(a.total, a.fecha_meta, a.creado_en);
      const desbloqueada = !!getPin(a.id);
      const sugeridos = [...new Set([c.cuotaSem, 20000, 50000, c.cuotaMes, 100000].filter((n) => n > 0))].sort((x, y) => x - y).slice(0, 5);
      const m = abrirModal(`
        <h2>Nuevo aporte</h2>
        <p class="lead">¿Cuánto guardaste en la alcancía de <b>${esc(a.nombre)}</b>?${desbloqueada ? '' : ' <span class="lead__pin">🔐 Te pediremos el PIN al guardar.</span>'}</p>
        <form class="form" id="f-aporte" autocomplete="off" novalidate>
          <div class="field">
            <label for="monto">Monto (COP)</label>
            <input class="input input--money" id="monto" name="monto" inputmode="numeric" placeholder="$ 0" required autocomplete="off">
            <div class="chips" style="margin-top:10px">${sugeridos.map((n) => `<button class="chip" type="button" data-monto="${n}">${fmtCOP(n)}</button>`).join('')}</div>
          </div>
          <div class="field">
            <label for="fecha-ap">Fecha</label>
            <input class="input" id="fecha-ap" name="fecha" type="date" value="${hoyISO()}" max="${hoyISO()}" required>
          </div>
          <div class="field">
            <label for="nota">Nota <span style="text-transform:none;font-weight:400;color:var(--dim)">(opcional)</span></label>
            <input class="input" id="nota" name="nota" maxlength="80" placeholder="Ej. quincena, vendí la bici, me sobró del mercado…">
          </div>
          <div class="error" id="ap-err" hidden></div>
          <div class="form__actions"><button class="btn btn--primary" type="submit" id="ap-btn">${desbloqueada ? 'Guardar aporte' : 'Guardar con PIN'}</button></div>
        </form>`);
      const monto = $('#monto', m.el);
      const leerMonto = () => Number(monto.value.replace(/[^\d]/g, '')) || 0;
      const formatear = () => { const n = leerMonto(); monto.value = n ? fmtCOP(n) : ''; };
      monto.addEventListener('input', formatear);
      $$('.chip', m.el).forEach((ch) => ch.addEventListener('click', () => { monto.value = fmtCOP(Number(ch.dataset.monto)); monto.focus(); }));
      $('#f-aporte', m.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const er = $('#ap-err', m.el); er.hidden = true;
        const n = leerMonto(), fecha = $('#fecha-ap', m.el).value, nota = $('#nota', m.el).value.trim();
        if (n <= 0) { er.hidden = false; er.textContent = 'Escribe un monto mayor a cero.'; return; }
        if (n > 5000000) { er.hidden = false; er.textContent = 'Ese monto parece demasiado grande para una alcancía 👀'; return; }
        if (!fecha) { er.hidden = false; er.textContent = 'Elige la fecha del aporte.'; return; }
        const btn = $('#ap-btn', m.el); btn.disabled = true; btn.textContent = 'Guardando…';
        try {
          const res = await conPin(a.id, (pin) => store.agregarAporte({ alcancia_id: a.id, pin, monto: n, fecha, nota }));
          if (res.cancelado) { btn.disabled = false; btn.textContent = 'Guardar aporte'; return; }
          m.cerrar();
          const antes = medallasDe(a.aportes, calcular(a.total, a.fecha_meta, a.creado_en)).filter((x) => x.ganada).map((x) => x.id);
          await recargar();
          const c2 = calcular(a.total, a.fecha_meta, a.creado_en);
          const nuevas = medallasDe(a.aportes, c2).filter((x) => x.ganada && !antes.includes(x.id));
          if (nuevas.length) toast(`🏅 Nueva medalla: ${nuevas.map((x) => `${x.e} ${x.n}`).join(', ')}`, 'ok');
          else toast(c2.completo ? '🎉 ¡Meta cumplida! Nos vemos en Leonida.' : `+${fmtCOP(n)} guardados. Te faltan ${fmtCOP(c2.falta)}.`, 'ok');
        } catch (ex) {
          er.hidden = false; er.textContent = ex.message || 'No se pudo guardar.';
          btn.disabled = false; btn.textContent = 'Guardar aporte';
        }
      });
    }

    async function eliminarAporte(id) {
      const ap = a.aportes.find((x) => x.id === id); if (!ap) return;
      if (!confirm(`¿Eliminar el aporte de ${fmtCOP(ap.monto)} del ${fmtFecha(ap.fecha, { day: 'numeric', month: 'short' })}?`)) return;
      try {
        const res = await conPin(a.id, (pin) => store.eliminarAporte(id, pin));
        if (res.cancelado) return;
        await recargar(); toast('Aporte eliminado');
      } catch (ex) { toast(ex.message || 'No se pudo eliminar', 'bad'); }
    }

    function abrirEditar() {
      const minFecha = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return isoLocal(d); })();
      const m = abrirModal(`
        <h2>Editar alcancía</h2>
        <p class="lead">Cambia el nombre, el ícono o la fecha meta. La meta de ${fmtCOP(META)} es igual para todo el grupo.</p>
        <form class="form" id="f-edit" autocomplete="off" novalidate>
          <div class="field"><label for="e-nombre">Nombre</label><input class="input" id="e-nombre" maxlength="30" minlength="2" value="${esc(a.nombre)}" required></div>
          <div class="field"><label>Ícono</label><div class="emojis">${EMOJIS.map((e) => `<button class="emoji" type="button" aria-pressed="${e === a.emoji}" data-emoji="${e}">${e}</button>`).join('')}</div></div>
          <div class="field"><label for="e-fecha">Fecha meta</label><input class="input" id="e-fecha" type="date" value="${a.fecha_meta}" min="${minFecha}" required><span class="hint">La cuota mensual se recalcula automáticamente.</span></div>
          <div class="error" id="e-err" hidden></div>
          <div class="form__actions">
            <button class="btn btn--danger btn--sm" type="button" id="e-borrar">Eliminar alcancía</button>
            <button class="btn btn--primary" type="submit" id="e-btn">Guardar cambios</button>
          </div>
        </form>`);
      let emoji = a.emoji;
      $$('.emoji', m.el).forEach((b) => b.addEventListener('click', () => { emoji = b.dataset.emoji; $$('.emoji', m.el).forEach((x) => x.setAttribute('aria-pressed', x === b)); }));
      $('#f-edit', m.el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const er = $('#e-err', m.el); er.hidden = true;
        const nombre = $('#e-nombre', m.el).value.trim(), fecha = $('#e-fecha', m.el).value;
        if (nombre.length < 2) { er.hidden = false; er.textContent = 'El nombre debe tener al menos 2 letras.'; return; }
        if (!fecha || parseISO(fecha) <= new Date()) { er.hidden = false; er.textContent = 'La fecha meta debe ser futura.'; return; }
        const btn = $('#e-btn', m.el); btn.disabled = true;
        try {
          const res = await conPin(a.id, (pin) => store.actualizar({ id: a.id, pin, nombre, emoji, fecha_meta: fecha }));
          if (res.cancelado) { btn.disabled = false; return; }
          m.cerrar(); await recargar(); toast('Cambios guardados', 'ok');
        } catch (ex) { er.hidden = false; er.textContent = ex.message || 'No se pudo guardar.'; btn.disabled = false; }
      });
      $('#e-borrar', m.el).addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la alcancía de ${a.nombre} con todos sus aportes? Esto no se puede deshacer.`)) return;
        try {
          const res = await conPin(a.id, (pin) => store.eliminarAlcancia(a.id, pin));
          if (res.cancelado) return;
          clearPin(a.id); m.cerrar(); toast('Alcancía eliminada'); ir('/');
        } catch (ex) { toast(ex.message || 'No se pudo eliminar', 'bad'); }
      });
    }

    pintar();
    if (abrirAporteAlEntrar) { history.replaceState(null, '', `#/a/${encodeURIComponent(slug)}`); setTimeout(abrirAporte, 250); }
    const unsub = store.suscribir(() => { if (!$('.modal-bg')) recargar(); });
    const onVis = () => { if (document.visibilityState === 'visible' && !$('.modal-bg')) recargar(); };
    document.addEventListener('visibilitychange', onVis);
    limpiarVista = () => { unsub(); document.removeEventListener('visibilitychange', onVis); };
  }

  // ---------- Arranque ----------
  render();
})();
