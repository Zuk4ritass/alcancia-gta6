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
  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const parseISO = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  const fmtFecha = (iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) => parseISO(iso).toLocaleDateString('es-CO', opts);
  const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const redondear = (n) => Math.ceil(n / 100) * 100;
  const slugify = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'alcancia';
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));

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

  function toast(msg, tipo = '') {
    const el = $('#toast');
    el.className = `toast show ${tipo ? 'toast--' + tipo : ''}`;
    el.innerHTML = `<div>${esc(msg)}</div>`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 3200);
  }

  // ---------- PIN guardado por dispositivo ----------
  const pinKey = (id) => `alcancia_vi_pin_${id}`;
  const getPin = (id) => { try { return localStorage.getItem(pinKey(id)); } catch { return null; } };
  const setPin = (id, pin) => { try { localStorage.setItem(pinKey(id), pin); } catch { /* sin storage */ } };
  const clearPin = (id) => { try { localStorage.removeItem(pinKey(id)); } catch { /* nada */ } };

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
          sb.from('aportes').select('alcancia_id,monto'),
        ]);
        const alcs = chk(al), aportes = chk(ap);
        const tot = {};
        for (const a of aportes) tot[a.alcancia_id] = (tot[a.alcancia_id] || 0) + a.monto;
        return alcs.map((a) => ({ ...a, total: tot[a.id] || 0 }));
      },
      async obtener(slug) {
        const a = chk(await sb.from('alcancias').select(COLS).eq('slug', slug).maybeSingle());
        if (!a) return null;
        const aportes = chk(await sb.from('aportes').select('id,monto,fecha,nota,creado_en')
          .eq('alcancia_id', a.id).order('fecha', { ascending: false }).order('creado_en', { ascending: false }));
        return { ...a, aportes, total: aportes.reduce((s, x) => s + x.monto, 0) };
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
        const db = leer();
        return db.alcancias.map((a) => ({ ...pub(a), total: db.aportes.filter((x) => x.alcancia_id === a.id).reduce((s, x) => s + x.monto, 0) }));
      },
      async obtener(slug) {
        await wait();
        const db = leer();
        const a = db.alcancias.find((x) => x.slug === slug);
        if (!a) return null;
        const aportes = db.aportes.filter((x) => x.alcancia_id === a.id).sort((p, q) => (q.fecha + q.creado_en).localeCompare(p.fecha + p.creado_en));
        return { ...pub(a), aportes, total: aportes.reduce((s, x) => s + x.monto, 0) };
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

  const store = (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase)
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
    return `
      <a class="card ${c.completo ? 'card--done' : ''}" href="#/a/${encodeURIComponent(a.slug)}">
        <div class="card__top">
          <span class="avatar" aria-hidden="true">${esc(a.emoji)}</span>
          <div><h3>${esc(a.nombre)}</h3><small>Meta: ${fmtFecha(a.fecha_meta, { day: 'numeric', month: 'short', year: 'numeric' })}</small></div>
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
          <a class="btn btn--ghost btn--sm" href="#/nueva">Crear alcancía</a>
        </nav>
        <div class="hero__content">
          <img class="hero__logo" src="assets/logo_vi.png" alt="Grand Theft Auto VI">
          <p class="hero__kicker">Ahorro colectivo · Leonida 2027</p>
          <h1 class="hero__title">La alcancía <em>VI</em></h1>
          <p class="hero__sub">Junta <b>${fmtCOP(META)}</b> antes del lanzamiento. Crea tu alcancía, anota cada aporte y mira si vas al ritmo del grupo.</p>
          ${countdownHTML()}
          <p class="hero__meta">Fecha estimada PC: <b>${fmtFecha(FECHA_DEFAULT)}</b> · quedan <b>${ref.meses} meses</b> · desde cero necesitas <b>${fmtCOP(ref.cuotaMes)}/mes</b></p>
          <div class="hero__cta">
            <a class="btn btn--primary" href="#/nueva">Crear mi alcancía</a>
            <a class="btn btn--ghost" href="#lista" id="ver-grupo">Ver el grupo</a>
          </div>
        </div>
      </header>
      <main class="wrap">
        ${bannerDemo()}
        <section id="lista" aria-labelledby="t-grupo">
          <div class="sec-head">
            <div><h2 id="t-grupo">El grupo</h2><p class="sub">Ordenado por quién va más cerca de la meta.</p></div>
            <span class="pill ${store.modo === 'supabase' ? 'pill--live' : ''}" id="resumen">Cargando…</span>
          </div>
          <div class="grid" id="grid"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div>
        </section>
      </main>
      ${footer()}`;

    $('#ver-grupo').addEventListener('click', (e) => { e.preventDefault(); $('#lista').scrollIntoView({ behavior: 'smooth' }); });
    const stopCd = iniciarCountdown($('#countdown'), FECHA_DEFAULT);

    const cargar = async () => {
      try {
        const lista = (await store.listar()).sort((a, b) => (b.total / META) - (a.total / META) || a.creado_en.localeCompare(b.creado_en));
        const grid = $('#grid'); if (!grid) return;
        const totalGrupo = lista.reduce((s, a) => s + a.total, 0);
        $('#resumen').innerHTML = lista.length
          ? `<b>${lista.length}</b> ${lista.length === 1 ? 'alcancía' : 'alcancías'} · <b>${fmtCOP(totalGrupo)}</b> ahorrados`
          : 'Aún no hay alcancías';
        grid.innerHTML = lista.length
          ? lista.map(cardAlcancia).join('')
          : `<div class="empty" style="grid-column:1/-1"><h3>Nadie ha empezado a ahorrar</h3><p>Sé el primero del grupo. Toma 20 segundos.</p><p style="margin-top:16px"><a class="btn btn--primary" href="#/nueva">Crear mi alcancía</a></p></div>`;
      } catch (err) {
        console.error(err);
        $('#grid').innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>No se pudo cargar el grupo</h3><p>${esc(err.message || err)}</p></div>`;
        $('#resumen').textContent = 'Sin conexión';
      }
    };
    await cargar();
    const unsub = store.suscribir(cargar);
    const onVis = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', onVis);
    limpiarVista = () => { stopCd(); unsub(); document.removeEventListener('visibilitychange', onVis); };
  }

  // ============================================================
  //  Vista · Nueva alcancía
  // ============================================================
  async function vistaNueva() {
    const minFecha = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; })();
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
        ir(`/a/${encodeURIComponent(slug)}`);
      } catch (ex) {
        mostrarErr(ex.message || 'No se pudo crear la alcancía.');
        btn.disabled = false; btn.textContent = 'Crear alcancía';
      }
    });
  }

  // ============================================================
  //  Vista · Detalle de alcancía
  // ============================================================
  async function vistaDetalle(slug) {
    app.innerHTML = `<div class="page"><main class="wrap"><div class="skeleton" style="margin-top:80px;height:260px"></div></main></div>`;
    let a = await store.obtener(slug);
    if (!a) {
      app.innerHTML = `<div class="page"><main class="wrap"><div class="empty" style="margin-top:80px"><h3>Esa alcancía no existe</h3><p>Puede que el enlace esté mal o que la hayan eliminado.</p><p style="margin-top:16px"><a class="btn btn--primary" href="#/">Ir al inicio</a></p></div></main></div>`;
      return;
    }

    const pintar = () => {
      const c = calcular(a.total, a.fecha_meta, a.creado_en);
      const desbloqueada = !!getPin(a.id);
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
                <span>${c.completo ? 'Ya no necesitas ahorrar más.' : `durante ${c.meses} ${c.meses === 1 ? 'mes' : 'meses'} para llegar el ${fmtFecha(a.fecha_meta, { day: 'numeric', month: 'short', year: 'numeric' })}`}</span>
              </div>
              <div class="stat"><small>Por semana</small><b>${c.completo ? '—' : fmtCOP(c.cuotaSem)}</b><span>${c.semanas} semanas restantes</span></div>
              <div class="stat"><small>Días para el lanzamiento</small><b>${fmtNum(c.dias)}</b><span>${c.vencido ? 'fecha vencida' : 'faltan'}</span></div>
              <div class="stat"><small>Aportes</small><b>${a.aportes.length}</b><span>${a.aportes.length ? `último: ${fmtFecha(a.aportes[0].fecha, { day: 'numeric', month: 'short' })}` : 'ninguno aún'}</span></div>
            </section>

            <section aria-labelledby="t-aportes">
              <div class="sec-head">
                <div><h2 id="t-aportes">Aportes</h2><p class="sub">${desbloqueada ? 'Puedes agregar o eliminar aportes en este dispositivo.' : 'Para registrar aportes necesitas el PIN de esta alcancía.'}</p></div>
                ${desbloqueada ? '<button class="btn btn--ghost btn--sm" type="button" id="btn-bloquear">🔒 Bloquear</button>' : ''}
              </div>
              <ul class="lista-aportes" id="aportes">${aportesHTML}</ul>
            </section>
          </main>
          <div class="fab-bar"><button class="btn btn--primary" type="button" id="btn-aporte-fab">+ Agregar aporte</button></div>
          ${footer()}
        </div>`;

      // Eventos
      ['#btn-aporte-top', '#btn-aporte-fab'].forEach((s) => { const b = $(s); b && b.addEventListener('click', abrirAporte); });
      $('#btn-compartir').addEventListener('click', compartir);
      $('#btn-editar').addEventListener('click', abrirEditar);
      const bl = $('#btn-bloquear'); bl && bl.addEventListener('click', () => { clearPin(a.id); toast('Alcancía bloqueada en este dispositivo'); pintar(); });
      $$('[data-del]').forEach((b) => b.addEventListener('click', () => eliminarAporte(b.dataset.del)));
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
      const sugeridos = [...new Set([c.cuotaSem, 20000, 50000, c.cuotaMes, 100000].filter((n) => n > 0))].sort((x, y) => x - y).slice(0, 5);
      const m = abrirModal(`
        <h2>Nuevo aporte</h2>
        <p class="lead">¿Cuánto guardaste en la alcancía de <b>${esc(a.nombre)}</b>?</p>
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
          <div class="form__actions"><button class="btn btn--primary" type="submit" id="ap-btn">Guardar aporte</button></div>
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
          await recargar();
          const c2 = calcular(a.total, a.fecha_meta, a.creado_en);
          toast(c2.completo ? '🎉 ¡Meta cumplida! Nos vemos en Leonida.' : `+${fmtCOP(n)} guardados. Te faltan ${fmtCOP(c2.falta)}.`, 'ok');
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
      const minFecha = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; })();
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
    const unsub = store.suscribir(() => { if (!$('.modal-bg')) recargar(); });
    const onVis = () => { if (document.visibilityState === 'visible' && !$('.modal-bg')) recargar(); };
    document.addEventListener('visibilitychange', onVis);
    limpiarVista = () => { unsub(); document.removeEventListener('visibilitychange', onVis); };
  }

  // ---------- Arranque ----------
  render();
})();
