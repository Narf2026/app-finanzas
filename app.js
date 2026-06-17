// ---- HELPERS ----
const $ = id => document.getElementById(id);
const fmt = n => (n ?? 0).toLocaleString('es-AR');

let _newRowId = null;

const EMPTY_ICONS = {
  gastos:   `<svg viewBox="0 0 24 24"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/><circle cx="12" cy="14" r="2"/></svg>`,
  ingresos: `<svg viewBox="0 0 24 24"><path d="M12 2v20M17 7l-5-5-5 5"/><path d="M2 17h20"/></svg>`,
  ahorro:   `<svg viewBox="0 0 24 24"><path d="M19 8a7 7 0 1 0-13.47 2.67A2 2 0 0 0 7 14v1h10v-1a2 2 0 0 0 1.47-3.33z"/><path d="M9 14v3m6-3v3M10 21h4"/></svg>`,
  cuotas:   `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>`,
  chart:    `<svg viewBox="0 0 24 24"><path d="M3 3v18h18"/><path d="m7 16 4-4 4 4 4-6"/></svg>`,
  fondos:   `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 3"/></svg>`,
};

function emptyState(type, title, sub = '') {
  const icon = EMPTY_ICONS[type] || EMPTY_ICONS.chart;
  return `<div class="empty-state">
    <div class="empty-state-icon">${icon}</div>
    <div class="empty-state-title">${title}</div>
    ${sub ? `<div class="empty-state-sub">${sub}</div>` : ''}
  </div>`;
}

const CAT_PALETTE = ['#6ee7b7','#93c5fd','#fcd34d','#f9a8d4','#a5b4fc','#86efac','#fdba74','#67e8f9','#c4b5fd','#fb923c'];
function catColor(name) {
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return CAT_PALETTE[h % CAT_PALETTE.length];
}

function animateValue(id, end, prefix = '$') {
  const el = $(id);
  if (!el) return;
  const duration = 600;
  const startTime = Date.now();
  const absEnd = Math.abs(end);
  const sign = end < 0 ? '−' : '';
  function tick() {
    const progress = Math.min((Date.now() - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(absEnd * eased);
    el.textContent = sign + prefix + fmt(current);
    if (progress < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
const escHtml = s => (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

// ---- DATA ----
let gastos = [];
let ingresos = [];
let ahorros = [];
let pendientes = [];
let pendienteFiltro = 'todos';
let tarjetas = JSON.parse(localStorage.getItem('gf_tarjetas') || '[]');
let saldosIniciales = {};
let conceptosGuardados = [];
let otrosPendientes = [];
let ajustesCuentas = [];
let presupuestos = {}; // { "2026-06": { "Alimentación": 50000, ... }, ... }
let presupuestosExplicitos = {}; // { "Alimentación": ["2026-06", "2026-07"], ... } — meses donde el usuario fijó el valor manualmente
let metasAhorro = {}; // { "Viaje Europa": 1000000, "Auto": 5000000 }
let recurrentes = []; // [{ id, nombre, monto, cat, medio, moneda, notas, mesesActivos: {'YYYY-MM': gastoId} }]
let _gastosCatChip = new Set(); // categorías activas en filtro de chips
let _mesFiltro     = ''; // mes activo en navegador ('' = todos)

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let selectedDashMonth = new Date().toISOString().slice(0,7);

async function save({ skipMerge = false } = {}) {
  const uid = window._currentUser?.uid;
  if (!uid) return;
  try {
    const ref = window._fbDoc(window._fbDb, 'usuarios', uid);
    if (!skipMerge) {
      // Fusionar con lo que haya en Firestore para no pisar cambios del bot de Telegram
      const remoteSnap = await window._fbGetDoc(ref);
      if (remoteSnap.exists()) {
        const remote = remoteSnap.data();
        const mergeById = (local, remoteArr) => {
          if (!Array.isArray(remoteArr)) return local;
          const ids = new Set(local.map(x => String(x.id)));
          const extra = remoteArr.filter(x => !ids.has(String(x.id)));
          return extra.length ? [...local, ...extra] : local;
        };
        gastos     = mergeById(gastos, remote.gastos);
        ingresos   = mergeById(ingresos, remote.ingresos);
        ahorros    = mergeById(ahorros, remote.ahorros);
        pendientes = mergeById(pendientes, remote.pendientes);
      }
    }
    await window._fbSetDoc(ref, {
      gastos, ingresos, ahorros, saldosIniciales, tarjetas, pendientes, conceptosGuardados, ajustesCuentas, presupuestos, presupuestosExplicitos, metasAhorro, recurrentes, email: window._currentUser.email, updatedAt: new Date().toISOString()
    });
  } catch(e) { console.error('Error guardando:', e); }
}

window.loadUserData = async function(uid) {
  // Mostrar skeletons mientras carga
  document.querySelectorAll('#tab-dashboard .cards .card').forEach(c => c.classList.add('loading'));
  // Resetear todo antes de cargar para evitar datos de sesiones anteriores
  gastos = []; ingresos = []; ahorros = []; saldosIniciales = {}; pendientes = [];
  conceptosGuardados = []; otrosPendientes = []; ajustesCuentas = []; presupuestos = {}; presupuestosExplicitos = {}; metasAhorro = {}; recurrentes = [];
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    if (snap.exists()) {
      const d = snap.data();
      gastos          = d.gastos          || [];
      ingresos        = d.ingresos        || [];
      ahorros         = d.ahorros         || [];
      saldosIniciales = d.saldosIniciales  || {};
      if (Array.isArray(d.conceptosGuardados)) {
        const validDefaults = ['Sueldo','Freelance','Alquiler','Facturación','Inversión','Otros'];
        conceptosGuardados = d.conceptosGuardados.filter(c =>
          c && typeof c === 'string' && c.trim().length > 0 && c.length <= 40
          && !validDefaults.includes(c)
          && !c.toLowerCase().includes('concepto')
          && !c.includes('ej:')
        );
      }
      if (Array.isArray(d.ajustesCuentas)) ajustesCuentas = d.ajustesCuentas;
      if (d.presupuestos && typeof d.presupuestos === 'object') presupuestos = d.presupuestos;
      if (d.presupuestosExplicitos && typeof d.presupuestosExplicitos === 'object') presupuestosExplicitos = d.presupuestosExplicitos;
      if (d.metasAhorro && typeof d.metasAhorro === 'object') metasAhorro = d.metasAhorro;
      if (Array.isArray(d.recurrentes)) recurrentes = d.recurrentes;
      // Cargar tarjetas desde Firestore; si no hay, usar localStorage como fallback
      if (d.tarjetas && d.tarjetas.length > 0) {
        tarjetas = d.tarjetas;
        localStorage.setItem('gf_tarjetas', JSON.stringify(tarjetas));
      }
      // Cargar pendientes desde Firestore; si el campo existe usarlo (aunque esté vacío)
      if (Array.isArray(d.pendientes)) {
        pendientes = d.pendientes;
      } else {
        // Migración: si hay datos en localStorage, subirlos a Firestore
        const local = JSON.parse(localStorage.getItem('gf_pendientes') || '[]');
        pendientes = local;
        if (local.length > 0) save(); // subir a Firestore
      }
    } else {
      gastos = []; ingresos = []; ahorros = []; saldosIniciales = {};
      // Migración desde localStorage si existe
      const local = JSON.parse(localStorage.getItem('gf_pendientes') || '[]');
      pendientes = local;
      if (local.length > 0) save();
    }
  } catch(e) { console.error('Error cargando:', e); }
  // Refrescar todos los selects que dependen de tarjetas
  renderMedioPago();
  renderDestinosIngreso();
  renderOrigenAhorro();
  renderSaldoInicial();
  // Bienvenida para usuarios sin cuentas configuradas
  if (!tarjetas || tarjetas.length === 0) {
    setTimeout(() => {
      const m = $('bienvenida-modal');
      if (m) m.style.display = 'flex';
    }, 800);
  }
  // Chequear invitaciones pendientes a grupos compartidos
  ccCheckInvitaciones();
  // Cargar categorías guardadas (local) y fusionar con las de Firestore para sincronizar entre dispositivos
  loadCats();
  try {
    const snapCats = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    if (snapCats.exists()) mergeCatsRemote(snapCats.data().cats);
  } catch(e) { console.error('Error sincronizando categorías:', e); }
  initCatSelects();
};

// ---- UTILIDADES (sub-tabs dentro de "Utilidades") ----
function showUtilSubtab(sub, btn) {
  document.querySelectorAll('[id^="util-tab-"]').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('[id^="util-"]:not([id^="util-tab-"])').forEach(s => s.style.display = 'none');
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('util-' + sub);
  if (panel) panel.style.display = '';
  if (sub === 'compartir') ccRenderGrupos();
  if (sub === 'cotizaciones') cargarCotizaciones();
  if (sub === 'presupuesto') renderPresupuesto();
  if (sub === 'reportes') renderReportes();
  if (sub === 'recurrentes') renderRecurrentesLista();
}

// ---- COTIZACIONES (USD/ARS y ARS/CLP) ----
let cotizacionesActuales = null;

async function cargarCotizaciones() {
  const el = $('cotizaciones-body');
  const fechaEl = $('cotizaciones-fecha');
  if (!el) return;
  el.innerHTML = '<div class="panel-empty">Cargando...</div>';
  if (fechaEl) fechaEl.textContent = '';

  try {
    // USD/ARS (oficial y blue) desde dolarapi.com
    const dolaresResp = await fetch('https://dolarapi.com/v1/dolares');
    const dolares = await dolaresResp.json();
    const oficial = dolares.find(d => d.casa === 'oficial');
    const blue = dolares.find(d => d.casa === 'blue');

    // ARS/CLP cruzado desde open.er-api.com (base USD)
    const erResp = await fetch('https://open.er-api.com/v6/latest/USD');
    const er = await erResp.json();
    const usdToArs = er.rates?.ARS;
    const usdToClp = er.rates?.CLP;
    const arsToClp = (usdToArs && usdToClp) ? (usdToClp / usdToArs) : null;

    const cards = [];
    if (oficial) cards.push({ label: 'Dólar oficial', value: `$${fmt(oficial.venta)}`, sub: `compra $${fmt(oficial.compra)}`, color: 'blue' });
    if (blue) cards.push({ label: 'Dólar blue', value: `$${fmt(blue.venta)}`, sub: `compra $${fmt(blue.compra)}`, color: 'green' });
    if (arsToClp) cards.push({ label: '1 peso ARS', value: `${fmt(arsToClp)} CLP`, sub: `1 CLP = $${fmt(1/arsToClp)} ARS`, color: 'yellow' });

    if (!cards.length) throw new Error('Sin datos');

    el.innerHTML = `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">` +
      cards.map(c => `<div class="card ${c.color}">
        <div class="label">${c.label}</div>
        <div class="value">${c.value}</div>
        <div class="sub">${c.sub}</div>
      </div>`).join('') + '</div>';

    if (fechaEl) fechaEl.textContent = 'Actualizado: ' + new Date().toLocaleString('es-AR');

    // Guardar tasas para el conversor
    cotizacionesActuales = {
      oficialVenta: oficial?.venta || null,
      oficialCompra: oficial?.compra || null,
      blueVenta: blue?.venta || null,
      blueCompra: blue?.compra || null,
      arsToClp: arsToClp || null
    };
    convertirMoneda();
  } catch (e) {
    console.error('Error cargando cotizaciones:', e);
    el.innerHTML = '<div class="panel-empty">⚠ No se pudieron cargar las cotizaciones. Probá actualizar de nuevo.</div>';
    cotizacionesActuales = null;
  }
}
window.cargarCotizaciones = cargarCotizaciones;

function convertirMoneda() {
  const el = $('conv-resultado');
  if (!el) return;
  const input = $('conv-monto');
  const monedaSel = $('conv-moneda')?.value || 'ARS';
  const monto = parseFloat(input?.value);

  if (!cotizacionesActuales) {
    el.innerHTML = '<span style="color:var(--text3)">Esperando cotizaciones...</span>';
    return;
  }
  if (isNaN(monto) || monto <= 0) {
    el.innerHTML = '<span style="color:var(--text3)">Ingresá un monto para convertir</span>';
    return;
  }

  const { oficialVenta, blueVenta, arsToClp } = cotizacionesActuales;

  // Convertir el monto de origen a ARS primero, usando la tasa correspondiente
  let montoEnArs = null;
  if (monedaSel === 'ARS') montoEnArs = monto;
  else if (monedaSel === 'USD' && oficialVenta) montoEnArs = monto * oficialVenta;
  else if (monedaSel === 'USD_BLUE' && blueVenta) montoEnArs = monto * blueVenta;
  else if (monedaSel === 'CLP' && arsToClp) montoEnArs = monto / arsToClp;

  if (montoEnArs === null) {
    el.innerHTML = '<span style="color:var(--text3)">No hay tasa disponible para esta moneda</span>';
    return;
  }

  const filas = [];
  if (monedaSel !== 'ARS') filas.push(`$${fmt(montoEnArs)} ARS`);
  if (monedaSel !== 'USD' && oficialVenta) filas.push(`u$s ${fmt(montoEnArs / oficialVenta)} <span style="color:var(--text3)">(dólar oficial)</span>`);
  if (monedaSel !== 'USD_BLUE' && blueVenta) filas.push(`u$s ${fmt(montoEnArs / blueVenta)} <span style="color:var(--text3)">(dólar blue)</span>`);
  if (monedaSel !== 'CLP' && arsToClp) filas.push(`${fmt(montoEnArs * arsToClp)} CLP <span style="color:var(--text3)">(pesos chilenos)</span>`);

  const nombreOrigen = { ARS: 'ARS', USD: 'USD (oficial)', USD_BLUE: 'USD (blue)', CLP: 'CLP' }[monedaSel];

  el.innerHTML = filas.length
    ? `${fmt(monto)} ${nombreOrigen} equivale a:<br>` + filas.join('<br>')
    : '<span style="color:var(--text3)">No hay tasas disponibles</span>';
}
window.convertirMoneda = convertirMoneda;

// ---- CUENTA CLARA (Compartir gastos) ----
let ccGrupos = JSON.parse(localStorage.getItem('cc_grupos')) || [];
let ccGrupoActualId = null;
let ccPendienteBorrarGrupoId = null;
let ccPendienteBorrarPersona = null;
let ccGastoEditandoId = null;
let ccGruposCompartidos = [];

function ccEmail() {
  return (window._currentUser && window._currentUser.email) || '';
}

function ccGuardar() {
  const g = ccGrupoActual();
  if (g && g.compartido) {
    const ref = window._fbDoc(window._fbDb, 'grupos_compartidos', g.id);
    window._fbSetDoc(ref, g).catch(e => console.error('Error guardando grupo compartido', e));
  } else {
    localStorage.setItem('cc_grupos', JSON.stringify(ccGrupos));
  }
}

function ccGrupoActual() {
  return ccGrupos.find(g => g.id === ccGrupoActualId) || ccGruposCompartidos.find(g => g.id === ccGrupoActualId);
}

async function ccRenderGrupos() {
  await ccCargarGruposCompartidos();
  ccPintarGrupos();
}

async function ccCargarGruposCompartidos() {
  const email = ccEmail();
  if (!email) { ccGruposCompartidos = []; return; }
  try {
    const ref = window._fbCollection(window._fbDb, 'grupos_compartidos');
    const q = window._fbQuery(ref, window._fbWhere('miembros', 'array-contains', email));
    const snap = await window._fbGetDocs(q);
    ccGruposCompartidos = snap.docs.map(d => ({ ...d.data(), id: d.id, compartido: true }));
  } catch (e) {
    console.error('Error cargando grupos compartidos', e);
  }
}

function ccPintarGrupos() {
  const grid = document.getElementById('cc-grupos-grid');
  if (!grid) return;
  let html = '';
  ccGrupos.forEach(g => {
    const total = g.gastos.reduce((s, x) => s + x.monto, 0);
    html += `
      <div class="cc-grupo-card" onclick="ccAbrirGrupo('${g.id}')">
        <button class="gc-del" onclick="event.stopPropagation();ccPedirBorrarGrupo('${g.id}')" title="Borrar grupo">✕</button>
        <div class="gc-nombre">${escHtml(g.nombre)}</div>
        <div class="gc-info">${g.personas.length} persona${g.personas.length !== 1 ? 's' : ''} · $${fmt(total)}</div>
      </div>`;
  });
  ccGruposCompartidos.forEach(g => {
    const total = g.gastos.reduce((s, x) => s + x.monto, 0);
    const esOwner = g.ownerEmail === ccEmail();
    const compartidoConOtros = (g.miembros || []).length > 1;
    html += `
      <div class="cc-grupo-card" onclick="ccAbrirGrupo('${g.id}')">
        <button class="gc-del" onclick="event.stopPropagation();ccPedirBorrarGrupo('${g.id}')" title="${esOwner ? 'Borrar grupo' : 'Salir del grupo'}">✕</button>
        <div class="gc-nombre">${escHtml(g.nombre)}</div>
        <div class="gc-info">${g.personas.length} persona${g.personas.length !== 1 ? 's' : ''} · $${fmt(total)}</div>
        ${compartidoConOtros ? '<div class="gc-shared">👥 Compartido</div>' : ''}
      </div>`;
  });
  html += `<div class="cc-grupo-card nuevo" onclick="ccCrearGrupo()">+ Nuevo grupo</div>`;
  grid.innerHTML = html;
}

function ccCrearGrupo() {
  const nombre = prompt('Nombre del grupo (ej: Viaje a Bariloche):');
  if (!nombre || !nombre.trim()) return;
  const g = { id: Date.now().toString(), nombre: nombre.trim(), personas: [], gastos: [] };
  ccGrupos.push(g);
  ccGuardar();
  ccPintarGrupos();
  ccAbrirGrupo(g.id);
}

function ccPedirBorrarGrupo(id) {
  ccPendienteBorrarGrupoId = id;
  let g = ccGrupos.find(x => x.id === id);
  if (g) {
    document.getElementById('cc-modal-borrar-grupo-msg').textContent = `¿Seguro que querés borrar "${g.nombre}"? Se perderán todos los gastos.`;
  } else {
    g = ccGruposCompartidos.find(x => x.id === id);
    if (!g) return;
    const esOwner = g.ownerEmail === ccEmail();
    document.getElementById('cc-modal-borrar-grupo-msg').textContent = esOwner
      ? `¿Seguro que querés borrar "${g.nombre}"? Se perderán todos los gastos para todos los miembros.`
      : `¿Salir del grupo "${g.nombre}"? Ya no vas a poder verlo ni agregar gastos.`;
  }
  document.getElementById('cc-modal-borrar-grupo').classList.add('show');
}

async function ccConfirmarBorrarGrupo() {
  const id = ccPendienteBorrarGrupoId;
  ccPendienteBorrarGrupoId = null;
  const local = ccGrupos.find(g => g.id === id);
  if (local) {
    ccGrupos = ccGrupos.filter(g => g.id !== id);
    ccGuardar();
  } else {
    const g = ccGruposCompartidos.find(x => x.id === id);
    if (g) {
      const email = ccEmail();
      const ref = window._fbDoc(window._fbDb, 'grupos_compartidos', id);
      try {
        if (g.ownerEmail === email) {
          await window._fbDeleteDoc(ref);
        } else {
          await window._fbUpdateDoc(ref, { miembros: window._fbArrayRemove(email) });
        }
      } catch (e) {
        console.error('Error borrando/saliendo del grupo', e);
      }
      ccGruposCompartidos = ccGruposCompartidos.filter(x => x.id !== id);
    }
  }
  ccCerrarModal();
  ccPintarGrupos();
}

async function ccAbrirGrupo(id) {
  ccGrupoActualId = id;
  let g = ccGrupoActual();
  if (!g) return;
  if (g.compartido) {
    try {
      const ref = window._fbDoc(window._fbDb, 'grupos_compartidos', id);
      const snap = await window._fbGetDoc(ref);
      if (snap.exists()) {
        const fresh = { ...snap.data(), id, compartido: true };
        const idx = ccGruposCompartidos.findIndex(x => x.id === id);
        if (idx >= 0) ccGruposCompartidos[idx] = fresh; else ccGruposCompartidos.push(fresh);
        g = fresh;
      }
    } catch (e) {
      console.error('Error actualizando grupo compartido', e);
    }
  }
  document.getElementById('cc-vista-grupos').style.display = 'none';
  document.getElementById('cc-vista-grupo').style.display = '';
  document.getElementById('cc-breadcrumb-nombre').textContent = g.nombre;
  document.getElementById('cc-badge-compartido').style.display = (g.compartido && (g.miembros || []).length > 1) ? '' : 'none';
  document.getElementById('cc-miembros-wrap').style.display = g.compartido ? '' : 'none';
  if (g.compartido) ccRenderMiembros();
  ccMostrarTab('balance', document.getElementById('cc-tab-balance'));
  ccRenderPersonas();
  ccRenderHistorial();
  ccCalcular();
}

function ccVolverAGrupos() {
  ccGrupoActualId = null;
  document.getElementById('cc-vista-grupos').style.display = '';
  document.getElementById('cc-vista-grupo').style.display = 'none';
  ccPintarGrupos();
}

function ccRenderMiembros() {
  const g = ccGrupoActual();
  const cont = document.getElementById('cc-miembros-list');
  if (!cont) return;
  if (!g || !g.compartido) { cont.innerHTML = ''; return; }
  const email = ccEmail();
  cont.innerHTML = (g.miembros || []).map(m => `
    <div class="cc-miembro-row">
      <span>${escHtml(m)}</span>
      ${m === g.ownerEmail
        ? '<span class="cm-owner">Creador</span>'
        : (g.ownerEmail === email ? `<button class="cm-del" onclick="ccQuitarMiembro('${escHtml(m)}')" title="Quitar">✕</button>` : '')}
    </div>`).join('');
}

async function ccQuitarMiembro(email) {
  const g = ccGrupoActual();
  if (!g || !g.compartido) return;
  const ref = window._fbDoc(window._fbDb, 'grupos_compartidos', g.id);
  try {
    await window._fbUpdateDoc(ref, { miembros: window._fbArrayRemove(email) });
    g.miembros = (g.miembros || []).filter(m => m !== email);
    ccRenderMiembros();
    document.getElementById('cc-badge-compartido').style.display = g.miembros.length > 1 ? '' : 'none';
  } catch (e) {
    console.error('Error quitando miembro', e);
    alert('No se pudo quitar al miembro.');
  }
}

async function ccAbrirModalCompartir() {
  const g = ccGrupoActual();
  if (!g) return;
  if (!g.compartido) {
    if (!ccEmail()) { alert('Necesitás estar logueado para compartir un grupo.'); return; }
    if (!confirm(`Para compartir "${g.nombre}" hace falta subirlo a la nube. ¿Continuar?`)) return;
    await ccCompartirGrupo(g.id);
  }
  const input = document.getElementById('cc-invitar-email');
  if (input) input.value = '';
  document.getElementById('cc-modal-compartir').classList.add('show');
}

async function ccCompartirGrupo(id) {
  const idx = ccGrupos.findIndex(x => x.id === id);
  if (idx < 0) return;
  const g = ccGrupos[idx];
  const email = ccEmail();
  if (!email) { alert('Necesitás estar logueado para compartir un grupo.'); return; }
  const compartido = { ...g, ownerEmail: email, miembros: [email], compartido: true };
  try {
    const ref = window._fbDoc(window._fbDb, 'grupos_compartidos', id);
    await window._fbSetDoc(ref, compartido);
  } catch (e) {
    console.error('Error compartiendo grupo', e);
    alert('No se pudo compartir el grupo.');
    return;
  }
  ccGrupos.splice(idx, 1);
  localStorage.setItem('cc_grupos', JSON.stringify(ccGrupos));
  ccGruposCompartidos.push(compartido);
  ccGrupoActualId = id;
  document.getElementById('cc-badge-compartido').style.display = '';
  document.getElementById('cc-miembros-wrap').style.display = '';
  ccRenderMiembros();
}

async function ccInvitar() {
  const g = ccGrupoActual();
  if (!g || !g.compartido) return;
  const input = document.getElementById('cc-invitar-email');
  const email = input.value.trim().toLowerCase();
  if (!email || !email.includes('@')) { alert('Ingresá un email válido.'); return; }
  if ((g.miembros || []).includes(email)) { alert('Esa persona ya es miembro del grupo.'); return; }
  if ((g.pendientesMiembros || []).includes(email)) { alert('Ya hay una invitación pendiente para ese email.'); return; }
  const refGrupo = window._fbDoc(window._fbDb, 'grupos_compartidos', g.id);
  const refInv = window._fbDoc(window._fbDb, 'invitaciones', email);
  try {
    await window._fbUpdateDoc(refGrupo, { pendientesMiembros: window._fbArrayUnion(email) });
    await window._fbSetDoc(refInv, {
      grupos: window._fbArrayUnion({ grupoId: g.id, grupoNombre: g.nombre, ownerEmail: ccEmail() })
    }, { merge: true });
    g.pendientesMiembros = [...(g.pendientesMiembros || []), email];
    input.value = '';
    ccRenderMiembros();
    notify('✓ Invitación enviada — verá la notificación al entrar a la app');
  } catch (e) {
    console.error('Error invitando', e);
    alert('No se pudo invitar. Verificá el email.');
  }
}

// ── Invitaciones pendientes ──────────────────────────────────────────────────
async function ccCheckInvitaciones() {
  const email = window._currentUser?.email?.toLowerCase();
  if (!email) return;
  try {
    // Leer directamente el documento del usuario en la colección invitaciones
    const refInv = window._fbDoc(window._fbDb, 'invitaciones', email);
    const snap = await window._fbGetDoc(refInv);
    if (!snap.exists()) return;
    const grupos = (snap.data().grupos || []).filter(g => g && g.grupoId);
    if (!grupos.length) return;

    const lista = document.getElementById('invitaciones-lista');
    if (!lista) return;

    lista.innerHTML = grupos.map(g => `
      <div style="background:var(--surface2);border:1px solid var(--border);border-radius:var(--radius);padding:0.9rem 1rem">
        <div style="font-weight:600;color:var(--text2);margin-bottom:4px">👥 ${escHtml(g.grupoNombre || 'Grupo sin nombre')}</div>
        <div style="font-size:0.78rem;color:var(--text3);margin-bottom:10px">Invitado por: ${escHtml(g.ownerEmail || '—')}</div>
        <div style="display:flex;gap:8px">
          <button class="btn-confirm" onclick="ccAceptarInvitacion('${g.grupoId}')" style="flex:1;padding:7px;font-size:0.82rem">✓ Aceptar</button>
          <button class="btn-cancel" onclick="ccRechazarInvitacion('${g.grupoId}')" style="flex:1;padding:7px;font-size:0.82rem">✕ Rechazar</button>
        </div>
      </div>`).join('');

    document.getElementById('invitaciones-modal').style.display = 'flex';
  } catch(e) { console.error('Error chequeando invitaciones:', e); }
}

async function ccAceptarInvitacion(grupoId) {
  const email = window._currentUser?.email?.toLowerCase();
  const refGrupo = window._fbDoc(window._fbDb, 'grupos_compartidos', grupoId);
  const refInv = window._fbDoc(window._fbDb, 'invitaciones', email);
  try {
    await window._fbUpdateDoc(refGrupo, {
      miembros: window._fbArrayUnion(email),
      pendientesMiembros: window._fbArrayRemove(email)
    });
    // Limpiar la invitación del documento propio
    const snap = await window._fbGetDoc(refInv);
    if (snap.exists()) {
      const grupos = (snap.data().grupos || []).filter(g => g.grupoId !== grupoId);
      await window._fbSetDoc(refInv, { grupos }, { merge: false });
    }
    notify('✓ Invitación aceptada — ya podés ver el grupo en "Compartir gastos"');
    document.getElementById('invitaciones-modal').style.display = 'none';
    ccRenderGrupos();
  } catch(e) { console.error('Error aceptando invitación:', e); notify('⚠ Error al aceptar'); }
}

async function ccRechazarInvitacion(grupoId) {
  const email = window._currentUser?.email?.toLowerCase();
  const refGrupo = window._fbDoc(window._fbDb, 'grupos_compartidos', grupoId);
  const refInv = window._fbDoc(window._fbDb, 'invitaciones', email);
  try {
    await window._fbUpdateDoc(refGrupo, { pendientesMiembros: window._fbArrayRemove(email) });
    // Limpiar la invitación del documento propio
    const snap = await window._fbGetDoc(refInv);
    if (snap.exists()) {
      const grupos = (snap.data().grupos || []).filter(g => g.grupoId !== grupoId);
      await window._fbSetDoc(refInv, { grupos }, { merge: false });
    }
    // Quitar del modal
    const lista = document.getElementById('invitaciones-lista');
    if (lista) {
      lista.innerHTML = [...lista.children].filter(el => !el.innerHTML.includes(grupoId)).map(el => el.outerHTML).join('');
      if (!lista.children.length) document.getElementById('invitaciones-modal').style.display = 'none';
    }
    notify('Invitación rechazada');
  } catch(e) { console.error('Error rechazando invitación:', e); notify('⚠ Error al rechazar'); }
}

window.ccAceptarInvitacion  = ccAceptarInvitacion;
window.ccRechazarInvitacion = ccRechazarInvitacion;

function ccRenderPersonas() {
  const g = ccGrupoActual();
  const cont = document.getElementById('cc-personas');
  const select = document.getElementById('cc-pagadoPor');
  cont.innerHTML = g.personas.length === 0
    ? '<p style="color:var(--text3);font-size:0.8rem">Agregá personas para empezar.</p>'
    : g.personas.map(p => `
        <span class="cc-persona-chip">
          ${escHtml(p)}
          <button class="pc-del" onclick="ccPedirBorrarPersona('${escHtml(p)}')" title="Eliminar">✕</button>
        </span>`).join('');
  select.innerHTML = g.personas.map(p => `<option>${escHtml(p)}</option>`).join('');
}

function ccAgregarPersona() {
  const input = document.getElementById('cc-nuevoNombre');
  const nombre = input.value.trim();
  if (!nombre) return;
  const g = ccGrupoActual();
  if (g.personas.includes(nombre)) { alert('Ya existe esa persona.'); return; }
  g.personas.push(nombre);
  input.value = '';
  ccGuardar();
  ccRenderPersonas();
  ccCalcular();
}

function ccPedirBorrarPersona(nombre) {
  ccPendienteBorrarPersona = nombre;
  document.getElementById('cc-modal-borrar-persona-msg').textContent = `¿Eliminar a "${nombre}"? Se eliminarán también todos sus gastos registrados.`;
  document.getElementById('cc-modal-borrar-persona').classList.add('show');
}

function ccConfirmarBorrarPersona() {
  const g = ccGrupoActual();
  g.gastos = g.gastos.filter(x => x.pagadoPor !== ccPendienteBorrarPersona);
  g.personas = g.personas.filter(p => p !== ccPendienteBorrarPersona);
  ccPendienteBorrarPersona = null;
  ccGuardar();
  ccCerrarModal();
  ccRenderPersonas();
  ccRenderHistorial();
  ccCalcular();
}

function ccAgregarGasto() {
  const g = ccGrupoActual();
  if (g.personas.length < 2) { alert('Agregá al menos 2 personas primero.'); return; }
  const pagadoPor = document.getElementById('cc-pagadoPor').value;
  const descripcion = document.getElementById('cc-descripcion').value.trim();
  const monto = parseFloat(document.getElementById('cc-monto').value);
  if (!descripcion || !monto || monto <= 0) return;
  g.gastos.push({ id: Date.now().toString(), pagadoPor, descripcion, monto });
  document.getElementById('cc-descripcion').value = '';
  document.getElementById('cc-monto').value = '';
  ccGuardar();
  ccRenderHistorial();
  ccCalcular();
}

function ccBorrarGasto(id) {
  const g = ccGrupoActual();
  g.gastos = g.gastos.filter(x => x.id !== id);
  ccGuardar();
  ccRenderHistorial();
  ccCalcular();
}

function ccAbrirEditarGasto(id) {
  const g = ccGrupoActual();
  const gasto = g.gastos.find(x => x.id === id);
  if (!gasto) return;
  ccGastoEditandoId = id;
  const sel = document.getElementById('cc-edit-pagadoPor');
  sel.innerHTML = g.personas.map(p => `<option${p === gasto.pagadoPor ? ' selected' : ''}>${escHtml(p)}</option>`).join('');
  document.getElementById('cc-edit-descripcion').value = gasto.descripcion;
  document.getElementById('cc-edit-monto').value = gasto.monto;
  document.getElementById('cc-modal-editar-gasto').classList.add('show');
}

function ccConfirmarEditarGasto() {
  const g = ccGrupoActual();
  const gasto = g.gastos.find(x => x.id === ccGastoEditandoId);
  if (!gasto) return;
  const pagadoPor = document.getElementById('cc-edit-pagadoPor').value;
  const descripcion = document.getElementById('cc-edit-descripcion').value.trim();
  const monto = parseFloat(document.getElementById('cc-edit-monto').value);
  if (!descripcion || !monto || monto <= 0) return;
  gasto.pagadoPor = pagadoPor;
  gasto.descripcion = descripcion;
  gasto.monto = monto;
  ccGastoEditandoId = null;
  ccGuardar();
  ccCerrarModal();
  ccRenderHistorial();
  ccCalcular();
}

function ccRenderHistorial() {
  const g = ccGrupoActual();
  const div = document.getElementById('cc-panel-historial');
  if (g.gastos.length === 0) {
    div.innerHTML = '<div class="panel-empty">No hay gastos aún.</div>';
    return;
  }
  div.innerHTML = g.gastos.slice().reverse().map(x => `
    <div class="cc-gasto-row">
      <div class="cg-info">
        <div class="cg-desc">${escHtml(x.descripcion)}</div>
        <div class="cg-sub">${escHtml(x.pagadoPor)}</div>
      </div>
      <div class="cg-monto">$${fmt(x.monto)}</div>
      <div class="cg-actions">
        <button class="btn-edit" onclick="ccAbrirEditarGasto('${x.id}')" title="Editar">✏️</button>
        <button class="btn-del" onclick="ccBorrarGasto('${x.id}')" title="Borrar">🗑</button>
      </div>
    </div>`).join('');
}

function ccCalcular() {
  const g = ccGrupoActual();
  const divBal = document.getElementById('cc-panel-balance');
  const divTrans = document.getElementById('cc-panel-transferencias');

  if (g.personas.length === 0) {
    divBal.innerHTML = '<div class="panel-empty">Agregá personas para ver el balance.</div>';
    divTrans.innerHTML = '';
    return;
  }

  let total = 0;
  let aportes = {};
  g.personas.forEach(p => aportes[p] = 0);
  g.gastos.forEach(x => {
    total += x.monto;
    if (aportes[x.pagadoPor] !== undefined) aportes[x.pagadoPor] += x.monto;
  });

  const porPersona = total / g.personas.length;

  let htmlBal = `<div style="font-weight:700;color:var(--text2);margin-bottom:.8rem">Total: $${fmt(total)}</div>`;
  g.personas.forEach(p => {
    const bal = aportes[p] - porPersona;
    const cls = bal > 0.005 ? 'pos' : bal < -0.005 ? 'neg' : 'cero';
    const txt = bal > 0.005 ? `puso $${fmt(bal)} de más`
               : bal < -0.005 ? `debe $${fmt(Math.abs(bal))}`
               : 'está al día';
    htmlBal += `<div class="cc-balance-row ${cls}"><span class="cb-nombre">${escHtml(p)}</span><span class="cb-monto">${txt}</span></div>`;
  });
  divBal.innerHTML = htmlBal;

  const transferencias = ccCalcularTransferencias(g.personas, aportes, porPersona);
  if (transferencias.length === 0) {
    divTrans.innerHTML = '<div class="panel-empty">Todos están al día. ¡No hay nada que saldar!</div>';
  } else {
    divTrans.innerHTML = transferencias.map(t => `
      <div class="cc-transfer-row">
        <span class="ct-nombre">${escHtml(t.de)}</span>
        <span class="ct-arrow">→</span>
        <span class="ct-nombre">${escHtml(t.a)}</span>
        <span class="ct-monto">$${fmt(t.monto)}</span>
      </div>`).join('');
  }
}

function ccCalcularTransferencias(personas, aportes, porPersona) {
  let saldos = personas.map(p => ({ nombre: p, saldo: aportes[p] - porPersona }));
  const EPS = 0.005;
  let resultado = [];

  let deudores = saldos.filter(s => s.saldo < -EPS).map(s => ({ ...s, saldo: -s.saldo }));
  let acreedores = saldos.filter(s => s.saldo > EPS);

  deudores.sort((a, b) => b.saldo - a.saldo);
  acreedores.sort((a, b) => b.saldo - a.saldo);

  let i = 0, j = 0;
  while (i < deudores.length && j < acreedores.length) {
    const pagar = deudores[i].saldo;
    const cobrar = acreedores[j].saldo;
    const monto = Math.min(pagar, cobrar);
    if (monto > EPS) {
      resultado.push({ de: deudores[i].nombre, a: acreedores[j].nombre, monto });
    }
    deudores[i].saldo -= monto;
    acreedores[j].saldo -= monto;
    if (deudores[i].saldo <= EPS) i++;
    if (acreedores[j].saldo <= EPS) j++;
  }
  return resultado;
}

function ccMostrarTab(nombre, btn) {
  ['balance', 'transferencias', 'historial'].forEach(t => {
    const panel = document.getElementById('cc-panel-' + t);
    if (panel) panel.style.display = (t === nombre ? '' : 'none');
  });
  document.querySelectorAll('[id^="cc-tab-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}

function ccCerrarModal() {
  document.querySelectorAll('[id^="cc-modal-"]').forEach(m => m.classList.remove('show'));
}

function ccAbrirModalPDF() {
  const g = ccGrupoActual();
  if (g.personas.length === 0) { alert('No hay personas en el grupo.'); return; }
  const form = document.getElementById('cc-pdf-personas-form');
  form.innerHTML = g.personas.map(p => `
    <div class="form-group" style="margin-bottom:10px">
      <label>${escHtml(p)}</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input type="text" id="cc-pdf-alias-${escHtml(p)}" placeholder="CVU o alias (opcional)" style="flex:1;min-width:120px">
        <input type="text" id="cc-pdf-titular-${escHtml(p)}" placeholder="Nombre del titular (opcional)" style="flex:1;min-width:120px">
      </div>
    </div>`).join('');
  document.getElementById('cc-modal-pdf').classList.add('show');
}

function ccGenerarPDF() {
  const g = ccGrupoActual();
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const W = 210, M = 18;
  const verde = [31, 122, 92];
  const grisOscuro = [40, 40, 40];
  const grisMedio = [100, 100, 100];
  const grisClaro = [240, 242, 245];
  const rojo = [192, 57, 43];
  const fecha = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });

  const bancarios = {};
  g.personas.forEach(p => {
    bancarios[p] = {
      alias: document.getElementById(`cc-pdf-alias-${p}`)?.value.trim() || '',
      titular: document.getElementById(`cc-pdf-titular-${p}`)?.value.trim() || ''
    };
  });

  let total = 0, aportes = {};
  g.personas.forEach(p => aportes[p] = 0);
  g.gastos.forEach(x => { total += x.monto; if (aportes[x.pagadoPor] !== undefined) aportes[x.pagadoPor] += x.monto; });
  const porPersona = total / g.personas.length;
  const transferencias = ccCalcularTransferencias(g.personas, aportes, porPersona);

  let y = 0;

  doc.setFillColor(...verde);
  doc.rect(0, 0, W, 36, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Cuenta Clara', M, 16);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Resumen de gastos - ${g.nombre}`, M, 24);
  doc.text(`Generado el ${fecha}`, M, 30);
  y = 46;

  doc.setFillColor(...grisClaro);
  doc.roundedRect(M, y, W - M * 2, 16, 3, 3, 'F');
  doc.setTextColor(...grisOscuro);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Total gastado:', M + 6, y + 10);
  doc.setTextColor(...verde);
  doc.setFontSize(13);
  doc.text(`$${total.toFixed(2)}`, W - M - 2, y + 10, { align: 'right' });
  doc.setTextColor(...grisMedio);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`$${porPersona.toFixed(2)} por persona (${g.personas.length} personas)`, W - M - 2, y + 10 + 5, { align: 'right' });
  y += 26;

  doc.setTextColor(...grisOscuro);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Balance por persona', M, y);
  y += 6;
  doc.setDrawColor(220, 220, 220);
  doc.line(M, y, W - M, y);
  y += 5;

  g.personas.forEach(p => {
    const bal = aportes[p] - porPersona;
    const esPos = bal > 0.005, esNeg = bal < -0.005;
    const txt = esPos ? `puso $${bal.toFixed(2)} de mas` : esNeg ? `debe $${Math.abs(bal).toFixed(2)}` : 'esta al dia';
    const color = esPos ? verde : esNeg ? rojo : grisMedio;

    doc.setFillColor(esPos ? 234 : esNeg ? 255 : 245, esPos ? 247 : esNeg ? 240 : 245, esPos ? 241 : esNeg ? 240 : 245);
    doc.roundedRect(M, y, W - M * 2, 14, 2, 2, 'F');
    doc.setTextColor(...grisOscuro);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(p, M + 4, y + 9);
    doc.setTextColor(...color);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.text(txt, W - M - 4, y + 9, { align: 'right' });
    y += 17;
  });
  y += 4;

  doc.setTextColor(...grisOscuro);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Como saldar las deudas', M, y);
  y += 6;
  doc.setDrawColor(220, 220, 220);
  doc.line(M, y, W - M, y);
  y += 5;

  if (transferencias.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(10);
    doc.setTextColor(...grisMedio);
    doc.text('Todos estan al dia. No hay nada que saldar.', M, y + 6);
    y += 14;
  } else {
    transferencias.forEach(t => {
      const banco = bancarios[t.a];
      const tieneInfo = banco && (banco.alias || banco.titular);
      const alto = tieneInfo ? 22 : 14;

      doc.setFillColor(245, 255, 250);
      doc.setDrawColor(...verde);
      doc.roundedRect(M, y, W - M * 2, alto, 2, 2, 'FD');

      doc.setTextColor(...grisOscuro);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(`${t.de}  ->  ${t.a}`, M + 4, y + 9);
      doc.setTextColor(...verde);
      doc.setFontSize(12);
      doc.text(`$${t.monto.toFixed(2)}`, W - M - 4, y + 9, { align: 'right' });

      if (tieneInfo) {
        doc.setTextColor(...grisMedio);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        let infoTxt = '';
        if (banco.alias) infoTxt += `CVU/Alias: ${banco.alias}`;
        if (banco.titular) infoTxt += `${banco.alias ? ' - ' : ''}A nombre de: ${banco.titular}`;
        doc.text(infoTxt, M + 4, y + 17);
      }
      y += alto + 5;
    });
  }
  y += 4;

  const conDatos = g.personas.filter(p => bancarios[p] && (bancarios[p].alias || bancarios[p].titular));
  if (conDatos.length > 0) {
    doc.setTextColor(...grisOscuro);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Datos bancarios', M, y);
    y += 6;
    doc.setDrawColor(220, 220, 220);
    doc.line(M, y, W - M, y);
    y += 5;

    conDatos.forEach(p => {
      const b = bancarios[p];
      doc.setFillColor(...grisClaro);
      doc.roundedRect(M, y, W - M * 2, 18, 2, 2, 'F');
      doc.setTextColor(...verde);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(p, M + 4, y + 8);
      doc.setTextColor(...grisOscuro);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      if (b.alias) doc.text(`CVU/Alias: ${b.alias}`, M + 4, y + 15);
      if (b.titular) {
        const xTit = b.alias ? W - M - 4 : M + 4;
        const anchor = b.alias ? 'right' : 'left';
        doc.text(`A nombre de: ${b.titular}`, xTit, y + 15, { align: anchor });
      }
      y += 22;
    });
    y += 4;
  }

  if (g.gastos.length > 0) {
    const espacioNecesario = 11 + 8 + g.gastos.length * 7 + 20;
    const espacioDisponible = 277 - y;
    if (espacioDisponible < Math.min(espacioNecesario, 60)) {
      doc.addPage(); y = 20;
    }
    doc.setTextColor(...grisOscuro);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text('Historial de gastos', M, y);
    y += 6;
    doc.setDrawColor(220, 220, 220);
    doc.line(M, y, W - M, y);
    y += 5;

    doc.setFillColor(...verde);
    doc.rect(M, y, W - M * 2, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Pago', M + 3, y + 5.5);
    doc.text('Descripcion', M + 38, y + 5.5);
    doc.text('Monto', W - M - 3, y + 5.5, { align: 'right' });
    y += 8;

    g.gastos.forEach((x, i) => {
      if (y > 270) { doc.addPage(); y = 20; }
      if (i % 2 === 0) { doc.setFillColor(248, 250, 252); doc.rect(M, y, W - M * 2, 7, 'F'); }
      doc.setTextColor(...grisOscuro);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(x.pagadoPor.substring(0, 14), M + 3, y + 5);
      doc.setFont('helvetica', 'normal');
      doc.text(x.descripcion.substring(0, 32), M + 38, y + 5);
      doc.setTextColor(...verde);
      doc.setFont('helvetica', 'bold');
      doc.text(`$${x.monto.toFixed(2)}`, W - M - 3, y + 5, { align: 'right' });
      y += 7;
    });
  }

  const totalPags = doc.getNumberOfPages();
  for (let i = 1; i <= totalPags; i++) {
    doc.setPage(i);
    doc.setTextColor(...grisMedio);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text('Generado con Cuenta Clara', M, 292);
    doc.text(`Pagina ${i} de ${totalPags}`, W - M, 292, { align: 'right' });
  }

  const nombreArchivo = `CuentaClara_${g.nombre.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(nombreArchivo);
  ccCerrarModal();
}

// ---- UI ----
function showTab(tab) {
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  const tabEl = document.getElementById('tab-' + tab);
  if (!tabEl) return;
  tabEl.classList.add('active');
  tabEl.style.animation = 'none';
  tabEl.offsetHeight; // force reflow
  tabEl.style.animation = '';
  const btn = document.querySelector(`nav button[onclick="showTab('${tab}')"]`);
  if (btn) {
    btn.classList.add('active');
    // Mover el pill indicador al botón activo (no en el botón especial nav-add)
    const pill = document.getElementById('nav-pill');
    if (pill) {
      if (btn.classList.contains('nav-add')) {
        pill.style.opacity = '0';
      } else {
        pill.style.opacity = '1';
        const nav = btn.closest('nav');
        const navRect = nav.getBoundingClientRect();
        const btnRect = btn.getBoundingClientRect();
        pill.style.width = btnRect.width + 'px';
        pill.style.transform = `translateX(${btnRect.left - navRect.left}px) translateY(-50%)`;
      }
    }
  }
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'gastos') { renderGastosTable(); populateFilters(); }
  if (tab === 'ingresos') { renderIngresosTable(); renderDestinosIngreso(); renderSaldoCuentas(); renderAjustesHistorial(); }
  if (tab === 'ahorro') { renderAhorroTable(); renderOrigenAhorro(); }
  if (tab === 'pendientes') renderPendientesTab();
  if (tab === 'admin') renderAdminPanel();
  if (tab === 'ajustes') { renderTarjetas(); renderSaldoInicial(); }
  if (tab === 'gastos') renderMedioPago();
}

function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern || 50);
}

function notify(msg) {
  const el = $('notif');
  $('notif-msg').textContent = msg;
  el.classList.remove('notif-error', 'notif-warn');
  if (msg.startsWith('⚠') || msg.startsWith('✗') || msg.startsWith('Error')) {
    el.classList.add('notif-error');
    haptic([30, 60, 30]); // patrón de error
  } else if (msg.startsWith('⚡') || msg.startsWith('ℹ')) {
    el.classList.add('notif-warn');
  } else if (msg.startsWith('✓')) {
    haptic(50); // pulso suave de confirmación
  }
  el.classList.remove('show');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('show')));
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

function toggleCuotas() {
  // no-op: el toggle fue eliminado, la lógica la maneja toggleCuotasIfNeeded
}

function onMedioChange() {
  toggleCuotasIfNeeded();
}

function updateCreditoOffsetWrap() {
  // no-op: eliminado junto con fecha de cierre
}

// Muestra N° Cuotas y ¿Cuándo cae la 1ª cuota? automáticamente cuando se selecciona tarjeta de crédito
function toggleCuotasIfNeeded() {
  const medio = $('g-medio')?.value || '';
  const moneda = $('g-moneda')?.value || 'ARS';
  const esTarjetaCredito = moneda === 'ARS' && tarjetas.some(t =>
    (t.tipo || 'credito') === 'credito' && medio === (t.label || t.nombre)
  );
  $('g-ncuotas-wrap').style.display = esTarjetaCredito ? 'flex' : 'none';
  $('g-cerro-wrap').style.display  = esTarjetaCredito ? 'flex' : 'none';
  if (!esTarjetaCredito && $('g-ncuotas')) $('g-ncuotas').value = '';
}

function toggleOtro(selectId, inputId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  const isOtro = sel.value === 'Otros' || sel.value === 'Otro';
  inp.style.display = isOtro ? 'block' : 'none';
  if (isOtro) inp.focus();
  else inp.value = '';
}

function resolveOtro(selectId, inputId) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  const isNueva = sel.value === '__nueva__';
  if (isNueva) return inp.value.trim() || '';
  return sel.value;
}

// Guarda la categoría nueva si no existe, y actualiza el select
function autoSaveNewCat(valor, tipo) {
  if (!valor || cats[tipo].includes(valor)) return;
  cats[tipo].push(valor);
  saveCats(tipo);
  initCatSelects();
}

// ---- GASTOS ----
function addGasto() {
  const fecha = $('g-fecha').value;
  const desc  = $('g-desc').value.trim();
  const cat   = resolveOtro('g-cat', 'g-cat-otro');
  const medio = $('g-medio')?.value || '';
  const moneda = $('g-moneda')?.value || 'ARS';
  const monto = parseFloat($('g-monto').value);
  const ncuotas = parseInt($('g-ncuotas').value) || 1;
  const esCredito = moneda === 'ARS' && tarjetas.some(t =>
    (t.tipo || 'credito') === 'credito' && medio === (t.label || t.nombre)
  );
  const cuota = esCredito && ncuotas > 1;
  // Calcular offset: cuántos meses entre la fecha del gasto y la 1ª cuota
  let offsetCuotas = 0;
  if (esCredito) {
    const mesGasto  = fecha.slice(0, 7);
    const mesActual = new Date().toISOString().slice(0, 7);
    const esGastoPasado = mesGasto < mesActual;
    if (esGastoPasado) {
      offsetCuotas = 1;
    } else {
      const radioVal = document.querySelector('input[name="g-cuota-inicio"]:checked')?.value;
      offsetCuotas = radioVal === 'proximo' ? 1 : 0;
    }
  }
  const notas = $('g-notas').value.trim();
  const recurrente = $('g-recurrente')?.checked || false;

  if (!fecha || !desc || !cat || !monto || monto <= 0) {
    notify('⚠ Completá fecha, descripción, categoría y monto');
    return;
  }

  const mes = MESES[parseInt(fecha.slice(5,7)) - 1];
  const montoXcuota = cuota ? +(monto / ncuotas).toFixed(2) : monto;

  // Si la categoría es nueva, guardarla automáticamente
  autoSaveNewCat(cat, 'gastos');

  _newRowId = Date.now();
  const nuevoGasto = { id: _newRowId, fecha, desc, cat, medio, monto, moneda, cuota, ncuotas: cuota ? ncuotas : 1, montoXcuota, mes, notas, offsetCuotas };
  if (recurrente) nuevoGasto.recurrente = true;

  // Si estaba confirmando un recurrente, registrar el mes confirmado
  if (window._confirmandoRecurrenteId) {
    const orig = gastos.find(g => g.id === window._confirmandoRecurrenteId);
    if (orig) {
      if (!orig.confirmadosMeses) orig.confirmadosMeses = [];
      const mesActual = new Date().toISOString().slice(0,7);
      if (!orig.confirmadosMeses.includes(mesActual)) orig.confirmadosMeses.push(mesActual);
    }
    window._confirmandoRecurrenteId = null;
  }

  gastos.push(nuevoGasto);
  save();
  notify(recurrente ? '✓ Gasto recurrente guardado' : 'Gasto agregado correctamente');

  // reset
  ['g-desc','g-notas','g-cat-otro','g-monto'].forEach(id => document.getElementById(id).value = '');
  $('g-cat-otro').style.display = 'none';
  if ($('g-moneda')) $('g-moneda').value = 'ARS';
  if ($('g-ncuotas')) $('g-ncuotas').value = '';
  // Re-evaluar visibilidad de campos según el medio seleccionado
  toggleCuotasIfNeeded();
  // Resetear radio a "Este mes"
  const radioEste = $('g-cerro');
  if (radioEste) radioEste.checked = true;
  if ($('g-recurrente')) $('g-recurrente').checked = false;
  renderGastosTable();
  requestAnimationFrame(() => {
    const row = document.getElementById('gasto-row-' + _newRowId);
    if (row) { row.classList.add('row-new'); row.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    _newRowId = null;
  });
}

function deleteGasto(id) {
  if (!confirm('¿Eliminar este gasto?')) return;
  gastos = gastos.filter(g => g.id !== id);
  save({ skipMerge: true });
  notify('Gasto eliminado');
  renderGastosTable();
  renderDashboard();
}

function clearGastoSearch() {
  const inp = $('gasto-search');
  if (inp) inp.value = '';
  const btn = $('gasto-search-clear');
  if (btn) btn.style.display = 'none';
  renderGastosTable();
}


// ---- GASTOS RECURRENTES (nueva versión) ----

function abrirNuevoRecurrente() {
  const f = $('nuevo-recurrente-form');
  if (!f) return;
  // Pre-cargar selects de cat y medio
  const catSel = $('rec-cat-nuevo');
  if (catSel) {
    catSel.innerHTML = '<option value="">Seleccionar...</option>' +
      (cats.gastos || []).map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  }
  const medioSel = $('rec-medio-nuevo');
  if (medioSel) {
    medioSel.innerHTML = '<option value="">Seleccionar...</option><option value="Efectivo">💵 Efectivo</option>' +
      tarjetas.map(t => { const l = t.label||t.banco||t.nombre; return `<option value="${escHtml(l)}">${escHtml(l)}</option>`; }).join('');
  }
  // Default: mes actual
  const mesEl = $('rec-mes-nuevo');
  if (mesEl) mesEl.value = new Date().toISOString().slice(0,7);
  f.style.display = '';
  setTimeout(() => $('rec-nombre-nuevo')?.focus(), 50);
}

function cerrarNuevoRecurrente() {
  const f = $('nuevo-recurrente-form');
  if (f) f.style.display = 'none';
  ['rec-nombre-nuevo','rec-monto-nuevo','rec-notas-nuevo'].forEach(id => { const el = $(id); if (el) el.value = ''; });
}

function crearRecurrente() {
  const nombre = ($('rec-nombre-nuevo')?.value || '').trim();
  const mes    = $('rec-mes-nuevo')?.value || new Date().toISOString().slice(0,7);
  const monto  = parseFloat($('rec-monto-nuevo')?.value) || 0;
  const moneda = $('rec-moneda-nuevo')?.value || 'ARS';
  const cat    = $('rec-cat-nuevo')?.value || '';
  const medio  = $('rec-medio-nuevo')?.value || '';
  const notas  = $('rec-notas-nuevo')?.value.trim() || '';

  if (!nombre) { notify('⚠ Ingresá un nombre'); return; }
  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto'); return; }
  if (!cat) { notify('⚠ Seleccioná una categoría'); return; }

  const gastoId = Date.now();
  const recId   = gastoId + 1;

  // Crear el primer gasto
  const mesNum = parseInt(mes.slice(5,7));
  gastos.push({
    id: gastoId, fecha: `${mes}-01`,
    desc: nombre, cat, medio, monto, moneda, notas,
    recurrenteId: recId
  });

  // Crear el recurrente con el primer mes ya registrado
  recurrentes.push({
    id: recId, nombre, monto, cat, medio, moneda, notas,
    mesesActivos: { [mes]: gastoId }
  });

  cerrarNuevoRecurrente();
  save();
  renderRecurrentesLista();
  renderGastosTable();
  notify(`✓ "${nombre}" creado — gasto de ${MESES[mesNum-1]} agregado`);
}

function renderRecurrentesLista() {
  const el = $('recurrentes-lista-nueva');
  if (!el) return;
  if (!recurrentes.length) {
    el.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text3);font-size:0.85rem">No hay gastos recurrentes. Tocá + Nuevo para crear uno.</div>`;
    return;
  }
  // Mes actual + próximos 5
  const meses = [];
  const hoy = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() + i, 1);
    meses.push(d.toISOString().slice(0,7));
  }

  el.innerHTML = recurrentes.map(r => {
    const mesActual = hoy.toISOString().slice(0,7);
    const switchesMes = meses.map(mes => {
      const activo = !!r.mesesActivos?.[mes];
      const label = MESES[parseInt(mes.slice(5,7))-1].slice(0,3);
      const esActual = mes === mesActual;
      return `<div class="rec-mes-item">
        <span class="rec-mes-label" style="${esActual?'color:var(--accent);font-weight:700':''}">${label}</span>
        <label class="toggle-switch" style="transform:scale(0.8)">
          <input type="checkbox" onchange="toggleMesRecurrente(${r.id},'${mes}',this.checked)"${activo?' checked':''}>
          <span class="toggle-track"></span>
        </label>
      </div>`;
    }).join('');

    const info = [r.cat, r.medio].filter(Boolean).join(' · ');

    return `<div class="rec-card" id="rec-card-${r.id}">
      <div class="rec-card-header" onclick="toggleRecurrenteCard(${r.id})">
        <div>
          <div class="rec-card-nombre">${escHtml(r.nombre)}</div>
          ${info ? `<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">${escHtml(info)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${r.monto ? `<span style="font-family:'DM Mono',monospace;font-size:0.85rem;color:var(--accent)">${r.moneda==='USD'?'u$s ':'$'}${fmt(r.monto)}</span>` : ''}
          <span class="rec-card-arrow" id="rec-arrow-${r.id}">›</span>
        </div>
      </div>
      <div class="rec-card-body" id="rec-body-${r.id}" style="display:none">
        <div style="font-size:0.72rem;color:var(--text3);margin-bottom:8px">Activar o desactivar por mes:</div>
        <div class="rec-meses-row">${switchesMes}</div>
        <div style="display:flex;justify-content:flex-end;padding:10px 0 4px">
          <button class="btn-del" style="font-size:0.78rem;padding:5px 12px" onclick="eliminarRecurrente(${r.id})">✕ Eliminar</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleRecurrenteCard(id) {
  const body  = $(`rec-body-${id}`);
  const arrow = $(`rec-arrow-${id}`);
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display  = open ? 'none' : '';
  if (arrow) arrow.style.transform = open ? '' : 'rotate(90deg)';
}

function guardarCamposRecurrente(id) {
  const r = recurrentes.find(x => x.id === id);
  if (!r) return;
  r.monto  = parseFloat(document.getElementById(`rec-f-monto-${id}`)?.value) || 0;
  r.moneda = document.getElementById(`rec-f-moneda-${id}`)?.value || 'ARS';
  r.cat    = document.getElementById(`rec-f-cat-${id}`)?.value || '';
  r.medio  = document.getElementById(`rec-f-medio-${id}`)?.value || '';
  r.notas  = document.getElementById(`rec-f-notas-${id}`)?.value || '';
  save();
  // Actualizar header sin re-renderizar todo
  const montoEl = document.querySelector(`#rec-card-${id} .rec-card-header span[style*="DM Mono"]`);
  // Re-render la lista para reflejar monto en header
  renderRecurrentesLista();
  // Reabrir la card que estábamos editando
  const body = $(`rec-body-${id}`);
  if (body) body.style.display = '';
  const arrow = $(`rec-arrow-${id}`);
  if (arrow) arrow.style.transform = 'rotate(90deg)';
  notify('✓ Cambios guardados');
}

function actualizarRecurrente(id, campo, valor) {
  const r = recurrentes.find(x => x.id === id);
  if (!r) return;
  r[campo] = valor;
  save();
}

function toggleMesRecurrente(id, mes, activo) {
  const r = recurrentes.find(x => x.id === id);
  if (!r) return;
  if (!r.mesesActivos) r.mesesActivos = {};

  if (activo) {
    const mesNombre = MESES[parseInt(mes.slice(5,7)) - 1];
    const montoStr = prompt(`Monto de "${r.nombre}" en ${mesNombre}:`, r.monto || '');
    if (montoStr === null) {
      // Usuario canceló — restaurar el estado visual
      renderRecurrentesLista();
      const body = $(`rec-body-${id}`);
      if (body) body.style.display = '';
      const arrow = $(`rec-arrow-${id}`);
      if (arrow) arrow.style.transform = 'rotate(90deg)';
      return;
    }
    const monto = parseFloat(String(montoStr).replace(',', '.'));
    if (isNaN(monto) || monto <= 0) {
      notify('⚠ Monto inválido');
      renderRecurrentesLista();
      const body = $(`rec-body-${id}`);
      if (body) body.style.display = '';
      const arrow = $(`rec-arrow-${id}`);
      if (arrow) arrow.style.transform = 'rotate(90deg)';
      return;
    }
    const nuevoId = Date.now();
    gastos.push({
      id: nuevoId, fecha: `${mes}-01`, desc: r.nombre,
      cat: r.cat || '', medio: r.medio || '',
      monto, moneda: r.moneda || 'ARS', notas: r.notas || '',
      recurrenteId: id
    });
    r.mesesActivos[mes] = nuevoId;
    notify(`✓ "${r.nombre}" $${fmt(monto)} agregado en ${mesNombre}`);
  } else {
    const gastoId = r.mesesActivos[mes];
    if (gastoId) gastos = gastos.filter(g => g.id !== gastoId);
    delete r.mesesActivos[mes];
    notify(`Gasto de ${MESES[parseInt(mes.slice(5,7))-1]} eliminado`);
  }
  save();
  renderGastosTable();
}

function eliminarRecurrente(id) {
  const r = recurrentes.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`¿Eliminar "${r.nombre}" y todos sus gastos generados?`)) return;
  // Eliminar gastos generados por este recurrente
  const ids = new Set(Object.values(r.mesesActivos || {}));
  if (ids.size) gastos = gastos.filter(g => !ids.has(g.id));
  recurrentes = recurrentes.filter(x => x.id !== id);
  save({ skipMerge: true });
  renderRecurrentesLista();
  renderGastosTable();
  notify('Recurrente eliminado');
}

function filterGastosCat(cat) {
  if (cat === '') { _gastosCatChip = new Set(); }
  else if (_gastosCatChip.has(cat)) { _gastosCatChip.delete(cat); }
  else { _gastosCatChip.add(cat); }
  renderGastosTable();
}

function navMes(dir) {
  // Lista lineal: [mes más antiguo, ..., mes actual, ''] — '' es "Todos" al final derecho
  const meses = [...new Set(gastos.map(g => g.fecha.slice(0,7)))].sort();
  if (!meses.length) return;
  const lista = [...meses, '']; // '' = Todos al final
  const idx = lista.indexOf(_mesFiltro);
  const next = idx + dir;
  if (next < 0 || next >= lista.length) return; // no hacer nada en los extremos
  _mesFiltro = lista[next];
  _gastosCatChip = new Set();
  const scrollY = window.scrollY;
  renderGastosTable();
  window.scrollTo({ top: scrollY, behavior: 'instant' });
}

function renderGastosTable() {
  const el = $('gastos-table-body');
  if (!el) return;
  const mesFiltro  = _mesFiltro;
  const catFiltro  = $('filter-cat')?.value  || '';
  const query      = ($('gasto-search')?.value || '').toLowerCase().trim();
  const clearBtn   = $('gasto-search-clear');
  if (clearBtn) clearBtn.style.display = query ? 'block' : 'none';

  // Actualizar label del navegador de mes
  const navLabel = $('mes-nav-label');
  if (navLabel) {
    navLabel.textContent = mesFiltro
      ? `${MESES[parseInt(mesFiltro.slice(5,7))-1]} ${mesFiltro.slice(0,4)}`
      : 'Todos los meses';
  }

  let rows = [...gastos].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (mesFiltro) rows = rows.filter(g => g.fecha.slice(0,7) === mesFiltro);
  if (catFiltro) rows = rows.filter(g => g.cat === catFiltro);

  // Renderizar chips de categoría con las cats presentes en rows
  const chipsEl = $('cat-chips');
  if (chipsEl) {
    const cats = [...new Set(rows.map(g => g.cat).filter(Boolean))].sort();
    if (cats.length > 1) {
      chipsEl.innerHTML = `<div class="cat-chips-row">` +
        cats.map(cat => {
          const color = catColor(cat);
          const active = _gastosCatChip.has(cat);
          return `<button class="cat-chip${active ? ' active' : ''}" style="--chip-color:${color}" onclick="filterGastosCat('${cat.replace(/'/g,"\\'")}')">
            ${escHtml(cat)}
          </button>`;
        }).join('') +
        (_gastosCatChip.size > 0 ? `<button class="cat-chip-clear" onclick="filterGastosCat('')">✕ Limpiar</button>` : '') +
        `</div>`;
    } else {
      chipsEl.innerHTML = '';
    }
  }

  // Aplicar filtro de chip
  if (_gastosCatChip.size > 0) rows = rows.filter(g => _gastosCatChip.has(g.cat));

  if (query) rows = rows.filter(g =>
    (g.concepto || '').toLowerCase().includes(query) ||
    (g.cat      || '').toLowerCase().includes(query) ||
    (g.notas    || '').toLowerCase().includes(query) ||
    String(g.monto || '').includes(query)
  );
  if (!rows.length) {
    el.innerHTML = (_gastosCatChip.size > 0 || query)
      ? emptyState('chart', 'Sin resultados', 'No hay gastos que coincidan con el filtro')
      : emptyState('gastos', 'Sin gastos registrados', 'Tocá + Gasto para agregar el primero');
    return;
  }
  const isMobile = window.innerWidth < 600;

  if (isMobile) {
    el.innerHTML = '<div class="gasto-cards">' +
      rows.map(g => `
        <div class="gasto-card row-new-wrap" id="gasto-row-${g.id}">
          <div class="gasto-card-border" style="background:${catColor(g.cat)}"></div>
          <div class="gasto-card-body">
            <div class="gasto-card-top">
              <span class="gasto-card-desc">${escHtml(g.desc)}</span>
              <span class="gasto-card-monto${g.moneda==='USD' ? ' usd' : ''}">${g.moneda==='USD' ? 'u$s ' : '$'}${fmt(g.monto)}</span>
            </div>
            <div class="gasto-card-meta">
              <span class="badge badge-cat" style="background:${catColor(g.cat)}22;color:${catColor(g.cat)}">${escHtml(g.cat)}</span>
              ${g.medio ? `<span class="badge badge-medio">${escHtml(g.medio)}</span>` : ''}
              ${g.cuota ? `<span class="badge badge-cuota">${g.ncuotas}x $${fmt(g.montoXcuota)}</span>` : ''}
              <span class="gasto-card-fecha">${g.fecha.slice(5).replace('-','/')}</span>
            </div>
            ${g.notas ? `<div class="gasto-card-notas">${escHtml(g.notas)}</div>` : ''}
          </div>
          <div class="gasto-card-actions">
            <button class="btn-edit" onclick="openEditGastoModal(${g.id})">✏</button>
            <button class="btn-del" onclick="deleteGasto(${g.id})">✕</button>
          </div>
        </div>`).join('') +
      '</div>';
  } else {
    el.innerHTML = `<table class="panel-table"><thead><tr>
      <th>Fecha</th><th>Descripción</th>
      <th>Categoría</th>
      <th>Medio</th>
      <th>Monto</th>
      <th>Cuotas</th>
      <th>Notas</th>
      <th></th>
    </tr></thead><tbody>` +
    rows.map(g => `
      <tr id="gasto-row-${g.id}">
        <td style="color:var(--text3);font-size:0.8rem;white-space:nowrap">${g.fecha}</td>
        <td><div style="font-weight:600;color:var(--text2)">${escHtml(g.desc)}</div></td>
        <td><span class="badge badge-cat" style="background:${catColor(g.cat)}22;color:${catColor(g.cat)}">${escHtml(g.cat)}</span></td>
        <td><span class="badge badge-medio">${escHtml(g.medio || '—')}</span></td>
        <td class="monto" style="white-space:nowrap${g.moneda==='USD' ? ';color:var(--accent3)' : ''}">${g.moneda==='USD' ? 'u$s ' : '$'}${fmt(g.monto)}</td>
        <td>${g.cuota ? `<span class="badge badge-cuota">${g.ncuotas}x $${fmt(g.montoXcuota)}</span>` : '—'}</td>
        <td style="color:var(--text3);font-size:0.78rem">${escHtml(g.notas || '—')}</td>
        <td style="display:flex;gap:4px">
          <button class="btn-edit" onclick="openEditGastoModal(${g.id})">✏</button>
          <button class="btn-del" onclick="deleteGasto(${g.id})">✕</button>
        </td>
      </tr>`).join('') +
    '</tbody></table>';
  }

  // Total al pie
  const totalARS = rows.filter(g => (g.moneda||'ARS') === 'ARS').reduce((s,g) => s + (g.monto||0), 0);
  const totalUSD = rows.filter(g => g.moneda === 'USD').reduce((s,g) => s + (g.monto||0), 0);
  const label = rows.length === gastos.length ? 'Total' : `Total (${rows.length} registros)`;
  el.insertAdjacentHTML('beforeend', `<div class="lista-total">
    <span class="lista-total-label">${label}</span>
    <span class="lista-total-monto">
      $${fmt(totalARS)}${totalUSD > 0 ? ` <span style="color:var(--accent3);margin-left:8px">u$s ${fmt(totalUSD)}</span>` : ''}
    </span>
  </div>`);
}

// ---- MODAL EDITAR GASTO ----
let editGastoId = null;

function openEditGastoModal(id) {
  const g = gastos.find(x => x.id === id);
  if (!g) return;
  editGastoId = id;
  const medioOpts = ['Efectivo', ...tarjetas.map(t => t.label || t.nombre || t.banco)].map(m => `<option value="${m}">${m}</option>`).join('');
  const catOpts = cats.gastos.map(c => `<option value="${c}">${c}</option>`).join('');
  $('eg-fecha').value = g.fecha;
  $('eg-desc').value = g.desc;
  $('eg-cat').innerHTML = catOpts;
  $('eg-cat').value = g.cat;
  $('eg-medio').innerHTML = '<option value="">Sin medio</option>' + medioOpts;
  $('eg-medio').value = g.medio || '';
  $('eg-monto').value = g.monto;
  $('eg-notas').value = g.notas || '';
  $('edit-gasto-modal').style.display = 'flex';
}

function closeEditGastoModal() {
  $('edit-gasto-modal').style.display = 'none';
  editGastoId = null;
}

function saveEditGastoModal() {
  const id = editGastoId;
  const g = gastos.find(x => x.id === id);
  if (!g) return;
  const fecha = $('eg-fecha').value;
  const desc  = $('eg-desc').value.trim();
  const cat   = $('eg-cat').value;
  const medio = $('eg-medio').value;
  const monto = parseFloat($('eg-monto').value);
  const notas = $('eg-notas').value.trim();
  if (!fecha || !desc || !cat || !monto || monto <= 0) { notify('⚠ Completá todos los campos'); return; }
  const mes = MESES[parseInt(fecha.slice(5,7)) - 1];
  const montoXcuota = g.cuota ? +(monto / g.ncuotas).toFixed(2) : monto;
  Object.assign(g, { fecha, desc, cat, medio, monto, montoXcuota, mes, notas });
  save();
  notify('Gasto actualizado');
  closeEditGastoModal();
  renderGastosTable();
}

function populateFilters() {
  // Inicializar navegador al mes actual si hay gastos en ese mes
  const mesActual = new Date().toISOString().slice(0,7);
  const tieneGastosEsteMes = gastos.some(g => g.fecha.slice(0,7) === mesActual);
  if (!_mesFiltro) _mesFiltro = tieneGastosEsteMes ? mesActual : '';

  const meses = [...new Set(gastos.map(g => g.fecha.slice(0,7)))].sort().reverse();
  const mesSel = $('filter-mes');
  if (mesSel) {
    const val = mesSel.value;
    mesSel.innerHTML = '<option value="">Todos los meses</option>' +
      meses.map(m => `<option value="${m}">${MESES[parseInt(m.slice(5,7))-1]} ${m.slice(0,4)}</option>`).join('');
    mesSel.value = val;
  }
  const cats2 = [...new Set(gastos.map(g => g.cat))].sort();
  const catSel = $('filter-cat');
  if (catSel) {
    const val = catSel.value;
    catSel.innerHTML = '<option value="">Todas las categorías</option>' +
      cats2.map(c => `<option value="${c}">${c}</option>`).join('');
    catSel.value = val;
  }
}
function renderOtrosPendientes() {
  const el = $('otros-pendientes');
  if (!otrosPendientes.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div style="padding:0.8rem 1.4rem;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
    <span style="font-size:0.7rem;color:var(--text3);letter-spacing:0.8px;text-transform:uppercase;margin-right:4px">PENDIENTES DE GUARDAR:</span>
    ${otrosPendientes.map(o => `
      <span style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:4px 10px;font-size:0.78rem">
        <span style="color:var(--text2)">${escHtml(o.nombre)}</span>
        <span style="font-family:'DM Mono',monospace;color:${o.moneda==='USD'?'var(--accent3)':'var(--accent)'}">${o.moneda==='USD'?'u$s ':' $'}${fmt(o.monto)}</span>
        <button onclick="quitarOtroPendiente(${o.id})" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:0.75rem;padding:0;line-height:1">✕</button>
      </span>`).join('')}
  </div>`;
}

// ---- MEDIOS DE PAGO ----
// Estructura: { id, tipo: 'credito'|'debito'|'billetera', nombre, banco, cierre, limite }
// Compatibilidad: registros viejos (solo {id,nombre,cierre,limite}) se tratan como crédito

// ---- SALDOS INICIALES ----
// { [label]: monto } — cuanto habia en cada cuenta antes de empezar a usar la app

function saveSaldosIniciales() {
  const uid = window._currentUser?.uid;
  if (!uid) return;
  window._fbSetDoc(window._fbDoc(window._fbDb, 'usuarios', uid), {
    gastos, ingresos, ahorros, saldosIniciales, tarjetas, pendientes, conceptosGuardados, ajustesCuentas, email: window._currentUser.email, updatedAt: new Date().toISOString()
  }).catch(e => console.error('Error guardando saldos iniciales:', e));
}

// ---- BOT DE TELEGRAM ----
function abrirBotTelegram() {
  const email = window._currentUser?.email;
  if (!email) { notify('⚠ Iniciá sesión primero'); return; }
  // Email codificado en base64 url-safe para que el bot vincule automáticamente
  const payload = btoa(email).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  window.open('https://t.me/Misfinanzasrobot?start=' + payload, '_blank');
}
window.abrirBotTelegram = abrirBotTelegram;

function renderSaldoInicial() {
  const el = $('saldo-inicial-lista');
  if (!el) return;
  // Solo Efectivo + billeteras virtuales + débito (no crédito, no almacena dinero)
  const cuentas = [{ label: 'Efectivo', icon: '💵' }];
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => {
    cuentas.push({ label: t.label || t.banco || t.nombre, icon: '📱' });
  });
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
    let lbl = t.label || ('CA ' + t.banco);
    if (lbl.startsWith('Débito ')) lbl = 'CA ' + lbl.slice(7);
    cuentas.push({ label: lbl, icon: '🏦' });
  });
  if (!cuentas.length) {
    el.innerHTML = '<div class="panel-empty">Agregá cuentas en "Mis medios de pago" primero</div>';
    return;
  }
  el.innerHTML = cuentas.map(c => {
    const val = saldosIniciales[c.label] || 0;
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.8rem 1rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.2rem">${c.icon}</span>
        <div>
          <div style="font-size:0.88rem;font-weight:600;color:var(--text2)">${c.label}</div>
          <div style="font-size:0.72rem;color:var(--text3)">Saldo inicial</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <input type="number" id="si-${c.label.replace(/[^a-zA-Z0-9]/g,'_')}"
          value="${val}" step="0.01" placeholder="0"
          style="width:130px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Mono',monospace;font-size:0.9rem;padding:7px 10px;outline:none;text-align:right">
        <button onclick="guardarSaldoInicial('${c.label}')" style="background:var(--accent3);border:none;color:#0d0f14;border-radius:8px;padding:7px 14px;font-size:0.8rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700">✓</button>
      </div>
    </div>`;
  }).join('');
}

function guardarSaldoInicial(label) {
  const safeId = label.replace(/[^a-zA-Z0-9]/g,'_');
  const input = document.getElementById('si-' + safeId);
  const monto = parseFloat(input?.value);
  if (isNaN(monto)) { notify('⚠ Ingresá un número'); return; }
  if (monto !== 0) {
    saldosIniciales[label] = monto;
  } else {
    delete saldosIniciales[label];
  }
  saveSaldosIniciales();
  notify(`✓ Saldo inicial de ${label} guardado`);
  renderSaldoCuentas();
}

// ---- MEDIOS DE PAGO (render selects) ----

function renderMedioPago() {
  const sel = $('g-medio');
  if (!sel) return;
  const credito = tarjetas.filter(t => (t.tipo||'credito') === 'credito');
  const debito  = tarjetas.filter(t => t.tipo === 'debito');
  const billetera = tarjetas.filter(t => t.tipo === 'billetera');
  let html = '<option value="">Seleccionar...</option><option value="Efectivo">💵 Efectivo</option>';
  if (credito.length) {
    html += '<optgroup label="💳 Tarjetas de crédito">';
    credito.forEach(t => { html += `<option value="${t.label||t.nombre||t.banco}">${t.label||t.nombre||t.banco}</option>`; });
    html += '</optgroup>';
  }
  if (debito.length) {
    html += '<optgroup label="🏦 Cuentas / Débito">';
    debito.forEach(t => {
      const lbl = t.label || ('CA ' + t.banco);
      html += `<option value="${lbl}">${lbl}</option>`;
    });
    html += '</optgroup>';
  }
  if (billetera.length) {
    html += '<optgroup label="📱 Billeteras virtuales">';
    billetera.forEach(t => { html += `<option value="${t.label||t.banco||t.nombre}">${t.label||t.banco||t.nombre}</option>`; });
    html += '</optgroup>';
  }
  sel.innerHTML = html;
}

function renderDestinosIngreso() {
  const ids = ['i-sueldo-destino','i-otro-destino'];
  ids.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    let html = '<option value="">Seleccionar...</option><option value="Efectivo">💵 Efectivo</option>';
    tarjetas.filter(t => t.tipo === 'billetera').forEach(t => {
      const lbl = t.label || t.banco || t.nombre;
      html += `<option value="${lbl}">📱 ${lbl}</option>`;
    });
    tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
      let lbl = t.label || ('CA ' + t.banco);
      if (lbl.startsWith('Débito ')) lbl = 'CA ' + lbl.slice(7);
      html += `<option value="${lbl}">🏦 ${lbl}</option>`;
    });
    sel.innerHTML = html;
  });
}

function renderOrigenAhorro() {
  const sel = $('a-origen');
  if (!sel) return;
  let html = '<option value="">Seleccionar...</option><option value="__ya_lo_tenia__">✅ Ya lo tenía (preexistente)</option><option value="Efectivo">💵 Efectivo</option>';
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => {
    const lbl = t.label || t.banco || t.nombre;
    html += `<option value="${lbl}">📱 ${lbl}</option>`;
  });
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
    let lbl = t.label || ('CA ' + t.banco);
    if (lbl.startsWith('Débito ')) lbl = 'CA ' + lbl.slice(7);
    html += `<option value="${lbl}">🏦 ${lbl}</option>`;
  });
  sel.innerHTML = html;
}

// ---- TARJETAS / MEDIOS DE PAGO ----

function renderProductosBanco() {
  const banco = $('tc-banco').value.trim();
  const wrap = $('tc-productos-wrap');
  if (!banco) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const lista = $('tc-productos-lista');

  // Card de crédito: una fila por red disponible
  const redes = [
    { red: 'Visa',             icon: '💳' },
    { red: 'Mastercard',       icon: '💳' },
    { red: 'American Express', icon: '💳' },
    { red: 'Otra',             icon: '💳' }
  ];

  const creditoRows = redes.map(r => {
    const yaExiste = tarjetas.find(t => t.banco === banco && t.tipo === 'credito' && t.red === r.red);
    const redId = r.red.replace(/\s/g, '_');
    return `
    <div style="display:flex;align-items:flex-start;gap:12px;padding:10px 14px;background:var(--bg);border:1px solid ${yaExiste ? 'var(--border)' : 'var(--accent4)'};border-radius:10px;opacity:${yaExiste ? 0.5 : 1};margin-bottom:8px">
      <span style="font-size:1.4rem;margin-top:2px">${r.icon}</span>
      <div style="flex:1">
        <div style="font-size:0.85rem;font-weight:600;color:var(--text2)">${r.red === 'Otra' ? 'Otra red' : r.red}</div>
        <div style="font-size:0.72rem;color:var(--text3);margin-bottom:6px">${r.red === 'Otra' ? 'Especificá la red o nombre' : r.red + ' ' + banco}</div>
        ${r.red === 'Otra' ? `<input type="text" id="tc-red-custom-${redId}" placeholder="Ej: Cabal, Naranja X..." style="width:100%;max-width:200px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.82rem;padding:5px 8px;outline:none;display:block;margin-bottom:6px">` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <div><label style="font-size:0.7rem;color:var(--text3)">Límite ($)</label>
            <input type="number" id="tc-limite-${redId}" placeholder="Opcional" min="0" style="width:110px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.82rem;padding:5px 8px;outline:none;display:block"></div>
        </div>
      </div>
      <input type="checkbox" id="tc-check-credito-${redId}" ${yaExiste ? 'disabled' : ''} style="width:20px;height:20px;accent-color:var(--accent4);cursor:pointer;margin-top:2px">
    </div>`;
  }).join('');

  const otrosTipos = [
    { tipo: 'debito',    icon: '🏦', label: 'Cuenta / Débito',   desc: 'CA, caja de ahorro, cuenta corriente' },
    { tipo: 'billetera', icon: '📱', label: 'Billetera virtual', desc: 'Mercado Pago, Ualá, Brubank, etc.' }
  ].map(p => {
    const yaExiste = tarjetas.find(t => t.banco === banco && t.tipo === p.tipo);
    return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg);border:1px solid ${yaExiste?'var(--border)':'var(--accent4)'};border-radius:10px;opacity:${yaExiste?0.5:1};margin-bottom:8px">
      <span style="font-size:1.5rem">${p.icon}</span>
      <div style="flex:1">
        <div style="font-size:0.85rem;font-weight:600;color:var(--text2)">${p.label}</div>
        <div style="font-size:0.72rem;color:var(--text3)">${p.desc}</div>
        <input type="text" id="tc-label-${p.tipo}" placeholder="Nombre personalizado (opcional)" style="width:100%;max-width:260px;background:var(--surface);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:0.82rem;padding:5px 8px;outline:none;margin-top:6px;display:block">
      </div>
      <input type="checkbox" id="tc-check-${p.tipo}" ${yaExiste?'disabled':''} style="width:20px;height:20px;accent-color:var(--accent4);cursor:pointer">
    </div>`;
  }).join('');

  lista.innerHTML = `
    <div style="font-size:0.7rem;font-weight:600;color:var(--text3);letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px">💳 Tarjetas de crédito</div>
    ${creditoRows}
    <div style="font-size:0.7rem;font-weight:600;color:var(--text3);letter-spacing:0.8px;text-transform:uppercase;margin:12px 0 8px">🏦 Otras cuentas</div>
    ${otrosTipos}
  `;
}

function agregarMedioPago() {
  const banco = $('tc-banco').value.trim();
  if (!banco) { notify('⚠ Ingresá el nombre del banco'); return; }
  let agregados = 0;

  // Tarjetas de crédito: una por red
  const redes = ['Visa', 'Mastercard', 'American_Express', 'Otra'];
  redes.forEach((redId, idx) => {
    const check = document.getElementById('tc-check-credito-' + redId);
    if (!check || !check.checked) return;
    let redNombre = redId.replace('_', ' ');
    if (redId === 'Otra') {
      const custom = document.getElementById('tc-red-custom-Otra')?.value.trim();
      if (!custom) { notify('⚠ Ingresá el nombre de la red personalizada'); return; }
      redNombre = custom;
    }
    const yaExiste = tarjetas.find(t => t.banco === banco && t.tipo === 'credito' && t.red === redNombre);
    if (yaExiste) return;
    const obj = { id: Date.now() + agregados, tipo: 'credito', banco, nombre: banco, red: redNombre, label: redNombre + ' ' + banco };
    const limite = parseFloat(document.getElementById('tc-limite-' + redId)?.value);
    if (!isNaN(limite) && limite > 0) obj.limite = limite;
    tarjetas.push(obj);
    agregados++;
  });

  // Débito y billetera
  ['debito','billetera'].forEach(tipo => {
    const check = document.getElementById('tc-check-' + tipo);
    if (!check || !check.checked) return;
    const yaExiste = tarjetas.find(t => t.banco === banco && t.tipo === tipo);
    if (yaExiste) return;
    const obj = { id: Date.now() + agregados, tipo, banco, nombre: banco };
    const labelInp = document.getElementById('tc-label-' + tipo);
    if (labelInp?.value.trim()) obj.label = labelInp.value.trim();
    tarjetas.push(obj);
    agregados++;
  });

  if (!agregados) { notify('⚠ Seleccioná al menos un producto'); return; }
  localStorage.setItem('gf_tarjetas', JSON.stringify(tarjetas));
  save();
  notify(`✓ ${agregados} producto${agregados>1?'s':''} de ${banco} agregados`);
  $('tc-banco').value = '';
  $('tc-productos-wrap').style.display = 'none';
  renderTarjetas();
  renderMedioPago();
  renderDestinosIngreso();
  renderOrigenAhorro();
  renderSaldoInicial();
}

function deleteTarjeta(id) {
  if (!confirm('¿Eliminar este medio de pago?')) return;
  tarjetas = tarjetas.filter(t => t.id !== id);
  localStorage.setItem('gf_tarjetas', JSON.stringify(tarjetas));
  save();
  notify('Medio eliminado');
  renderTarjetas();
  renderMedioPago();
  renderDestinosIngreso();
  renderOrigenAhorro();
  renderSaldoInicial();
}

function renderTarjetas() {
  const el = $('tc-lista');
  if (!el) return;
  if (!tarjetas.length) {
    el.innerHTML = '<div class="panel-empty">Sin medios de pago agregados</div>';
    return;
  }
  // Agrupar por banco
  const byBanco = {};
  tarjetas.forEach(t => {
    if (!byBanco[t.banco]) byBanco[t.banco] = [];
    byBanco[t.banco].push(t);
  });
  el.innerHTML = Object.entries(byBanco).map(([banco, ts]) => `
    <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:10px">
      <div style="padding:10px 14px;background:var(--surface2);border-bottom:1px solid var(--border);font-size:0.85rem;font-weight:700;color:var(--text2)">
        🏛 ${banco}
      </div>
      ${ts.map(t => {
        const tipo = t.tipo || 'credito';
        const icon = tipo === 'billetera' ? '📱' : tipo === 'debito' ? '🏦' : '💳';
        const label = t.label || (tipo === 'debito' ? 'CA ' + banco : (tipo === 'billetera' ? banco : banco));
        const sub = tipo === 'credito'
          ? (t.red ? t.red : 'Crédito') + (t.limite > 0 ? ' · Límite $' + fmt(t.limite) : '')
          : tipo === 'debito' ? 'Cuenta / Débito' : 'Billetera virtual';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="font-size:1.3rem">${icon}</span>
            <div>
              <div style="font-size:0.85rem;font-weight:600;color:var(--text2)">${label}</div>
              <div style="font-size:0.72rem;color:var(--text3)">${sub}</div>
            </div>
          </div>
          <button class="btn-del" onclick="deleteTarjeta(${t.id})">✕</button>
        </div>`;
      }).join('')}
    </div>`).join('');
}

// ---- INGRESOS ----

function toggleOtrosForm() {
  const el = $('otros-form');
  el.style.display = el.style.display === 'none' ? '' : 'none';
}

function agregarOtroIngreso() {
  const nombre = $('i-otro-nombre').value.trim();
  const moneda = $('i-otro-moneda').value || 'ARS';
  const monto  = parseFloat($('i-otro-monto').value);
  const destino = $('i-otro-destino').value;
  if (!nombre || !monto || monto <= 0) { notify('⚠ Completá nombre y monto'); return; }
  otrosPendientes.push({ id: Date.now(), nombre, monto, moneda, destino });
  $('i-otro-nombre').value = '';
  $('i-otro-monto').value  = '';
  $('otros-form').style.display = 'none';
  // Guardar concepto para autocompletar
  if (nombre && !conceptosGuardados.includes(nombre)) {
    conceptosGuardados.push(nombre);
    save();
  }
  renderOtrosPendientes();
  notify('Ingreso pendiente de guardar');
}

function quitarOtroPendiente(id) {
  otrosPendientes = otrosPendientes.filter(o => o.id !== id);
  renderOtrosPendientes();
}

function addIngreso() {
  const fechaI = $('i-fecha').value; // yyyy-mm-dd
  const año  = parseInt((fechaI || '').slice(0, 4));
  const mes  = fechaI ? MESES[parseInt(fechaI.slice(5, 7)) - 1] : '';
  const sueldo  = parseFloat($('i-sueldo').value) || 0;
  const sueldoMoneda  = $('i-sueldo-moneda').value || 'ARS';
  const sueldoDestino = $('i-sueldo-destino').value || '';
  const conceptoSel = $('i-sueldo-concepto').value;
  const conceptoOtro = $('i-sueldo-concepto-otro')?.value.trim() || '';
  const sueldoConcepto = conceptoSel === 'Otros' ? (conceptoOtro || 'Otros') : conceptoSel;

  if (!fechaI) { notify('⚠ Completá la fecha'); return; }
  if (sueldo <= 0 && !otrosPendientes.length) { notify('⚠ Ingresá al menos un monto'); return; }

  const ymBase = fechaI.slice(0, 7);
  const key = ymBase;

  const totalSueldo = sueldoMoneda === 'ARS' ? sueldo : 0;
  const totalARS = totalSueldo;

  const obj = {
    id: Date.now(),
    key,
    ymBase,
    fecha: fechaI,
    año,
    mes,
    sueldo,
    sueldoMoneda,
    sueldoConcepto,
    sueldoDestino,
    otros: [],
    totalARS,
    total: totalARS,
    extra: 0
  };

  const idx = ingresos.findIndex(i => (i.ymBase || i.key) === key);
  let target;
  if (idx >= 0) {
    target = ingresos[idx];
    target.otros = target.otros || [];
    if (sueldo > 0) {
      target.otros.push({ id: Date.now(), nombre: sueldoConcepto || 'Ingreso', monto: sueldo, moneda: sueldoMoneda, destino: sueldoDestino, fecha: fechaI });
      if (sueldoMoneda === 'ARS') {
        target.totalARS = (target.totalARS || 0) + sueldo;
        target.total = (target.total || 0) + sueldo;
      }
    }
  } else {
    target = obj;
    ingresos.push(obj);
  }

  // Agregar los "otros ingresos" pendientes (incluye USD y ARS)
  otrosPendientes.forEach(o => {
    target.otros = target.otros || [];
    target.otros.push({ id: o.id, nombre: o.nombre, monto: o.monto, moneda: o.moneda, destino: o.destino, fecha: fechaI });
    if (o.moneda === 'ARS') {
      target.totalARS = (target.totalARS || 0) + o.monto;
      target.total = (target.total || 0) + o.monto;
    }
  });
  otrosPendientes = [];
  renderOtrosPendientes();

  // Guardar concepto personalizado
  if (sueldoConcepto && conceptoSel === 'Otros' && !conceptosGuardados.includes(sueldoConcepto)) {
    conceptosGuardados.push(sueldoConcepto);
  }

  save();
  notify('✓ Ingreso guardado');
  renderIngresosTable();
  renderSaldoCuentas();
  renderDashboard();
  requestAnimationFrame(() => {
    const row = document.querySelector('#ingresos-table-body tr:first-child');
    if (row) row.classList.add('row-new');
  });
}

function editarSueldoIngreso(id) {
  const i = ingresos.find(x => x.id === id);
  if (!i) return;
  const nombre = i.sueldoConcepto || 'Sueldo';
  const nuevo = prompt(`Nuevo monto para "${nombre}" (${i.sueldoMoneda === 'USD' ? 'u$s' : '$'}):`, i.sueldo || 0);
  if (nuevo === null) return;
  const monto = parseFloat(nuevo);
  if (isNaN(monto) || monto < 0) { notify('⚠ Monto inválido'); return; }
  const diff = monto - (i.sueldo || 0);
  i.sueldo = monto;
  if ((i.sueldoMoneda || 'ARS') === 'ARS') {
    i.totalARS = (i.totalARS ?? i.total ?? 0) + diff;
    i.total = i.totalARS;
  }
  if (monto <= 0 && !(i.otros && i.otros.length)) {
    ingresos = ingresos.filter(x => x.id !== id);
  }
  save();
  renderIngresosTable();
  renderSaldoCuentas();
  renderDashboard();
  notify('✓ Ingreso actualizado');
}

function eliminarSueldoIngreso(id) {
  const i = ingresos.find(x => x.id === id);
  if (!i) return;
  if (!confirm(`¿Eliminar "${i.sueldoConcepto || 'Sueldo'}"?`)) return;
  if ((i.sueldoMoneda || 'ARS') === 'ARS') {
    i.totalARS = (i.totalARS ?? i.total ?? 0) - (i.sueldo || 0);
    i.total = i.totalARS;
  }
  i.sueldo = 0;
  if (!(i.otros && i.otros.length)) {
    ingresos = ingresos.filter(x => x.id !== id);
  }
  save({ skipMerge: true });
  renderIngresosTable();
  renderSaldoCuentas();
  renderDashboard();
  notify('Ingreso eliminado');
}

function sueldoRowHtml(i) {
  if (!i.sueldo || i.sueldo <= 0) return '';
  const montoStr = `${i.sueldoMoneda === 'USD' ? 'u$s ' : '$'}${fmt(i.sueldo)}`;
  const nombre = i.sueldoConcepto || 'Sueldo';
  const destino = i.sueldoDestino;
  return `<div class="oi-row">
    <div class="oi-nombre">${escHtml(nombre)}${destino ? ' → <span style="color:var(--accent4)">' + escHtml(destino) + '</span>' : ''}</div>
    <div class="oi-main">
      <span class="oi-monto" style="font-family:'DM Mono',monospace;${i.sueldoMoneda === 'USD' ? 'color:var(--accent3)' : ''}">${montoStr}</span>
      <span class="oi-actions">
        <button onclick="editarSueldoIngreso(${i.id})" title="Editar">✏</button>
        <button onclick="eliminarSueldoIngreso(${i.id})" title="Eliminar">✕</button>
      </span>
    </div>
  </div>`;
}

function otroIngresoRowHtml(ingresoId, o) {
  const montoStr = `${o.moneda === 'USD' ? 'u$s ' : '$'}${fmt(o.monto)}`;
  return `<div class="oi-row">
    <div class="oi-nombre">${escHtml(o.nombre)}${o.destino ? ' → <span style="color:var(--accent4)">' + escHtml(o.destino) + '</span>' : ''}</div>
    <div class="oi-main">
      <span class="oi-monto" style="font-family:'DM Mono',monospace;${o.moneda === 'USD' ? 'color:var(--accent3)' : ''}">${montoStr}</span>
      <span class="oi-actions">
        <button onclick="editarOtroIngreso(${ingresoId},${o.id})" title="Editar">✏</button>
        <button onclick="eliminarOtroIngreso(${ingresoId},${o.id})" title="Eliminar">✕</button>
      </span>
    </div>
  </div>`;
}

function editarOtroIngreso(ingresoId, otroId) {
  const ing = ingresos.find(i => i.id === ingresoId);
  if (!ing) return;
  const o = (ing.otros || []).find(x => x.id === otroId);
  if (!o) return;
  const nuevo = prompt(`Nuevo monto para "${o.nombre}" (${o.moneda === 'USD' ? 'u$s' : '$'}):`, o.monto);
  if (nuevo === null) return;
  const monto = parseFloat(nuevo);
  if (isNaN(monto) || monto < 0) { notify('⚠ Monto inválido'); return; }
  if (o.moneda === 'ARS') {
    ing.totalARS = (ing.totalARS || 0) - o.monto + monto;
    ing.total = ing.totalARS;
  }
  o.monto = monto;
  save();
  renderIngresosTable();
  renderSaldoCuentas();
  renderDashboard();
  notify('✓ Ingreso actualizado');
}

function eliminarOtroIngreso(ingresoId, otroId) {
  const ing = ingresos.find(i => i.id === ingresoId);
  if (!ing) return;
  const idx = (ing.otros || []).findIndex(x => x.id === otroId);
  if (idx < 0) return;
  const o = ing.otros[idx];
  if (!confirm(`¿Eliminar "${o.nombre}"?`)) return;
  if (o.moneda === 'ARS') {
    ing.totalARS = (ing.totalARS || 0) - o.monto;
    ing.total = ing.totalARS;
  }
  ing.otros.splice(idx, 1);
  if ((!ing.sueldo || ing.sueldo <= 0) && !ing.otros.length) {
    ingresos = ingresos.filter(x => x.id !== ing.id);
  }
  save({ skipMerge: true });
  renderIngresosTable();
  renderSaldoCuentas();
  renderDashboard();
  notify('Ingreso eliminado');
}

function renderIngresosTable() {
  const el = $('ingresos-table-body');
  if (!el) return;
  if (!ingresos.length) {
    el.innerHTML = emptyState('ingresos', 'Sin ingresos registrados', 'Guardá tu primer ingreso arriba');
    return;
  }
  const sorted = [...ingresos].sort((a,b) => {
    const ka = a.ymBase || a.key || '';
    const kb = b.ymBase || b.key || '';
    return kb.localeCompare(ka);
  });
  const isMobile = window.innerWidth < 600;
  if (isMobile) {
    el.innerHTML = `<div class="gasto-cards">` +
    sorted.map(i => {
      const ym = i.ymBase || i.key || '';
      const periodo = i.fecha
        ? i.fecha.split('-').reverse().join('/')
        : (ym ? `${MESES[parseInt(ym.slice(5,7))-1]} ${ym.slice(0,4)}` : (i.mes + ' ' + i.año));
      const otros = i.otros || [];
      const total = i.totalARS ?? i.total ?? 0;

      // Build item rows (clean, no nested sub-cards)
      let itemRows = '';
      if (i.sueldo > 0) {
        const nombre = i.sueldoConcepto || 'Sueldo';
        const destino = i.sueldoDestino ? ` → <span style="color:var(--accent4)">${escHtml(i.sueldoDestino)}</span>` : '';
        const montoStr = `${i.sueldoMoneda === 'USD' ? 'u$s ' : '$'}${fmt(i.sueldo)}`;
        const color = i.sueldoMoneda === 'USD' ? 'var(--accent3)' : 'var(--text1)';
        itemRows += `<div class="ing-card-item">
          <span class="ing-card-item-name">${escHtml(nombre)}${destino}</span>
          <span class="ing-card-item-monto" style="color:${color}">${montoStr}</span>
          <span class="ing-card-item-btns">
            <button class="btn-edit" onclick="editarSueldoIngreso(${i.id})">✏</button>
            <button class="btn-del" onclick="eliminarSueldoIngreso(${i.id})">✕</button>
          </span>
        </div>`;
      }
      otros.forEach(o => {
        const destino = o.destino ? ` → <span style="color:var(--accent4)">${escHtml(o.destino)}</span>` : '';
        const montoStr = `${o.moneda === 'USD' ? 'u$s ' : '$'}${fmt(o.monto)}`;
        const color = o.moneda === 'USD' ? 'var(--accent3)' : 'var(--text1)';
        itemRows += `<div class="ing-card-item">
          <span class="ing-card-item-name">${escHtml(o.nombre)}${destino}</span>
          <span class="ing-card-item-monto" style="color:${color}">${montoStr}</span>
          <span class="ing-card-item-btns">
            <button class="btn-edit" onclick="editarOtroIngreso(${i.id},${o.id})">✏</button>
            <button class="btn-del" onclick="eliminarOtroIngreso(${i.id},${o.id})">✕</button>
          </span>
        </div>`;
      });
      if (!itemRows && i.extra > 0) {
        itemRows = `<div class="ing-card-item">
          <span class="ing-card-item-name">Extra</span>
          <span class="ing-card-item-monto">$${fmt(i.extra)}</span>
        </div>`;
      }

      return `<div class="gasto-card">
        <div class="gasto-card-border" style="background:var(--accent)"></div>
        <div class="gasto-card-body">
          <div class="gasto-card-top">
            <span class="gasto-card-desc">${periodo}</span>
            <span class="gasto-card-monto" style="color:var(--accent)">$${fmt(total)}</span>
          </div>
          ${itemRows ? `<div class="ing-card-items">${itemRows}</div>` : ''}
        </div>
      </div>`;
    }).join('') +
    `</div>`;
  } else {
    el.innerHTML = `<table class="panel-table"><thead><tr>
      <th>Período</th>
      <th>Sueldo</th>
      <th>Otros</th>
      <th style="text-align:right">Total ARS</th>
    </tr></thead><tbody>` +
    sorted.map(i => {
      const ym = i.ymBase || i.key || '';
      const periodo = i.fecha
        ? i.fecha.split('-').reverse().join('/')
        : (ym ? `${MESES[parseInt(ym.slice(5,7))-1]} ${ym.slice(0,4)}` : (i.mes + ' ' + i.año));
      const otros = i.otros || [];
      const sueldoHtml = sueldoRowHtml(i);
      const otrosHtml = otros.length
        ? otros.map(o => otroIngresoRowHtml(i.id, o)).join('')
        : (i.extra > 0 ? `<div style="font-size:0.75rem;color:var(--text2)">Extra: $${fmt(i.extra)}</div>` : '—');
      return `<tr>
        <td style="font-weight:600;color:var(--text2)">${periodo}</td>
        <td>${sueldoHtml || '—'}</td>
        <td>${otrosHtml}</td>
        <td class="monto" style="text-align:right;white-space:nowrap;color:var(--accent)">$${fmt(i.totalARS ?? i.total ?? 0)}</td>
      </tr>`;
    }).join('') +
    '</tbody></table>';
  }

  // Total al pie de ingresos
  const totalIngARS = sorted.reduce((s,i) => s + (i.totalARS ?? i.total ?? 0), 0);
  el.insertAdjacentHTML('beforeend', `<div class="lista-total">
    <span class="lista-total-label">Total</span>
    <span class="lista-total-monto" style="color:var(--accent)">$${fmt(totalIngARS)}</span>
  </div>`);
}

// ---- CONCEPTOS / AUTOCOMPLETADO ----

function seleccionarConcepto(val, selId) {
  const sel = document.getElementById(selId);
  if (sel) sel.value = val;
  const otro = $('i-sueldo-concepto-otro');
  if (otro) otro.style.display = 'none';
}

function toggleConceptoOtro() {
  const sel = $('i-sueldo-concepto');
  const inp = $('i-sueldo-concepto-otro');
  if (!inp) return;
  if (sel.value === 'Otros') {
    inp.style.display = 'block';
    inp.focus();
  } else {
    inp.style.display = 'none';
    inp.value = '';
  }
}

function filtrarConceptos() {
  const inp = $('i-otro-nombre');
  const lista = $('conceptos-list');
  if (!lista) return;
  const q = inp.value.toLowerCase().trim();
  const matches = conceptosGuardados.filter(c => c.toLowerCase().includes(q));
  if (!matches.length) { lista.style.display = 'none'; return; }
  lista.innerHTML = matches.map(c =>
    `<div onclick="seleccionarConceptoOtro('${c.replace(/'/g,"\\'")}');" style="padding:8px 12px;cursor:pointer;font-size:0.85rem;border-bottom:1px solid var(--border)">${c}</div>`
  ).join('');
  lista.style.display = 'block';
}

function seleccionarConceptoOtro(val) {
  const inp = $('i-otro-nombre');
  if (inp) inp.value = val;
  const lista = $('conceptos-list');
  if (lista) lista.style.display = 'none';
}

// ---- AHORRO ----

function addAhorro() {
  const fechaA = $('a-fecha').value; // yyyy-mm-dd
  const año   = parseInt((fechaA || '').slice(0, 4));
  const mes   = fechaA ? MESES[parseInt(fechaA.slice(5, 7)) - 1] : '';
  const monto = parseFloat($('a-monto').value);
  const moneda= $('a-moneda').value || 'ARS';
  const tipo  = resolveOtro('a-tipo', 'a-tipo-otro');
  const notas = $('a-notas').value.trim();
  const origen= $('a-origen').value || '';

  if (!fechaA || !monto || monto <= 0 || !tipo) {
    notify('⚠ Completá fecha, tipo y monto');
    return;
  }

  const ymBase = fechaA.slice(0, 7);

  autoSaveNewCat(tipo, 'ahorro');

  ahorros.push({
    id: Date.now(), ymBase, key: ymBase, fecha: fechaA, año, mes,
    monto, moneda, tipo, concepto: tipo, notas, origen,
    rendimientos: 0
  });
  save();
  notify('✓ Ahorro guardado');
  ['a-monto','a-notas'].forEach(id => { const el = $(id); if (el) el.value = ''; });
  renderAhorroTable();
  renderSaldoCuentas();
  renderDashboard();
  requestAnimationFrame(() => {
    const row = document.querySelector('#ahorro-table-body tr:first-child');
    if (row) row.classList.add('row-new');
  });
}

function deleteAhorro(id) {
  if (!confirm('¿Eliminar este ahorro?')) return;
  ahorros = ahorros.filter(a => a.id !== id);
  save({ skipMerge: true });
  notify('Ahorro eliminado');
  renderAhorroTable();
  renderSaldoCuentas();
  renderDashboard();
}

function agregarRendimiento(id) {
  const a = ahorros.find(x => x.id === id);
  if (!a) return;
  const montoStr = prompt(`Ingresá el monto de rendimiento/interés para "${a.tipo || a.concepto || 'ahorro'}":`, '');
  if (montoStr === null) return;
  const monto = parseFloat(String(montoStr).replace(',', '.'));
  if (isNaN(monto) || monto === 0) { notify('Monto inválido'); return; }
  a.rendimientos = (a.rendimientos || 0) + monto;
  a.monto = (a.monto || 0) + monto;
  save();
  renderAhorroTable();
  renderSaldoCuentas();
  notify('✓ Rendimiento agregado: $' + fmt(Math.abs(monto)));
}

// ---- INSIGHT DEL MES ----
function renderInsight() {
  const el = $('dash-insight');
  if (!el) return;
  const ym = selectedDashMonth;

  const itemsM    = gastosDelMes(ym).filter(x => (x.moneda||'ARS') === 'ARS');
  const totalGasto = itemsM.reduce((s, x) => s + x.monto, 0);
  const ingM      = ingresos.filter(i => !i.esTransferencia && (i.ymBase || i.key.slice(0,7)) === ym);
  const totalIng  = ingM.reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalAho  = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === ym).reduce((s, a) => s + a.monto, 0);
  const saldo     = totalIng - totalGasto - totalAho;

  function prevYm(y) {
    const [yr, mo] = y.split('-').map(Number);
    return mo === 1 ? `${yr-1}-12` : `${yr}-${String(mo-1).padStart(2,'0')}`;
  }
  const prev = prevYm(ym);
  const gastosPrev = gastosDelMes(prev).filter(x => (x.moneda||'ARS')==='ARS').reduce((s, x) => s + x.monto, 0);

  // Categoría más cara
  const catMap = {};
  itemsM.forEach(x => { catMap[x.cat] = (catMap[x.cat] || 0) + x.monto; });
  const topCat = Object.entries(catMap).sort((a,b) => b[1]-a[1])[0];

  // Tasa de ahorro
  const savingRate = totalIng > 0 ? (totalAho / totalIng * 100) : 0;

  // Variación de gasto vs mes anterior
  const gastoDelta = gastosPrev > 0 ? ((totalGasto - gastosPrev) / gastosPrev * 100) : null;

  // Elegir insight más relevante
  let icon = '💡', msg = '', type = 'neutral';

  if (!totalIng && !totalGasto) {
    el.innerHTML = '';
    return;
  } else if (saldo < 0 && totalIng > 0) {
    icon = '⚠️'; type = 'bad';
    msg = `Los gastos superan los ingresos este mes por $${fmt(Math.round(Math.abs(saldo)))}`;
  } else if (gastoDelta !== null && gastoDelta >= 30) {
    icon = '📈'; type = 'bad';
    msg = `Gastaste un ${Math.round(gastoDelta)}% más que el mes anterior`;
  } else if (savingRate >= 20) {
    icon = '🎉'; type = 'good';
    msg = `¡Ahorraste el ${Math.round(savingRate)}% de tus ingresos este mes!`;
  } else if (savingRate > 0 && savingRate < 5 && totalIng > 0) {
    icon = '💰'; type = 'neutral';
    msg = `Ahorraste solo el ${Math.round(savingRate)}% de tus ingresos — intentá llegar al 10%`;
  } else if (topCat && topCat[1] > 0 && totalGasto > 0) {
    const pct = Math.round(topCat[1] / totalGasto * 100);
    icon = '🏷️'; type = 'neutral';
    msg = `Tu mayor gasto fue <b>${escHtml(topCat[0])}</b> ($${fmt(Math.round(topCat[1]))}, ${pct}% del total)`;
  } else if (gastoDelta !== null && gastoDelta <= -15) {
    icon = '📉'; type = 'good';
    msg = `Gastaste un ${Math.round(Math.abs(gastoDelta))}% menos que el mes anterior`;
  } else {
    el.innerHTML = '';
    return;
  }

  el.innerHTML = `<div class="dash-insight dash-insight-${type}">${icon} <span>${msg}</span></div>`;
}

// ---- METAS DE AHORRO ----
function toggleMetaForm() {
  const f = $('meta-form');
  if (!f) return;
  const open = f.style.display === 'none';
  f.style.display = open ? 'block' : 'none';
  if (open) populateMetaTipo();
}

function populateMetaTipo() {
  const sel = $('meta-tipo');
  if (!sel) return;
  // Categorías únicas de ahorros registrados
  const tipos = [...new Set(ahorros.map(a => a.tipo).filter(Boolean))].sort();
  sel.innerHTML = '<option value="">Seleccionar...</option>' +
    tipos.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
}

function guardarMeta() {
  const tipo = $('meta-tipo')?.value;
  const monto = parseFloat($('meta-monto')?.value);
  if (!tipo) { notify('⚠ Seleccioná una categoría'); return; }
  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  metasAhorro[tipo] = monto;
  save();
  notify('✓ Meta guardada');
  $('meta-form').style.display = 'none';
  renderMetasRings();
}

function deleteMeta(tipo) {
  delete metasAhorro[tipo];
  save();
  renderMetasRings();
}

function renderMetasRings() {
  const el = $('metas-rings');
  if (!el) return;
  const entries = Object.entries(metasAhorro);
  if (!entries.length) {
    el.innerHTML = `<div style="padding:1.2rem;color:var(--text3);font-size:0.82rem;text-align:center">
      Sin metas aún — tocá "+ Meta" para agregar una
    </div>`;
    return;
  }
  // Acumulado por tipo (solo ARS)
  const acum = {};
  ahorros.filter(a => (a.moneda || 'ARS') === 'ARS').forEach(a => {
    if (a.tipo) acum[a.tipo] = (acum[a.tipo] || 0) + (a.monto || 0) + (a.rendimientos || 0);
  });

  const SIZE = 56, R = 22, CIRC = 2 * Math.PI * R;
  let newlyCompleted = false;
  el.innerHTML = entries.map(([tipo, meta]) => {
    const total = acum[tipo] || 0;
    const pct = Math.min(total / meta, 1);
    if (pct >= 1 && !_celebratedMetas.has(tipo)) {
      _celebratedMetas.add(tipo);
      newlyCompleted = true;
    }
    const offset = CIRC * (1 - pct);
    const pctLabel = Math.round(pct * 100);
    const done = pct >= 1;
    const color = done ? '#18d47b' : catColor(tipo);
    return `
    <div class="meta-ring-row">
      <svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" class="meta-svg">
        <circle cx="${SIZE/2}" cy="${SIZE/2}" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="5"/>
        <circle cx="${SIZE/2}" cy="${SIZE/2}" r="${R}" fill="none" stroke="${color}" stroke-width="5"
          stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}"
          stroke-linecap="round" transform="rotate(-90 ${SIZE/2} ${SIZE/2})"
          class="meta-arc"/>
        <text x="${SIZE/2}" y="${SIZE/2 + 4}" text-anchor="middle"
          fill="${color}" font-size="10" font-weight="700" font-family="'Sora',sans-serif">
          ${done ? '✓' : pctLabel + '%'}
        </text>
      </svg>
      <div class="meta-ring-info">
        <div class="meta-ring-name">${escHtml(tipo)}</div>
        <div class="meta-ring-nums">$${fmt(Math.round(total))} <span>de $${fmt(meta)}</span></div>
        <div class="meta-bar-track">
          <div class="meta-bar-fill" style="width:${(pct*100).toFixed(1)}%;background:${color}"></div>
        </div>
      </div>
      <button onclick="deleteMeta('${escHtml(tipo)}')" class="meta-delete-btn" title="Eliminar meta">✕</button>
    </div>`;
  }).join('');

  if (newlyCompleted) {
    setTimeout(launchConfetti, 400);
    setTimeout(() => notify('🎉 ¡Meta alcanzada!'), 300);
  }
}

function renderAhorroTable() {
  renderMetasRings();
  const el = $('ahorro-table-body');
  if (!el) return;
  if (!ahorros.length) {
    el.innerHTML = emptyState('ahorro', 'Sin ahorros registrados', 'Registrá tu primer ahorro arriba');
    return;
  }
  const sorted = [...ahorros].sort((a,b) => {
    const ka = a.ymBase || a.key || '';
    const kb = b.ymBase || b.key || '';
    return kb.localeCompare(ka);
  });
  const isMobile = window.innerWidth < 600;
  if (isMobile) {
    el.innerHTML = `<div class="gasto-cards">` +
    sorted.map(a => {
      const ym = a.ymBase || a.key || '';
      const periodo = a.fecha
        ? a.fecha.split('-').reverse().join('/')
        : (ym ? `${MESES[parseInt(ym.slice(5,7))-1]} ${ym.slice(0,4)}` : (a.mes + ' ' + a.año));
      const monedaLabel = a.moneda === 'USD' ? 'u$s ' : '$';
      const color = a.moneda === 'USD' ? 'var(--accent3)' : 'var(--accent)';
      const rend = a.rendimientos || 0;
      const borderColor = catColor(a.tipo || 'Ahorro');
      return `<div class="gasto-card">
        <div class="gasto-card-border" style="background:${borderColor}"></div>
        <div class="gasto-card-body">
          <div class="gasto-card-top">
            <span class="gasto-card-desc">${a.tipo || '—'}</span>
            <span class="gasto-card-monto" style="color:${color}">${monedaLabel}${fmt(a.monto)}</span>
          </div>
          <div class="gasto-card-meta">
            <span class="gasto-card-fecha">${periodo}</span>
            ${a.notas ? `<span class="gasto-card-notas">${a.notas}</span>` : ''}
            ${rend !== 0 ? `<span style="font-size:0.72rem;color:${rend>0?'#a8ffdc':'var(--accent2)'};">${rend>0?'▲':'▼'} rend: ${rend>0?'+':''}$${fmt(Math.abs(rend))}</span>` : ''}
          </div>
          <div class="gasto-card-actions">
            <button class="btn-del" onclick="deleteAhorro(${a.id})">✕</button>
          </div>
        </div>
      </div>`;
    }).join('') +
    `</div>`;
  } else {
    el.innerHTML = `<table class="panel-table"><thead><tr>
      <th>Período</th>
      <th>Tipo</th>
      <th>Notas</th>
      <th style="text-align:right">Monto</th>
      <th></th>
    </tr></thead><tbody>` +
    sorted.map(a => {
      const ym = a.ymBase || a.key || '';
      const periodo = a.fecha
        ? a.fecha.split('-').reverse().join('/')
        : (ym ? `${MESES[parseInt(ym.slice(5,7))-1]} ${ym.slice(0,4)}` : (a.mes + ' ' + a.año));
      const monedaLabel = a.moneda === 'USD' ? 'u$s ' : '$';
      const color = a.moneda === 'USD' ? 'var(--accent3)' : 'var(--accent)';
      const rend = a.rendimientos || 0;
      return `<tr>
        <td style="font-weight:600;color:var(--text2)">${periodo}</td>
        <td>${a.tipo || '—'}</td>
        <td style="color:var(--text3);font-size:0.75rem">${a.notas || ''}</td>
        <td style="text-align:right;font-family:'DM Mono',monospace;color:${color};font-weight:600;white-space:nowrap">${monedaLabel}${fmt(a.monto)}${rend !== 0 ? `<div style="font-size:0.68rem;color:${rend>0?'#a8ffdc':'var(--accent2)'};margin-top:2px">${rend>0?'▲':'▼'} rend: ${rend>0?'+':''}$${fmt(Math.abs(rend))}</div>` : ''}</td>
        <td><button class="btn-del" onclick="deleteAhorro(${a.id})">✕</button></td>
      </tr>`;
    }).join('') +
    '</tbody></table>';
  }

  // Actualizar stats de ahorro
  const ahorrosARS = ahorros.filter(a => (a.moneda||'ARS') === 'ARS');
  const ahorrosUSD = ahorros.filter(a => a.moneda === 'USD');
  const totalARS = ahorrosARS.reduce((s,a) => s + a.monto, 0);
  const totalUSD = ahorrosUSD.reduce((s,a) => s + a.monto, 0);
  const meses = [...new Set(ahorrosARS.map(a => a.ymBase || a.key))];
  const promedio = meses.length ? totalARS / meses.length : 0;
  // Mejor mes
  const byMes = {};
  ahorrosARS.forEach(a => {
    const k = a.ymBase || a.key || '';
    byMes[k] = (byMes[k] || 0) + a.monto;
  });
  let mejorKey = null, mejorVal = 0;
  Object.entries(byMes).forEach(([k, v]) => { if (v > mejorVal) { mejorVal = v; mejorKey = k; } });

  if ($('a-total-ars')) $('a-total-ars').textContent = '$' + fmt(totalARS);
  if ($('a-total-usd')) $('a-total-usd').textContent = 'u$s ' + fmt(totalUSD);
  if ($('a-promedio'))  $('a-promedio').textContent  = '$' + fmt(Math.round(promedio));
  if ($('a-mejor'))     $('a-mejor').textContent     = mejorKey ? '$' + fmt(mejorVal) : '$0';
  if ($('a-mejor-mes')) $('a-mejor-mes').textContent = mejorKey ? (MESES[parseInt(mejorKey.slice(5,7))-1] + ' ' + mejorKey.slice(0,4)) : '—';

  // Total al pie de ahorro
  const totalAhoARS = ahorrosARS.reduce((s,a) => s + (a.monto||0), 0);
  const totalAhoUSD = ahorrosUSD.reduce((s,a) => s + (a.monto||0), 0);
  el.insertAdjacentHTML('beforeend', `<div class="lista-total">
    <span class="lista-total-label">Total</span>
    <span class="lista-total-monto">
      $${fmt(totalAhoARS)}${totalAhoUSD > 0 ? ` <span style="color:var(--accent3);margin-left:8px">u$s ${fmt(totalAhoUSD)}</span>` : ''}
    </span>
  </div>`);

  renderFondos();
}

function renderFondos() {
  const el = $('fondos-body');
  if (!el) return;
  // Agrupar ahorros por tipo, incluyendo rendimientos acumulados
  const tipos = {};
  ahorros.forEach(a => {
    const t = a.tipo || a.concepto || 'Otros';
    if (!tipos[t]) tipos[t] = { ars: 0, usd: 0, rend: 0 };
    if ((a.moneda||'ARS') === 'ARS') {
      tipos[t].ars += a.monto;
      tipos[t].rend += (a.rendimientos || 0);
    } else {
      tipos[t].usd += a.monto;
    }
  });
  if (!Object.keys(tipos).length) {
    el.innerHTML = emptyState('fondos', 'Sin fondos registrados', 'Los fondos aparecen cuando registrás ahorros');
    return;
  }
  el.innerHTML = Object.entries(tipos).map(([tipo, v]) => `
    <div style="padding:0.9rem 1.2rem;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;font-weight:600;color:var(--text2)">${escHtml(tipo)}</div>
        ${v.rend > 0 ? `<div style="font-size:0.72rem;color:var(--accent);font-family:'DM Mono',monospace;margin-top:2px">▲ rendimientos: +$${fmt(v.rend)}</div>` : ''}
        ${v.usd > 0 ? `<div style="font-size:0.75rem;color:var(--accent3);font-family:'DM Mono',monospace">u$s ${fmt(v.usd)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);font-size:1rem">$${fmt(v.ars)}</div>
        <button onclick="agregarRendimientoFondo(this.dataset.tipo)" data-tipo="${tipo}"
          style="background:rgba(168,255,220,0.08);border:1px solid rgba(168,255,220,0.3);color:var(--accent);border-radius:8px;padding:6px 12px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;min-height:36px;touch-action:manipulation;white-space:nowrap">
          +$ Interés
        </button>
        <button onclick="rescatarFondo(this.dataset.tipo)" data-tipo="${tipo}"
          style="background:rgba(255,79,94,0.08);border:1px solid rgba(255,79,94,0.35);color:var(--accent2);border-radius:8px;padding:6px 12px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;min-height:36px;touch-action:manipulation;white-space:nowrap">
          Rescatar
        </button>
      </div>
    </div>`).join('');
}

function agregarRendimientoFondo(tipo) {
  // Encontrar ahorros de este tipo (ARS)
  const del_tipo = ahorros.filter(a => (a.tipo || a.concepto || 'Otros') === tipo && (a.moneda||'ARS') === 'ARS');
  if (!del_tipo.length) { notify('Sin ahorros ARS de ese tipo'); return; }
  const montoStr = prompt('Monto de rendimiento/interés para "' + tipo + '":', '');
  if (montoStr === null) return;
  const monto = parseFloat(String(montoStr).replace(',', '.'));
  if (isNaN(monto)) { notify('Monto inválido'); return; }
  // Agregar al más reciente del tipo
  const target = del_tipo.sort((a, b) => (b.ymBase||b.key||'').localeCompare(a.ymBase||a.key||''))[0];
  target.rendimientos = (target.rendimientos || 0) + monto;
  target.monto = (target.monto || 0) + monto;
  save();
  renderAhorroTable();
  renderSaldoCuentas();
  const sign = monto >= 0 ? '+' : '';
  notify('✓ ' + sign + '$' + fmt(monto) + ' rendimiento en ' + tipo);
}

function rescatarFondo(tipo) {
  // Poblar destinos: Efectivo + billeteras + débito
  const sel = $('rescate-destino');
  if (!sel) return;
  let opts = '<option value="">Seleccionar...</option><option value="Efectivo">💵 Efectivo</option>';
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => {
    const lbl = t.label || t.banco || t.nombre;
    opts += `<option value="${escHtml(lbl)}">📱 ${escHtml(lbl)}</option>`;
  });
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
    const lbl = t.label || t.banco || t.nombre;
    opts += `<option value="${escHtml(lbl)}">🏦 ${escHtml(lbl)}</option>`;
  });
  sel.innerHTML = opts;

  const sub = $('rescate-modal-sub');
  if (sub) sub.textContent = `Fondo: ${tipo}`;
  const montoEl = $('rescate-monto');
  if (montoEl) montoEl.value = '';

  window._rescatandoTipo = tipo;
  const modal = $('rescate-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => { if (montoEl) montoEl.focus(); }, 100);
}

function cerrarRescate() {
  const modal = $('rescate-modal');
  if (modal) modal.style.display = '';
  window._rescatandoTipo = null;
}

function confirmarRescate() {
  const tipo    = window._rescatandoTipo;
  const monto   = parseFloat($('rescate-monto')?.value);
  const destino = $('rescate-destino')?.value;
  if (!tipo) return;
  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  if (!destino) { notify('⚠ Seleccioná el destino'); return; }

  // Verificar que hay saldo suficiente
  const totalFondo = ahorros
    .filter(a => (a.tipo || a.concepto || 'Otros') === tipo && (a.moneda||'ARS') === 'ARS')
    .reduce((s, a) => s + (a.monto || 0), 0);
  if (monto > totalFondo) { notify(`⚠ Saldo insuficiente ($${fmt(totalFondo)})`); return; }

  const hoy = new Date();
  const fecha = hoy.toISOString().slice(0, 10);
  const ymBase = fecha.slice(0, 7);
  const mes  = MESES[hoy.getMonth()];
  const año  = hoy.getFullYear();

  ahorros.push({
    id: Date.now(), ymBase, key: ymBase, fecha, año, mes,
    monto: -monto, moneda: 'ARS', tipo, concepto: tipo,
    notas: `Rescate → ${destino}`, origen: destino,
    rendimientos: 0, rescate: true
  });

  cerrarRescate();
  save();
  renderAhorroTable();
  renderSaldoCuentas();
  renderDashboard();
  notify(`✓ Rescate de $${fmt(monto)} → ${destino}`);
}

// ---- PENDIENTES (MEMO) ----

function addPendiente() {
  const desc  = $('p-desc').value.trim();
  const monto = parseFloat($('p-monto').value) || 0;
  if (!desc) { notify('⚠ Ingresá una descripción'); return; }
  pendientes.push({
    id: Date.now(), desc, monto,
    estado: 'pendiente',
    fecha: new Date().toISOString().slice(0,10)
  });
  save();
  $('p-desc').value = '';
  $('p-monto').value = '';
  notify('Memo agregado');
  renderPendientesTab();
}

function togglePendiente(id) {
  const p = pendientes.find(x => x.id === id);
  if (!p) return;
  p.estado = p.estado === 'completado' ? 'pendiente' : 'completado';
  save();
  renderPendientesTab();
}

function deletePendiente(id) {
  if (!confirm('¿Eliminar este memo?')) return;
  pendientes = pendientes.filter(p => p.id !== id);
  save({ skipMerge: true });
  notify('Memo eliminado');
  renderPendientesTab();
}

function limpiarCompletados() {
  const n = pendientes.filter(p => p.estado === 'completado').length;
  if (!n) { notify('No hay completados'); return; }
  if (!confirm(`¿Eliminar ${n} completado${n>1?'s':''}?`)) return;
  pendientes = pendientes.filter(p => p.estado !== 'completado');
  save();
  notify(`${n} eliminado${n>1?'s':''}`);
  renderPendientesTab();
}

function setPendienteFiltro(filtro, btn) {
  pendienteFiltro = filtro;
  document.querySelectorAll('[id^="pf-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderPendientesTab();
}

function renderPendientesTab() {
  const total = pendientes.length;
  const completados = pendientes.filter(p => p.estado === 'completado').length;
  const pendientesCount = total - completados;
  const totalMonto = pendientes.filter(p => p.estado !== 'completado').reduce((s, p) => s + (p.monto || 0), 0);
  const hoy = new Date().toISOString().slice(0,10);
  const vencidos = pendientes.filter(p => p.estado !== 'completado' && p.vence && p.vence <= hoy).length;

  if ($('p-count'))    $('p-count').textContent    = pendientesCount;
  if ($('p-done'))     $('p-done').textContent     = completados;
  if ($('p-total'))    $('p-total').textContent    = '$' + fmt(totalMonto);
  if ($('p-vencidos')) $('p-vencidos').textContent = vencidos;

  const el = $('pendientes-list');
  if (!el) return;

  let rows = [...pendientes].sort((a,b) => b.id - a.id);
  if (pendienteFiltro === 'pendientes')  rows = rows.filter(p => p.estado !== 'completado');
  if (pendienteFiltro === 'completados') rows = rows.filter(p => p.estado === 'completado');

  if (!rows.length) {
    el.innerHTML = '<div class="panel-empty">Sin memos aquí</div>';
    return;
  }

  el.innerHTML = rows.map(p => {
    const done = p.estado === 'completado';
    const vencido = p.vence && p.vence < hoy && !done;
    return `<div style="display:flex;align-items:center;gap:12px;padding:1rem 1.2rem;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:8px;opacity:${done?0.6:1}">
      <input type="checkbox" class="p-check" ${done?'checked':''} onchange="togglePendiente(${p.id})">
      <div style="flex:1;min-width:0">
        <div style="font-size:0.9rem;font-weight:600;color:var(--text2);text-decoration:${done?'line-through':'none'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.desc}</div>
        <div style="font-size:0.72rem;color:var(--text3);margin-top:2px">
          ${p.fecha || ''} ${vencido ? '<span style="color:var(--accent2);font-weight:700">· VENCIDO</span>' : ''}
        </div>
        ${p.monto > 0 ? `<span style="font-family:'DM Mono',monospace;color:var(--accent);font-size:0.82rem;font-weight:700">$${fmt(p.monto)}</span>` : ''}
      </div>
      <button class="btn-del" onclick="deletePendiente(${p.id})" style="flex-shrink:0">✕</button>
    </div>`;
  }).join('');
}

// ---- CATEGORÍAS ----
const defaultCats = {
  gastos: ['Alimentación','Transporte','Servicios','Salud','Entretenimiento','Indumentaria','Educación','Hogar','Restaurantes','Viajes','Tecnología','Suscripciones','Mascotas','Regalos','Tarjeta de crédito','Transferencia','Otros'],
  ahorro: ['Efectivo','Caja de ahorro','Plazo fijo','Inversión','USDT','Dólares','Fondo de emergencia','Otros']
};
let cats = JSON.parse(JSON.stringify(defaultCats));

function loadCats() {
  try {
    const g = localStorage.getItem('gf_cats_gastos');
    const a = localStorage.getItem('gf_cats_ahorro');
    if (g) cats.gastos = JSON.parse(g);
    if (a) cats.ahorro = JSON.parse(a);
  } catch(e) {}
}

// Guarda las categorías en Firestore para que sincronicen entre dispositivos
async function saveCatsToCloud() {
  const uid = window._currentUser?.uid;
  if (!uid) return;
  try {
    const ref = window._fbDoc(window._fbDb, 'usuarios', uid);
    await window._fbSetDoc(ref, { cats }, { merge: true });
  } catch(e) { console.error('Error guardando categorías:', e); }
}

// Fusiona las categorías locales con las guardadas en Firestore (unión, sin duplicados)
function mergeCatsRemote(remoteCats) {
  if (!remoteCats) return;
  ['gastos', 'ahorro'].forEach(tipo => {
    if (Array.isArray(remoteCats[tipo])) {
      const set = new Set([...(cats[tipo] || []), ...remoteCats[tipo]]);
      cats[tipo] = Array.from(set);
    }
  });
  saveCats('gastos');
  saveCats('ahorro');
}

function saveCats(tipo) {
  localStorage.setItem('gf_cats_' + tipo, JSON.stringify(cats[tipo]));
  saveCatsToCloud();
}

function initCatSelects() {
  // Gastos
  const gSel = $('g-cat');
  if (gSel) {
    const v = gSel.value;
    gSel.innerHTML = '<option value="">Seleccionar...</option>' +
      cats.gastos.map(c => `<option value="${c}">${c}</option>`).join('') +
      '<option value="__nueva__">✏ Nueva...</option>';
    gSel.value = v;
  }
  // Ahorro
  const aSel = $('a-tipo');
  if (aSel) {
    const v = aSel.value;
    aSel.innerHTML = '<option value="">Seleccionar...</option>' +
      cats.ahorro.map(c => `<option value="${c}">${c}</option>`).join('') +
      '<option value="__nueva__">✏ Nueva...</option>';
    aSel.value = v;
  }
  // Recurrentes (form de creación, si está abierto)
  const recCat = $('rec-cat-nuevo');
  if (recCat) {
    const v = recCat.value;
    recCat.innerHTML = '<option value="">Seleccionar...</option>' +
      cats.gastos.map(c => `<option value="${c}">${c}</option>`).join('');
    recCat.value = v;
  }
}

function onCatSelect(selId, inputId, tipo) {
  const sel = document.getElementById(selId);
  const inp = document.getElementById(inputId);
  const isNew = sel.value === '__nueva__';
  if (inp) {
    inp.style.display = isNew ? 'block' : 'none';
    if (isNew) inp.focus();
  }
}

function saveNewCat(selId, inputId, tipo) {
  const sel = document.getElementById(selId);
  const inp = document.getElementById(inputId);
  const val = inp?.value.trim();
  if (!val) return;
  if (!cats[tipo].includes(val)) {
    cats[tipo].push(val);
    saveCats(tipo);
    initCatSelects();
  }
  if (sel) sel.value = val;
  if (inp) inp.style.display = 'none';
}

// Modal categorías
let catModalTipo = 'gastos';

function openCatModal(tipo) {
  catModalTipo = tipo;
  $('cat-modal-title').textContent = tipo === 'gastos' ? 'Categorías de Gastos' : 'Tipos de Ahorro';
  renderCatModalList();
  $('cat-modal').style.display = 'flex';
}

function closeCatModal() {
  $('cat-modal').style.display = 'none';
  initCatSelects();
}

function renderCatModalList() {
  const el = $('cat-modal-list');
  const lista = cats[catModalTipo] || [];
  el.innerHTML = lista.map((c, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:8px 12px;background:var(--surface2);border-radius:8px" id="cat-row-${i}">
      <span style="font-size:0.88rem;color:var(--text2);flex:1">${escHtml(c)}</span>
      <button onclick="editCat(${i})" style="background:none;border:none;color:var(--text3);font-size:0.85rem;cursor:pointer;padding:2px 6px" title="Renombrar">✏</button>
      <button onclick="deleteCat(${i})" style="background:none;border:none;color:var(--text3);font-size:0.85rem;cursor:pointer;padding:2px 6px" title="Eliminar">✕</button>
    </div>`).join('');
}

function editCat(idx) {
  const row = document.getElementById(`cat-row-${idx}`);
  if (!row) return;
  const actual = cats[catModalTipo][idx];
  row.innerHTML = `
    <input id="cat-edit-inp-${idx}" value="${escHtml(actual)}" style="flex:1;padding:6px 10px;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Sora',sans-serif;font-size:0.85rem;outline:none">
    <button onclick="guardarEditCat(${idx})" style="background:none;border:none;color:var(--accent);font-size:0.85rem;cursor:pointer;padding:2px 8px;font-weight:600">✓</button>
    <button onclick="renderCatModalList()" style="background:none;border:none;color:var(--text3);font-size:0.85rem;cursor:pointer;padding:2px 6px">✕</button>`;
  setTimeout(() => {
    const inp = document.getElementById(`cat-edit-inp-${idx}`);
    if (inp) { inp.focus(); inp.select(); }
  }, 50);
}

function guardarEditCat(idx) {
  const inp = document.getElementById(`cat-edit-inp-${idx}`);
  const nuevoNombre = (inp?.value || '').trim();
  const nombreAnterior = cats[catModalTipo][idx];
  if (!nuevoNombre) { notify('⚠ El nombre no puede estar vacío'); return; }
  if (nuevoNombre === nombreAnterior) { renderCatModalList(); return; }
  if (cats[catModalTipo].includes(nuevoNombre)) { notify('⚠ Ya existe esa categoría'); return; }

  // Renombrar en la lista
  cats[catModalTipo][idx] = nuevoNombre;
  saveCats(catModalTipo);

  // Actualizar todos los gastos/ahorros que usaban el nombre anterior
  if (catModalTipo === 'gastos') {
    gastos.forEach(g => { if (g.cat === nombreAnterior) g.cat = nuevoNombre; });
    recurrentes.forEach(r => { if (r.cat === nombreAnterior) r.cat = nuevoNombre; });
    save();
  } else {
    ahorros.forEach(a => { if (a.tipo === nombreAnterior) { a.tipo = nuevoNombre; a.concepto = nuevoNombre; } });
    save();
  }

  renderCatModalList();
  initCatSelects();
  notify(`✓ "${nombreAnterior}" renombrado a "${nuevoNombre}"`);
}

function addCatFromModal() {
  const inp = $('cat-modal-input');
  const val = inp.value.trim();
  if (!val) return;
  if (!cats[catModalTipo].includes(val)) {
    cats[catModalTipo].push(val);
    saveCats(catModalTipo);
  }
  inp.value = '';
  renderCatModalList();
  initCatSelects();
}

function deleteCat(idx) {
  cats[catModalTipo].splice(idx, 1);
  saveCats(catModalTipo);
  renderCatModalList();
}

// ---- AUTH ----
let authMode = 'login'; // 'login' | 'register'

function authAction() {
  const email = $('auth-email').value.trim();
  const pass  = $('auth-pass').value;
  const errEl = $('auth-error');
  errEl.textContent = '';

  if (!email || !pass) {
    errEl.textContent = 'Completá email y contraseña';
    return;
  }

  if (authMode === 'register') {
    const pass2 = $('auth-pass2').value;
    if (pass !== pass2) { errEl.textContent = 'Las contraseñas no coinciden'; return; }
    window._fbCreateUser(window._fbAuth, email, pass)
      .then(() => notify('✓ Cuenta creada'))
      .catch(e => { errEl.textContent = e.message; });
  } else {
    window._fbSignIn(window._fbAuth, email, pass)
      .catch(e => { errEl.textContent = e.message; });
  }
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  $('auth-btn').textContent = authMode === 'register' ? 'Registrarse' : 'Ingresar';
  $('auth-toggle').innerHTML = authMode === 'register'
    ? '¿Ya tenés cuenta? <span onclick="window.toggleAuthMode()">Ingresá</span>'
    : '¿No tenés cuenta? <span onclick="window.toggleAuthMode()">Registrate</span>';
  $('auth-pass2-wrap').style.display = authMode === 'register' ? '' : 'none';
  $('auth-error').textContent = '';
}

function resetPassword() {
  const email = $('auth-email').value.trim();
  if (!email) { $('auth-error').textContent = 'Ingresá tu email primero'; return; }
  window._fbResetPassword(window._fbAuth, email)
    .then(() => notify('✓ Email de recuperación enviado'))
    .catch(e => { $('auth-error').textContent = e.message; });
}

window.doLogout = function() {
  window._fbSignOut(window._fbAuth).catch(console.error);
};

window.authAction = authAction;
window.toggleAuthMode = toggleAuthMode;
window.resetPassword = resetPassword;

// ---- EXPORT / IMPORT ----
let importPendingData = null;

function exportarExcel() {
  try {
    if (typeof XLSX === 'undefined') { notify('⚠ Librería Excel no cargada, esperá un momento y volvé a intentar'); return; }

    console.log('Exportando Excel — gastos:', gastos.length, 'ingresos:', ingresos.length, 'ahorros:', ahorros.length);

    const wb = XLSX.utils.book_new();

    // ── Hoja 1: Gastos ──────────────────────────────────────────────────────
    const gastosRows = [['Fecha','Descripción','Categoría','Medio de pago','Monto','Moneda','Cuotas','Monto x cuota','Notas']];
    [...(gastos || [])].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '')).forEach(g => {
      gastosRows.push([
        g.fecha || '', g.desc || '', g.cat || '', g.medio || '',
        g.monto || 0, g.moneda || 'ARS',
        g.cuota ? (g.ncuotas || 1) : 1,
        g.cuota ? (g.montoXcuota || 0) : (g.monto || 0),
        g.notas || ''
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gastosRows), 'Gastos');

    // ── Hoja 2: Ingresos ────────────────────────────────────────────────────
    const ingresosRows = [['Mes','Concepto','Monto','Moneda','Destino']];
    (ingresos || []).forEach(ing => {
      const mes = ing.ymBase || (ing.key || '').slice(0, 7);
      // Sueldo principal
      if ((ing.sueldo || 0) > 0) {
        ingresosRows.push([mes, ing.sueldoConcepto || 'Sueldo', ing.sueldo, ing.sueldoMoneda || 'ARS', ing.sueldoDestino || '']);
      }
      // Otros ingresos del mes
      (ing.otros || []).forEach(o => {
        ingresosRows.push([mes, o.nombre || o.concepto || o.desc || 'Ingreso', o.monto || 0, o.moneda || 'ARS', o.destino || '']);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ingresosRows), 'Ingresos');

    // ── Hoja 3: Ahorros ─────────────────────────────────────────────────────
    const ahorrosRows = [['Fecha','Tipo / Concepto','Monto','Moneda','Rendimientos','Origen']];
    (ahorros || []).forEach(a => {
      ahorrosRows.push([
        a.ymBase || (a.key || '').slice(0, 7),
        a.concepto || a.tipo || '',
        a.monto || 0,
        a.moneda || 'ARS',
        a.rendimientos || 0,
        a.origen || ''
      ]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ahorrosRows), 'Ahorros');

    // ── Hoja 4: Pendientes ──────────────────────────────────────────────────
    const pendientesRows = [['Concepto','Monto estimado','Estado']];
    (pendientes || []).forEach(p => {
      pendientesRows.push([p.desc || '', p.monto || 0, p.done ? 'Completado' : 'Pendiente']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pendientesRows), 'Pendientes');

    // ── Hoja 5: Resumen mensual ──────────────────────────────────────────────
    const mesesUnicos = [...new Set([
      ...(gastos || []).map(g => (g.fecha || '').slice(0, 7)),
      ...(ingresos || []).map(i => i.ymBase || (i.key || '').slice(0, 7))
    ].filter(Boolean))].sort().reverse();

    const resumenRows = [['Mes','Ingresos ARS','Gastos ARS','Balance ARS']];
    mesesUnicos.forEach(ym => {
      let ingTotal = 0;
      (ingresos || []).forEach(ing => {
        const m = ing.ymBase || (ing.key || '').slice(0, 7);
        if (m !== ym) return;
        if ((ing.sueldoMoneda || 'ARS') === 'ARS') ingTotal += (ing.sueldo || 0);
        (ing.otros || []).forEach(o => { if ((o.moneda || 'ARS') === 'ARS') ingTotal += (o.monto || 0); });
      });
      const gasTotal = gastosDelMes(ym).filter(g => (g.moneda || 'ARS') === 'ARS').reduce((s, g) => s + g.monto, 0);
      resumenRows.push([ym, ingTotal, gasTotal, ingTotal - gasTotal]);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumenRows), 'Resumen mensual');

    XLSX.writeFile(wb, `finanzas_${new Date().toISOString().slice(0, 10)}.xlsx`);
    notify('✓ Excel exportado correctamente');
  } catch(e) {
    console.error('Error exportando Excel:', e);
    notify('⚠ Error al exportar: ' + e.message);
  }
}
window.exportarExcel = exportarExcel;

function exportData() {
  const data = { gastos, ingresos, ahorros, saldosIniciales, tarjetas, pendientes, conceptosGuardados, ajustesCuentas, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `finanzas_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  notify('✓ Datos exportados');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      importPendingData = JSON.parse(e.target.result);
      $('import-modal').style.display = 'flex';
    } catch(err) {
      notify('⚠ Archivo inválido');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function cancelImport() {
  importPendingData = null;
  $('import-modal').style.display = 'none';
}

function confirmImport() {
  if (!importPendingData) return;
  const d = importPendingData;
  gastos          = d.gastos          || [];
  ingresos        = d.ingresos        || [];
  ahorros         = d.ahorros         || [];
  saldosIniciales = d.saldosIniciales || {};
  pendientes      = d.pendientes      || [];
  conceptosGuardados = d.conceptosGuardados || [];
  ajustesCuentas  = d.ajustesCuentas  || [];
  if (d.tarjetas?.length) {
    tarjetas = d.tarjetas;
    localStorage.setItem('gf_tarjetas', JSON.stringify(tarjetas));
  }
  importPendingData = null;
  $('import-modal').style.display = 'none';
  save();
  renderDashboard();
  renderMedioPago();
  renderSaldoInicial();
  notify('✓ Datos importados');
}
// ---- DASHBOARD ----

function buildDashMonths() {
  const all = [...new Set([
    ...gastos.map(g => g.fecha.slice(0,7)),
    ...ingresos.map(i => i.ymBase || i.key?.slice(0,7) || ''),
    ...ahorros.map(a => a.ymBase || a.key?.slice(0,7) || '')
  ].filter(Boolean))].sort().reverse();
  const current = new Date().toISOString().slice(0,7);
  if (!all.includes(current)) all.unshift(current);
  const wrap = $('dashMonths');
  wrap.innerHTML = all.slice(0,6).map(m => {
    const label = MESES[parseInt(m.slice(5,7))-1].slice(0,3) + ' ' + m.slice(2,4);
    return `<button class="month-btn ${m===selectedDashMonth?'active':''}" onclick="selectDashMonth('${m}', this)">${label}</button>`;
  }).join('');
}

function selectDashMonth(m, el) {
  selectedDashMonth = m;
  document.querySelectorAll('.month-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderDashboard();
}

// Devuelve {monto, cat} de cada cuota que cae en el mes ym,
// más los gastos normales (sin cuota) cuya fecha está en ym.
function gastosDelMes(ym) {
  const items = [];
  gastos.forEach(g => {
    if (g.esTransferencia) return;
    if (!g.cuota) {
      // Gasto normal: si tiene offsetCuotas (crédito en 1 pago), calcular el mes real
      if (g.offsetCuotas) {
        const [fy, fm] = g.fecha.split('-').map(Number);
        let cy = fy, cm = fm + g.offsetCuotas;
        while (cm > 12) { cm -= 12; cy++; }
        const gastoYm = `${cy}-${String(cm).padStart(2, '0')}`;
        if (gastoYm === ym) items.push({ monto: g.monto, cat: g.cat, moneda: g.moneda || 'ARS' });
      } else {
        if (g.fecha.slice(0, 7) === ym) items.push({ monto: g.monto, cat: g.cat, moneda: g.moneda || 'ARS' });
      }
    } else {
      // Cuota: calcular qué cuotas caen en ym
      const [fy, fm] = g.fecha.split('-').map(Number);
      const off = g.offsetCuotas || 0;
      for (let n = 0; n < g.ncuotas; n++) {
        let cy = fy, cm = fm + off + n;
        while (cm > 12) { cm -= 12; cy++; }
        const cuotaYm = `${cy}-${String(cm).padStart(2, '0')}`;
        if (cuotaYm === ym) items.push({ monto: g.montoXcuota, cat: g.cat, moneda: g.moneda || 'ARS' });
      }
    }
  });
  return items;
}

function totalDelMes(ym) {
  return gastosDelMes(ym).reduce((s, x) => s + x.monto, 0);
}

// ---- PRESUPUESTO MENSUAL ----
let presupuestoMes = new Date().toISOString().slice(0,7);

function cambiarMesPresupuesto(delta) {
  const [y, m] = presupuestoMes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  presupuestoMes = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  renderPresupuesto();
}

function renderPresupuesto() {
  const body = $('presupuesto-body');
  const label = $('presupuesto-mes-label');
  if (!body) return;

  const ym = presupuestoMes;
  const [y, m] = ym.split('-').map(Number);
  if (label) label.textContent = MESES[m - 1] + ' ' + y;

  // Total gastado por categoría este mes (solo ARS)
  const gastadoPorCat = {};
  gastosDelMes(ym).forEach(g => {
    if ((g.moneda || 'ARS') !== 'ARS') return;
    gastadoPorCat[g.cat] = (gastadoPorCat[g.cat] || 0) + g.monto;
  });

  const presMes = presupuestos[ym] || {};
  const categorias = cats.gastos;

  // Separar categorías con presupuesto asignado de las que no
  const conPresupuesto = categorias.filter(c => (presMes[c] || 0) > 0);
  const sinPresupuesto = categorias.filter(c => !((presMes[c] || 0) > 0));
  // Ordenar: las que tienen gasto este mes primero (de mayor a menor), luego el resto
  sinPresupuesto.sort((a, b) => (gastadoPorCat[b] || 0) - (gastadoPorCat[a] || 0));

  // Ordenar por monto gastado (de mayor a menor)
  conPresupuesto.sort((a, b) => (gastadoPorCat[b] || 0) - (gastadoPorCat[a] || 0));

  // Totales generales
  const totalPres = conPresupuesto.reduce((s, c) => s + presMes[c], 0);
  const totalGastado = conPresupuesto.reduce((s, c) => s + (gastadoPorCat[c] || 0), 0);

  const renderCard = (cat) => {
    const pres = presMes[cat] || 0;
    const gastado = gastadoPorCat[cat] || 0;
    const pct = pres > 0 ? Math.min(100, (gastado / pres) * 100) : 0;
    const sobre = pres > 0 && gastado > pres;
    const safeId = cat.replace(/[^a-zA-Z0-9]/g, '_');
    const color = catColor(cat);

    let barColor, statusClass, statusIcon;
    if (sobre)      { barColor = 'var(--accent2)'; statusClass = 'pres-status-over'; statusIcon = '✗'; }
    else if (pct > 80) { barColor = 'var(--accent3)'; statusClass = 'pres-status-warn'; statusIcon = '⚠'; }
    else            { barColor = 'var(--accent)';  statusClass = 'pres-status-ok';   statusIcon = '✓'; }

    return `<div style="background:var(--surface2);border:1px solid var(--border);border-left:3px solid ${color};border-radius:var(--radius);padding:0.9rem 1rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-size:0.85rem;color:var(--text2);font-weight:600">${escHtml(cat)}</span>
        ${pres > 0
          ? `<span class="${statusClass}" style="font-size:0.75rem;font-weight:700">${statusIcon} ${Math.round(pct)}%</span>`
          : `<span style="font-size:0.7rem;color:var(--text3)">sin límite</span>`}
      </div>
      ${pres > 0
        ? `<div class="pres-bar-track">
            <div class="pres-bar-fill" style="--pct:${pct.toFixed(1)}%;background:${barColor}"></div>
          </div>
          <div style="font-size:0.75rem;color:var(--text3);margin-bottom:10px;display:flex;justify-content:space-between">
            <span>$${fmt(gastado)} gastado</span>
            <span>${sobre ? `<span style="color:var(--accent2)">+$${fmt(gastado-pres)} excedido</span>` : `$${fmt(pres - gastado)} restante`}</span>
          </div>`
        : `<div style="font-size:0.75rem;color:var(--text3);margin-bottom:10px">$${fmt(gastado)} gastado este mes</div>`}
      <div style="display:flex;gap:6px">
        <input type="number" id="pres-${safeId}" value="${pres || ''}" placeholder="Asignar límite..." min="0" step="0.01"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'DM Mono',monospace;font-size:0.8rem;padding:6px 8px;outline:none;text-align:right">
        <button onclick="guardarPresupuestoCat('${cat.replace(/'/g, "\\'")}','${safeId}')" style="background:var(--accent3);border:none;color:#0d0f14;border-radius:8px;padding:6px 12px;font-size:0.78rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700">✓</button>
      </div>
    </div>`;
  };

  let html = '';

  if (conPresupuesto.length) {
    const pctTotal = totalPres > 0 ? Math.min(100, (totalGastado / totalPres) * 100) : 0;
    const sobreTotal = totalGastado > totalPres;
    html += `<div class="cards" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:1.2rem">
      <div class="card blue">
        <div class="label">Presupuestado</div>
        <div class="value">$${fmt(totalPres)}</div>
      </div>
      <div class="card ${sobreTotal ? 'red' : 'green'}">
        <div class="label">Gastado</div>
        <div class="value">$${fmt(totalGastado)}</div>
        <div class="sub">${Math.round(pctTotal)}% del total</div>
      </div>
      <div class="card ${sobreTotal ? 'red' : 'yellow'}">
        <div class="label">Disponible</div>
        <div class="value">$${fmt(totalPres - totalGastado)}</div>
      </div>
    </div>`;

    html += `<div style="font-size:0.72rem;color:var(--text3);font-weight:600;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:0.6rem">Con presupuesto asignado</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:1.5rem">`;
    html += conPresupuesto.map(renderCard).join('');
    html += `</div>`;
  }

  if (sinPresupuesto.length) {
    html += `<div style="font-size:0.72rem;color:var(--text3);font-weight:600;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:0.6rem">Sin presupuesto asignado</div>`;
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">`;
    html += sinPresupuesto.map(renderCard).join('');
    html += `</div>`;
  }

  body.innerHTML = html || '<div class="panel-empty">No hay categorías de gastos configuradas</div>';
}

function guardarPresupuestoCat(cat, safeId) {
  const input = document.getElementById('pres-' + safeId);
  const val = parseFloat(input?.value);
  const mes = presupuestoMes;

  if (!presupuestos[mes]) presupuestos[mes] = {};
  if (isNaN(val) || val <= 0) {
    delete presupuestos[mes][cat];
    // Quitar de explícitos
    if (presupuestosExplicitos[cat]) {
      presupuestosExplicitos[cat] = presupuestosExplicitos[cat].filter(m => m !== mes);
    }
  } else {
    presupuestos[mes][cat] = val;
    // Marcar este mes como explícito para esta categoría
    if (!presupuestosExplicitos[cat]) presupuestosExplicitos[cat] = [];
    if (!presupuestosExplicitos[cat].includes(mes)) presupuestosExplicitos[cat].push(mes);

    // Propagar hacia adelante: hasta 24 meses futuros,
    // solo en meses que NO fueron fijados explícitamente por el usuario
    const [y, m] = mes.split('-').map(Number);
    for (let i = 1; i <= 24; i++) {
      const fd = new Date(y, m - 1 + i, 1);
      const fym = fd.getFullYear() + '-' + String(fd.getMonth() + 1).padStart(2, '0');
      const esExplicito = (presupuestosExplicitos[cat] || []).includes(fym);
      if (!esExplicito) {
        if (!presupuestos[fym]) presupuestos[fym] = {};
        presupuestos[fym][cat] = val;
      }
    }
  }

  save();
  notify('✓ Presupuesto guardado y propagado a meses futuros');
  renderPresupuesto();
}
window.cambiarMesPresupuesto = cambiarMesPresupuesto;
window.guardarPresupuestoCat = guardarPresupuestoCat;

// ---- REPORTES Y GRÁFICOS ----
let repPeriodo = 3;
const _charts = {};

function setRepPeriodo(n, btn) {
  repPeriodo = n;
  document.querySelectorAll('[id^="rep-per-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderReportes();
}
window.setRepPeriodo = setRepPeriodo;

function _cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function _destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function _getMeses(n) {
  const meses = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return meses;
}

function _totalIngresosYm(ym) {
  let total = 0;
  ingresos.forEach(ing => {
    const base = ing.ymBase || ing.key?.slice(0, 7) || '';
    if (base !== ym) return;
    if ((ing.sueldoMoneda || 'ARS') === 'ARS') total += (ing.sueldo || 0);
    (ing.otros || []).forEach(o => { if ((o.moneda || 'ARS') === 'ARS') total += (o.monto || 0); });
  });
  return total;
}

function renderReportes() {
  const meses = _getMeses(repPeriodo);
  const labels = meses.map(m => MESES[parseInt(m.slice(5, 7)) - 1].slice(0, 3) + ' ' + m.slice(2, 4));
  const text2 = _cssVar('--text2') || '#ccc';
  const border = _cssVar('--border') || '#333';

  // Paleta de colores
  const PALETTE = ['#6ee7b7','#93c5fd','#fcd34d','#f9a8d4','#a5b4fc','#86efac','#fdba74','#67e8f9','#c4b5fd','#fb923c'];

  // ── 1. Ingresos vs Gastos ────────────────────────────────────────────────
  _destroyChart('ing-gasto');
  const ingData = meses.map(m => _totalIngresosYm(m));
  const gasData = meses.map(m => gastosDelMes(m).filter(g => (g.moneda || 'ARS') === 'ARS').reduce((s, g) => s + g.monto, 0));

  _charts['ing-gasto'] = new Chart($('chart-ing-gasto'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Ingresos', data: ingData, backgroundColor: '#6ee7b766', borderColor: '#6ee7b7', borderWidth: 2, borderRadius: 6 },
        { label: 'Gastos',   data: gasData, backgroundColor: '#f87171aa', borderColor: '#f87171', borderWidth: 2, borderRadius: 6 }
      ]
    },
    options: {
      responsive: true, plugins: { legend: { labels: { color: text2 } } },
      scales: {
        x: { ticks: { color: text2 }, grid: { color: border } },
        y: { ticks: { color: text2, callback: v => '$' + fmt(v) }, grid: { color: border } }
      }
    }
  });

  // ── 2. Gastos por categoría (donut) ─────────────────────────────────────
  _destroyChart('cats');
  const gastadoCat = {};
  meses.forEach(m => gastosDelMes(m).forEach(g => {
    if ((g.moneda || 'ARS') !== 'ARS') return;
    gastadoCat[g.cat] = (gastadoCat[g.cat] || 0) + g.monto;
  }));
  const catEntries = Object.entries(gastadoCat).sort((a, b) => b[1] - a[1]);
  const totalCat = catEntries.reduce((s, [, v]) => s + v, 0);

  if (catEntries.length) {
    _charts['cats'] = new Chart($('chart-cats'), {
      type: 'doughnut',
      data: {
        labels: catEntries.map(([c]) => c),
        datasets: [{ data: catEntries.map(([, v]) => v), backgroundColor: catEntries.map(([c]) => catColor(c)), borderWidth: 0 }]
      },
      options: { responsive: true, plugins: { legend: { display: false } } }
    });
    $('chart-cats-legend').innerHTML = catEntries.map(([c, v], i) =>
      `<div style="display:flex;justify-content:space-between;gap:12px">
        <span><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${catColor(c)};margin-right:6px"></span>${escHtml(c)}</span>
        <span style="color:var(--text3)">${totalCat > 0 ? Math.round(v / totalCat * 100) : 0}% · $${fmt(v)}</span>
      </div>`).join('');
  } else {
    $('chart-cats-legend').innerHTML = '<span style="color:var(--text3)">Sin datos</span>';
  }

  // ── 3. Evolución del ahorro total ────────────────────────────────────────
  _destroyChart('ahorro');
  const ahorroData = meses.map(m => {
    return ahorros.filter(a => {
      const aym = a.ymBase || a.key?.slice(0, 7) || '';
      return aym <= m;
    }).reduce((s, a) => s + ((a.moneda || 'ARS') === 'ARS' ? (a.monto || 0) : 0), 0);
  });

  _charts['ahorro'] = new Chart($('chart-ahorro'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Ahorro acumulado ARS',
        data: ahorroData,
        borderColor: '#fcd34d', backgroundColor: '#fcd34d22',
        borderWidth: 2, pointRadius: 4, fill: true, tension: 0.3
      }]
    },
    options: {
      responsive: true, plugins: { legend: { labels: { color: text2 } } },
      scales: {
        x: { ticks: { color: text2 }, grid: { color: border } },
        y: { ticks: { color: text2, callback: v => '$' + fmt(v) }, grid: { color: border } }
      }
    }
  });

  // ── 4. Top categorías (barra horizontal) ────────────────────────────────
  _destroyChart('top-cats');
  const top = catEntries.slice(0, 8);

  _charts['top-cats'] = new Chart($('chart-top-cats'), {
    type: 'bar',
    data: {
      labels: top.map(([c]) => c),
      datasets: [{
        label: 'Gasto total ARS',
        data: top.map(([, v]) => v),
        backgroundColor: top.map(([c]) => catColor(c)),
        borderRadius: 6, borderWidth: 0
      }]
    },
    options: {
      indexAxis: 'y', responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: text2, callback: v => '$' + fmt(v) }, grid: { color: border } },
        y: { ticks: { color: text2 }, grid: { color: border } }
      }
    }
  });
}
window.renderReportes = renderReportes;

function renderDashboard() {
  // Saludo personalizado
  const greetEl = document.getElementById('dash-greeting');
  if (greetEl) {
    const h = new Date().getHours();
    const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
    const emailRaw = window._currentUser?.email || '';
    const nombre = emailRaw.split('@')[0].replace(/[._]/g, ' ').split(' ')[0];
    const nombreCap = nombre ? nombre.charAt(0).toUpperCase() + nombre.slice(1) : '';
    greetEl.innerHTML = `${saludo}${nombreCap ? ', ' + nombreCap : ''} <span class="greeting-wave">👋</span><small>RESUMEN MENSUAL</small>`;
  }

  document.querySelectorAll('#tab-dashboard .cards .card').forEach(c => c.classList.remove('loading'));
  buildDashMonths();
  renderInsight();
  const ym = selectedDashMonth;

  // Gastos: normales en su mes + cuotas que caen en ym
  const itemsM = gastosDelMes(ym);
  // Cantidad de transacciones: gastos normales del mes + cuotas que caen este mes
  const gastosNormalesM = gastos.filter(g => !g.cuota && !g.esTransferencia && g.fecha.slice(0,7) === ym);
  const cuotasEnMes = gastos.filter(g => {
    if (!g.cuota) return false;
    const [fy, fm] = g.fecha.split('-').map(Number);
    const [wy, wm] = ym.split('-').map(Number);
    const n0 = (wy - fy) * 12 + (wm - fm);
    return n0 >= 0 && n0 < g.ncuotas;
  });

  const totalGasto = itemsM.filter(x => (x.moneda||'ARS')==='ARS').reduce((s, x) => s + x.monto, 0);
  const totalGastoUSDMes = itemsM.filter(x => x.moneda==='USD').reduce((s, x) => s + x.monto, 0);
  const ingM = ingresos.filter(i => !i.esTransferencia && (i.ymBase || i.key.slice(0,7)) === ym);
  const ahorrosM = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === ym);
  const totalIngreso = ingM.reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalAhorroMes = ahorrosM.reduce((s, a) => s + a.monto, 0);

  // Saldo ACUMULATIVO: todos los ingresos historicos + saldos iniciales - todos los gastos - todo el ahorro
  const totalIngresosHistorico = ingresos.filter(i => !i.esTransferencia).reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalGastosHistorico = (() => {
    // Sumar todos los gastos normales + todas las cuotas que ya cayeron hasta hoy
    const hoy = new Date().toISOString().slice(0,7);
    let total = 0;
    gastos.forEach(g => {
      if (g.esTransferencia) return;
      if ((g.moneda||'ARS') !== 'ARS') return;
      if (!g.cuota) {
        total += g.monto;
      } else {
        // Cuotas: solo las que ya cayeron hasta el mes actual
        const [fy, fm] = g.fecha.split('-').map(Number);
        const off = g.offsetCuotas || 0;
        for (let n = 0; n < g.ncuotas; n++) {
          let cy = fy, cm = fm + off + n;
          while (cm > 12) { cm -= 12; cy++; }
          const cuotaYm = cy + '-' + String(cm).padStart(2,'0');
          if (cuotaYm <= hoy) total += g.montoXcuota;
        }
      }
    });
    return total;
  })();
  const totalAhorroAcumulado = ahorros.reduce((s, a) => s + a.monto, 0);
  const totalSaldoInicial = Object.values(saldosIniciales || {}).reduce((s, v) => s + v, 0);
  // Disponible del mes: ingreso del mes - gasto del mes - ahorro del mes + ajustes del mes + saldo inicial
  const ajustesDelMes = (ajustesCuentas || []).filter(a => a.fecha.slice(0,7) === ym).reduce((s, a) => s + (a.monto || 0), 0);
  const saldo = totalIngreso - totalGasto - totalAhorroMes + ajustesDelMes + totalSaldoInicial;

  animateValue('d-gasto', totalGasto, '$');
  animateValue('d-ingreso', totalIngreso, '$');
  animateValue('d-saldo', saldo, '$');
  animateValue('d-ahorro', totalAhorroAcumulado, '$');

  // Tendencia vs mes anterior
  function prevYm(ym) {
    const [y, m] = ym.split('-').map(Number);
    return m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
  }
  function setTrend(elId, curr, prev, invertColors) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!prev || prev === 0) { el.textContent = ''; return; }
    const pct = Math.round((curr - prev) / prev * 100);
    if (pct === 0) { el.textContent = '→ igual que el mes anterior'; el.className = 'card-trend trend-neutral'; return; }
    const up = pct > 0;
    // invertColors: en gastos, subir es malo (rojo); en ingresos, subir es bueno (verde)
    const good = invertColors ? !up : up;
    el.className = `card-trend ${good ? 'trend-good' : 'trend-bad'}`;
    el.textContent = `${up ? '↑' : '↓'} ${Math.abs(pct)}% vs mes anterior`;
  }
  const prevM = prevYm(ym);
  const gastosPrevM = gastosDelMes(prevM).filter(x => (x.moneda||'ARS')==='ARS').reduce((s, x) => s + x.monto, 0);
  const ingPrevM = ingresos.filter(i => !i.esTransferencia && (i.ymBase || i.key.slice(0,7)) === prevM).reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  setTrend('d-gasto-trend', totalGasto, gastosPrevM, true);
  setTrend('d-ingreso-trend', totalIngreso, ingPrevM, false);
  const nTx = gastosNormalesM.length + cuotasEnMes.length;
  $('d-gastos-n').textContent = nTx + ' transacciones' + (cuotasEnMes.length ? ` (${cuotasEnMes.length} en cuotas)` : '');
  $('d-cuotas').textContent = gastos.filter(g => g.cuota).length;
  // Sub de cuotas: total adeudado
  const today = new Date();
  const totalAdeudado = gastos.filter(g => g.cuota).reduce((s, g) => {
    const [fy, fm] = g.fecha.split('-').map(Number);
    const off = g.offsetCuotas || 0;
    let sy = fy, sm = fm + off;
    while (sm > 12) { sm -= 12; sy++; }
    const todayYm = today.getFullYear() * 12 + today.getMonth();
    const startYm = sy * 12 + (sm - 1);
    const mesesPasados = todayYm - startYm;
    const restantes = g.ncuotas - Math.min(Math.max(mesesPasados + 1, 0), g.ncuotas);
    return s + restantes * g.montoXcuota;
  }, 0);
  const subCuotas = $('d-cuotas-sub');
  if (subCuotas) subCuotas.textContent = totalAdeudado > 0 ? '$' + fmt(totalAdeudado) + ' adeudado' : 'todo pago';

  renderDashCuotas();
  _renderSaldoUSDPanel(ym);

  // Saldo sub label
  const subEl = $('d-saldo-sub');
  if (subEl) subEl.textContent = totalAhorroMes > 0 ? 'ingresos - gastos - ahorro del mes' : 'ingresos - gastos del mes';

  // Saldo color
  const saldoEl = $('d-saldo');
  saldoEl.style.color = saldo >= 0 ? 'var(--accent)' : 'var(--accent2)';

  // Category bars (incluye cuotas del mes)
  const catMap = {};
  itemsM.filter(x => (x.moneda||'ARS')==='ARS').forEach(x => { catMap[x.cat] = (catMap[x.cat] || 0) + x.monto; });
  const sorted = Object.entries(catMap).sort((a,b) => b[1]-a[1]);
  const catEl = $('cat-bars');
  if (catEl) {
    if (!sorted.length) {
      catEl.innerHTML = emptyState('chart', 'Sin gastos aún', 'Registrá un gasto para ver el desglose');
    } else {
      const maxCat = sorted[0][1];
      catEl.innerHTML = sorted.map(([cat, val]) => `
        <div class="bar-item">
          <div class="bar-label">${cat}</div>
          <div class="bar-track">
            <div class="bar-fill" style="width:${(val/maxCat*100).toFixed(1)}%;background:${catColor(cat)}"></div>
          </div>
          <div class="bar-val">$${fmt(val)}</div>
        </div>`).join('');
    }
  }

  // Monthly evolution chart (Chart.js)
  const monthlyCanvas = $('chart-monthly');
  if (monthlyCanvas) {
    const allMonths = [...new Set([
      ...gastos.map(g => g.fecha.slice(0,7)),
      ...ingresos.map(i => i.ymBase || (i.key||'').slice(0,7))
    ].filter(Boolean))].sort().slice(-6);

    _destroyChart('monthly');

    if (!allMonths.length) return;

    const labels = allMonths.map(m => MESES[parseInt(m.slice(5,7))-1].slice(0,3));
    const dataGasto  = allMonths.map(m => totalDelMes(m));
    const dataIngreso = allMonths.map(m =>
      ingresos.filter(i=>(i.ymBase||i.key.slice(0,7))===m).reduce((s,i)=>s+(i.totalARS??i.total??0),0)
    );

    // Saldo evolution chart
    const saldoCanvas = $('chart-saldo-evol');
    if (saldoCanvas) {
      _destroyChart('saldo-evol');
      const saldoData = allMonths.map(m => {
        const ing = ingresos.filter(i => !i.esTransferencia && (i.ymBase || i.key.slice(0,7)) === m)
          .reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
        const gas = gastosDelMes(m).filter(x => (x.moneda||'ARS')==='ARS').reduce((s, x) => s + x.monto, 0);
        const aho = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === m).reduce((s, a) => s + a.monto, 0);
        const adj = (ajustesCuentas || []).filter(a => a.fecha.slice(0,7) === m).reduce((s, a) => s + (a.monto || 0), 0);
        return ing - gas - aho + adj;
      });
      const positiveColor = 'rgba(24,212,123,0.9)';
      const negativeColor = 'rgba(255,79,94,0.9)';
      _charts['saldo-evol'] = new Chart(saldoCanvas, {
        type: 'line',
        data: {
          labels,
          datasets: [{
            label: 'Saldo disponible',
            data: saldoData,
            borderColor: positiveColor,
            borderWidth: 2.5,
            pointBackgroundColor: saldoData.map(v => v >= 0 ? positiveColor : negativeColor),
            pointRadius: 4,
            pointHoverRadius: 6,
            fill: true,
            backgroundColor: 'rgba(24,212,123,0.07)',
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          animation: { duration: 600, easing: 'easeOutCubic' },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: 'rgba(9,16,28,0.92)',
              borderColor: 'rgba(255,255,255,0.1)',
              borderWidth: 1,
              titleColor: '#f8fafc',
              bodyColor: 'rgba(182,194,209,0.85)',
              titleFont: { family: "'Sora', sans-serif", size: 11, weight: '600' },
              bodyFont: { family: "'DM Mono', monospace", size: 11 },
              padding: 10, cornerRadius: 10,
              callbacks: { label: ctx => ` Saldo: $${fmt(ctx.parsed.y)}` }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: 'rgba(113,128,150,0.85)', font: { family: "'DM Mono', monospace", size: 10 } },
              border: { display: false }
            },
            y: {
              grid: { color: 'rgba(255,255,255,0.05)' },
              ticks: {
                color: 'rgba(113,128,150,0.75)',
                font: { family: "'DM Mono', monospace", size: 9 },
                maxTicksLimit: 4,
                callback: v => '$' + (Math.abs(v) >= 1000 ? Math.round(v/1000) + 'k' : fmt(v))
              },
              border: { display: false }
            }
          }
        }
      });
    }

    _charts['monthly'] = new Chart(monthlyCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Gasto',
            data: dataGasto,
            backgroundColor: 'rgba(255,79,94,0.75)',
            borderRadius: 6,
            borderSkipped: false,
            barPercentage: 0.72,
            categoryPercentage: 0.82
          },
          {
            label: 'Ingreso',
            data: dataIngreso,
            backgroundColor: 'rgba(24,212,123,0.75)',
            borderRadius: 6,
            borderSkipped: false,
            barPercentage: 0.72,
            categoryPercentage: 0.82
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 500, easing: 'easeOutCubic' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'bottom',
            labels: {
              color: 'rgba(182,194,209,0.7)',
              font: { family: "'DM Mono', monospace", size: 10 },
              boxWidth: 10, boxHeight: 10, borderRadius: 3,
              padding: 12
            }
          },
          tooltip: {
            backgroundColor: 'rgba(9,16,28,0.92)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#f8fafc',
            bodyColor: 'rgba(182,194,209,0.85)',
            titleFont: { family: "'Sora', sans-serif", size: 11, weight: '600' },
            bodyFont: { family: "'DM Mono', monospace", size: 11 },
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: $${fmt(ctx.parsed.y)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              color: 'rgba(113,128,150,0.85)',
              font: { family: "'DM Mono', monospace", size: 10 }
            },
            border: { display: false }
          },
          y: {
            grid: { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color: 'rgba(113,128,150,0.75)',
              font: { family: "'DM Mono', monospace", size: 9 },
              maxTicksLimit: 4,
              callback: v => '$' + (v >= 1000 ? Math.round(v/1000) + 'k' : fmt(v))
            },
            border: { display: false }
          }
        }
      }
    });
  }
}

// ---- SALDO POR CUENTA ----

function toggleDetalleCuenta(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const open = el.style.display === 'flex';
  el.style.display = open ? 'none' : 'flex';
}

function toggleCuentaPanel(panelId) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  // Cerrar todos los paneles de esta cuenta
  const safeC = panelId.replace(/^(ajuste-|mover-|cambio-)/, '');
  ['ajuste-' + safeC, 'mover-' + safeC, 'cambio-' + safeC].forEach(id => {
    const p = document.getElementById(id);
    if (p) p.style.display = 'none';
  });
  if (!isOpen) panel.style.display = 'flex';
}

function renderSaldoCuentas() {
  const el = $('saldo-cuentas-body');
  if (!el) return;

  // Cuentas: Efectivo + billeteras + débito
  const cuentas = ['Efectivo'];
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => cuentas.push(t.label || t.banco || t.nombre));
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
    let lbl = t.label || ('CA ' + t.banco);
    if (lbl.startsWith('Débito ')) lbl = 'CA ' + lbl.slice(7);
    cuentas.push(lbl);
  });

  // Función que normaliza el destino guardado al nombre actual de la cuenta
  // Ej: "Débito Santander" → "CA Santander"
  const normalizarDestino = (dest) => {
    if (!dest) return '';
    // Buscar coincidencia exacta primero
    if (cuentas.includes(dest)) return dest;
    // Si empieza con "Débito ", intentar con "CA "
    if (dest.startsWith('Débito ')) {
      const alt = 'CA ' + dest.slice(7);
      if (cuentas.includes(alt)) return alt;
    }
    // Buscar por banco parcial
    const match = cuentas.find(c => {
      const cn = c.toLowerCase().replace(/^ca |^débito /i, '');
      const dn = dest.toLowerCase().replace(/^ca |^débito /i, '');
      return cn === dn;
    });
    return match || dest;
  };

  const mediosReales = new Set(cuentas);

  // Saldo: arranca desde saldo inicial configurado en Ajustes
  const saldos = {};
  cuentas.forEach(c => { saldos[c] = { ars: saldosIniciales[c] || 0, usd: 0 }; });
  // Cuenta especial para ingresos sin destino asignado
  saldos['__sinasignar__'] = { ars: 0, usd: 0 };

  // + Ingresos acumulados (todos los meses)
  ingresos.forEach(i => {
    const dest = normalizarDestino(i.sueldoDestino || '');
    if (i.sueldo > 0) {
      const key = (dest && saldos[dest] !== undefined) ? dest : '__sinasignar__';
      if ((i.sueldoMoneda || 'ARS') === 'ARS') saldos[key].ars += i.sueldo;
      else saldos[key].usd += i.sueldo;
    }
    (i.otros || []).forEach(o => {
      const d = normalizarDestino(o.destino || '');
      const key = (d && saldos[d] !== undefined) ? d : '__sinasignar__';
      if ((o.moneda || 'ARS') === 'ARS') saldos[key].ars += o.monto;
      else saldos[key].usd += o.monto;
    });
  });

  // − Gastos pagados con medios reales (no cuotas = crédito)
  gastos.forEach(g => {
    if (g.cuota) return;
    const medio = normalizarDestino(g.medio || '');
    if (medio && saldos[medio] !== undefined) {
      saldos[medio].ars -= g.monto;
    }
  });

  // + Ajustes manuales (array dedicado, no afecta Dashboard)
  (ajustesCuentas || []).forEach(a => {
    const cuenta = normalizarDestino(a.cuenta);
    if (saldos[cuenta] !== undefined) saldos[cuenta].ars += a.monto;
  });

  // − Base de ahorros depositados desde cada cuenta (omite los preexistentes)
  ahorros.forEach(a => {
    if ((a.origen || '') === '__ya_lo_tenia__') return; // preexistente: ya está en saldo inicial
    const orig = normalizarDestino(a.origen || '');
    if (orig && saldos[orig] !== undefined) {
      const base = a.monto - (a.rendimientos || 0);
      if ((a.moneda || 'ARS') === 'ARS') saldos[orig].ars -= base;
      else saldos[orig].usd -= base;
    }
  });

  // − Cuotas del mes actual de tarjetas de crédito (auto-débito por banco asociado)
  const mesActual = new Date().toISOString().slice(0,7);
  tarjetas.filter(t => (t.tipo||'credito') === 'credito').forEach(t => {
    const nombreTarjeta = t.label || t.nombre || t.banco;
    const caDebito = tarjetas.find(d => d.tipo === 'debito' && d.banco === t.banco);
    if (!caDebito) return;
    let caLabel = caDebito.label || ('CA ' + caDebito.banco);
    if (caLabel.startsWith('Débito ')) caLabel = 'CA ' + caLabel.slice(7);
    const caKey = normalizarDestino(caLabel);
    if (saldos[caKey] === undefined) return;
    const cuotasMes = calcularTotalTarjetaMes(nombreTarjeta, mesActual);
    saldos[caKey].ars -= cuotasMes;
  });

  // Construir options de destino para panel Mover
  const opcionesDestino = (excluir) => cuentas
    .filter(c => c !== excluir)
    .map(c => {
      const ic = c === 'Efectivo' ? '💵' : tarjetas.find(t=>t.tipo==='billetera'&&(t.label||t.banco||t.nombre)===c) ? '📱' : '🏦';
      return `<option value="${c}">${ic} ${c}</option>`;
    }).join('');

  const sinAsignar = saldos['__sinasignar__'];
  const extraRow = (sinAsignar.ars !== 0 || sinAsignar.usd !== 0) ? `
    <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--border);background:rgba(245,184,46,0.04)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1.3rem">❓</span>
          <div>
            <div style="font-size:0.88rem;font-weight:700;color:var(--accent3)">Sin destino asignado</div>
            <div style="font-size:0.68rem;color:var(--text3);margin-top:2px">Ingresos registrados sin indicar a qué cuenta</div>
            <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent3);font-size:1rem">$${fmt(sinAsignar.ars)}</div>
          </div>
        </div>
        <a onclick="showTab('ingresos')" style="font-size:0.72rem;color:var(--accent4);cursor:pointer;text-decoration:underline;flex-shrink:0">Asignar →</a>
      </div>
    </div>` : '';

  el.innerHTML = cuentas.map(c => {
    const { ars, usd } = saldos[c];
    const icon = c === 'Efectivo' ? '💵' : tarjetas.find(t=>t.tipo==='billetera'&&(t.label||t.banco||t.nombre)===c) ? '📱' : '🏦';
    const arsColor = ars < 0 ? 'var(--accent2)' : 'var(--accent)';
    const usdColor = usd < 0 ? 'var(--accent2)' : 'var(--accent3)';
    const safeC = c.replace(/[^a-zA-Z0-9_-]/g, '_');

    // Detalle: movimientos que afectan esta cuenta
    const ingC = [];
    ingresos.forEach(i => {
      if (i.sueldo > 0 && normalizarDestino(i.sueldoDestino||'') === c) ingC.push({ fecha: i.ymBase||i.key.slice(0,7), desc: 'Sueldo', monto: i.sueldo, moneda: i.sueldoMoneda||'ARS' });
      (i.otros||[]).forEach(o => { if (normalizarDestino(o.destino||'') === c) ingC.push({ fecha: i.ymBase||i.key.slice(0,7), desc: o.concepto||o.nombre||'Ingreso', monto: o.monto, moneda: o.moneda||'ARS' }); });
    });
    const gasCAll = gastos.filter(g => normalizarDestino(g.medio||'') === c);
    const gasC    = gasCAll.filter(g => !g.cuota);
    const gasCQ   = gasCAll.filter(g => !!g.cuota);
    const ahoC = ahorros.filter(a => normalizarDestino(a.origen||'') === c);
    const ahoCPreex = ahorros.filter(a => (a.origen||'') === '__ya_lo_tenia__');
    const ajuC = (ajustesCuentas||[]).filter(a => a.cuenta === c);
    const totalIng = ingC.reduce((s,x) => s + x.monto, 0);
    const totalGas = gasC.reduce((s,g) => s + g.monto, 0);
    const totalAho = ahoC.reduce((s,a) => s + (a.monto-(a.rendimientos||0)), 0); // solo los que realmente salen de esta cuenta
    const totalAju = ajuC.reduce((s,a) => s + a.monto, 0);
    const saldoIni = saldosIniciales[c] || 0;

    return `
    <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px">
        <div onclick="toggleDetalleCuenta('detalle-${safeC}')" style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;cursor:pointer;min-width:140px">
          <span style="font-size:1.3rem;flex-shrink:0">${icon}</span>
          <div style="min-width:0">
            <div style="font-size:0.88rem;font-weight:700;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px">${c} <span style="font-size:0.65rem;color:var(--text3);font-weight:400">▾ ver detalle</span></div>
            <div style="font-family:'DM Mono',monospace;font-weight:700;color:${arsColor};font-size:1rem">$${fmt(ars)}</div>
            ${usd !== 0 ? `<div style="font-family:'DM Mono',monospace;font-weight:700;color:${usdColor};font-size:0.82rem">u$s ${fmt(usd)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0;margin-left:auto">
          <button onclick="toggleCuentaPanel('ajuste-${safeC}')" style="background:rgba(245,184,46,0.1);border:1px solid rgba(245,184,46,0.4);color:var(--accent3);border-radius:10px;padding:10px 12px;font-size:0.8rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:44px;touch-action:manipulation;white-space:nowrap">✏ Ajustar</button>
          <button onclick="toggleCuentaPanel('mover-${safeC}')" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.4);color:var(--accent4);border-radius:10px;padding:10px 12px;font-size:0.8rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:44px;touch-action:manipulation;white-space:nowrap">↔ Mover</button>
          <button onclick="toggleCuentaPanel('cambio-${safeC}')" style="background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.4);color:var(--accent3);border-radius:10px;padding:10px 12px;font-size:0.8rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:44px;touch-action:manipulation;white-space:nowrap">💱 USD</button>
        </div>
      </div>
      <!-- Panel Detalle -->
      <div id="detalle-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;font-size:0.8rem">
        ${saldoIni !== 0 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:rgba(245,184,46,0.07);border:1px solid rgba(245,184,46,0.18);border-radius:10px">
          <span style="color:var(--text3)">🏁 Saldo inicial</span>
          <span style="font-family:monospace;font-weight:700;color:var(--accent3)">+ $${fmt(saldoIni)}</span>
        </div>` : ''}
        ${ingC.length ? `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(0,200,130,0.07);border-bottom:1px solid var(--border)">
            <span style="font-weight:600;color:var(--text2)">💵 Ingresos <span style="font-size:0.7rem;color:var(--text3);font-weight:400">${ingC.length} movimientos</span></span>
            <span style="font-family:monospace;font-weight:700;color:var(--accent)">+ $${fmt(totalIng)}</span>
          </div>
          ${ingC.map(x=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 20px;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="color:var(--text3);max-width:65%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x.fecha} · ${x.desc}</span>
            <span style="font-family:monospace;color:var(--accent);font-size:0.77rem">+ $${fmt(x.monto)}</span>
          </div>`).join('')}
        </div>` : ''}
        ${gasC.length ? `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(255,79,94,0.07);border-bottom:1px solid var(--border)">
            <span style="font-weight:600;color:var(--text2)">💸 Gastos <span style="font-size:0.7rem;color:var(--text3);font-weight:400">${gasC.length} movimientos</span></span>
            <span style="font-family:monospace;font-weight:700;color:var(--accent2)">− $${fmt(totalGas)}</span>
          </div>
          ${gasC.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).map(g=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 20px;border-bottom:1px solid rgba(255,255,255,0.04)">
            <div style="min-width:0;flex:1;margin-right:8px">
              <div style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(g.desc||g.cat)}</div>
              <div style="font-size:0.68rem;color:var(--text3)">${g.fecha||''} · ${escHtml(g.cat||'')}</div>
            </div>
            <span style="font-family:monospace;color:var(--accent2);font-size:0.77rem;flex-shrink:0">− $${fmt(g.monto)}</span>
          </div>`).join('')}
        </div>` : ''}
        ${gasCQ.length ? `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(255,79,94,0.04);border-bottom:1px solid var(--border)">
            <span style="font-weight:600;color:var(--text2)">💳 En cuotas <span style="font-size:0.7rem;color:var(--text3);font-weight:400">${gasCQ.length} compras · debitado por tarjeta</span></span>
          </div>
          ${gasCQ.sort((a,b)=>(b.fecha||'').localeCompare(a.fecha||'')).map(g=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 20px;border-bottom:1px solid rgba(255,255,255,0.04)">
            <div style="min-width:0;flex:1;margin-right:8px">
              <div style="color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(g.desc||g.cat)}</div>
              <div style="font-size:0.68rem;color:var(--text3)">${g.fecha||''} · ${g.ncuotas}x $${fmt(g.montoXcuota)}</div>
            </div>
            <span style="font-family:monospace;color:var(--text3);font-size:0.77rem;flex-shrink:0">$${fmt(g.monto)} total</span>
          </div>`).join('')}
        </div>` : ''}
        ${ahoC.length ? `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(100,130,246,0.07);border-bottom:1px solid var(--border)">
            <span style="font-weight:600;color:var(--text2)">🏦 Ahorros <span style="font-size:0.7rem;color:var(--text3);font-weight:400">${ahoC.length} movimientos</span></span>
            <span style="font-family:monospace;font-weight:700;color:var(--accent4)">− $${fmt(totalAho)}</span>
          </div>
          ${ahoC.map(a=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 20px;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="color:var(--text3)">${a.ymBase||a.key.slice(0,7)} · ${a.concepto||a.tipo||'Ahorro'}</span>
            <span style="font-family:monospace;color:var(--accent4);font-size:0.77rem">− $${fmt(a.monto-(a.rendimientos||0))}</span>
          </div>`).join('')}
        </div>` : ''}
        ${ajuC.length ? `
        <div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(245,184,46,0.07);border-bottom:1px solid var(--border)">
            <span style="font-weight:600;color:var(--text2)">🔧 Ajustes <span style="font-size:0.7rem;color:var(--text3);font-weight:400">${ajuC.length} registros</span></span>
            <span style="font-family:monospace;font-weight:700;color:var(--accent3)">${totalAju>=0?'+ ':'− '}$${fmt(Math.abs(totalAju))}</span>
          </div>
          ${ajuC.map(a=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 20px;border-bottom:1px solid rgba(255,255,255,0.04)">
            <span style="color:var(--text3)">${a.fecha} · $${(a.saldoAntes||0).toLocaleString('es-AR')} → $${(a.saldoDespues||0).toLocaleString('es-AR')}</span>
            <span style="font-family:monospace;color:${a.monto>=0?'var(--accent)':'var(--accent2)'};font-size:0.77rem">${a.monto>=0?'+ ':'− '}$${fmt(Math.abs(a.monto))}</span>
          </div>`).join('')}
        </div>` : ''}
        ${(() => {
          // Auto-débito: cuotas de tarjetas de crédito del mismo banco, descontadas del CA este mes
          const tarjetasCred = tarjetas.filter(t => (t.tipo||'credito') === 'credito' && tarjetas.find(d => d.tipo === 'debito' && d.banco === t.banco && (() => { let l = d.label||('CA '+d.banco); if(l.startsWith('Débito ')) l='CA '+l.slice(7); return l; })() === c));
          if (!tarjetasCred.length) return '';
          const mesActual = new Date().toISOString().slice(0,7);
          const filas = tarjetasCred.map(t => {
            const nombre = t.label||t.nombre||t.banco;
            const monto = calcularTotalTarjetaMes(nombre, mesActual);
            return { nombre, monto };
          }).filter(f => f.monto > 0);
          if (!filas.length) return '';
          const totalDebit = filas.reduce((s,f) => s+f.monto, 0);
          return `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:10px;overflow:hidden">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(255,79,94,0.07);border-bottom:1px solid var(--border)">
              <span style="font-weight:600;color:var(--text2)">💳 Auto-débito tarjeta <span style="font-size:0.7rem;color:var(--text3);font-weight:400">cuotas ${mesActual}</span></span>
              <span style="font-family:monospace;font-weight:700;color:var(--accent2)">− $${fmt(totalDebit)}</span>
            </div>
            ${filas.map(f=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 20px;border-bottom:1px solid rgba(255,255,255,0.04)">
              <span style="color:var(--text3)">${f.nombre} · cuotas del mes</span>
              <span style="font-family:monospace;color:var(--accent2);font-size:0.77rem">− $${fmt(f.monto)}</span>
            </div>`).join('')}
          </div>`;
        })()}
        ${!ingC.length && !gasCAll.length && !ahoC.length && !ajuC.length && saldoIni === 0 ? `
        <div style="text-align:center;padding:1.2rem;color:var(--text3);font-size:0.78rem">Sin movimientos registrados</div>` : ''}
      </div>
      <!-- Panel Ajustar -->
      <div id="ajuste-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;background:rgba(245,184,46,0.06);border:1px solid rgba(245,184,46,0.2);border-radius:12px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent3);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Ajustar saldo de ${c}</div>
        <div style="font-size:0.72rem;color:var(--text3)">Ingresá el saldo real que tenés ahora. La diferencia se registra automáticamente y <strong>no afecta el Dashboard</strong>.</div>
        <input id="ajuste-input-${safeC}" type="number" placeholder="Saldo real actual ($)" step="0.01"
          style="background:var(--bg);border:1px solid var(--accent3);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
        <button onclick="aplicarAjusteCuenta('${c}', '${safeC}', ${ars})"
          style="background:var(--accent3);border:none;color:#0d0f14;border-radius:10px;padding:14px;font-size:0.9rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700;min-height:48px;width:100%;touch-action:manipulation">✓ Aplicar ajuste</button>
        ${(ajustesCuentas||[]).filter(a=>a.cuenta===c).length > 0 ? `
        <div style="margin-top:4px;border-top:1px solid rgba(245,184,46,0.2);padding-top:8px">
          <div style="font-size:0.68rem;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Historial de ajustes</div>
          ${(ajustesCuentas||[]).filter(a=>a.cuenta===c).map(a => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div>
              <div style="font-size:0.75rem;color:var(--text2)">${a.fecha} · $${a.saldoAntes?.toLocaleString('es-AR')} → $${a.saldoDespues?.toLocaleString('es-AR')}</div>
              <div style="font-size:0.7rem;color:${a.monto>0?'var(--accent)':'var(--accent2)'}">${a.monto>0?'+':''}$${fmt(Math.abs(a.monto))}</div>
            </div>
            <button onclick="eliminarAjuste(${a.id})" style="background:rgba(255,79,94,0.08);border:1px solid rgba(255,79,94,0.4);color:var(--accent2);border-radius:8px;padding:9px 14px;font-size:0.82rem;cursor:pointer;min-height:44px;touch-action:manipulation">✕</button>
          </div>`).join('')}
        </div>` : ''}
      </div>
      <!-- Panel Mover -->
      <div id="mover-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent4);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Mover dinero desde ${c}</div>
        <input id="mover-input-${safeC}" type="number" placeholder="Monto a mover ($)" min="0" step="0.01"
          style="background:var(--bg);border:1px solid var(--accent4);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
        <select id="mover-destino-${safeC}"
          style="background:var(--bg);border:1px solid var(--accent4);border-radius:10px;color:var(--text);font-family:'Sora',sans-serif;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
          <option value="">→ ¿A dónde?</option>
          ${opcionesDestino(c)}
        </select>
        <button onclick="moverEntreCuentas('${c}', '${safeC}')"
          style="background:var(--accent4);border:none;color:#fff;border-radius:10px;padding:14px;font-size:0.9rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700;min-height:48px;width:100%;touch-action:manipulation">↔ Confirmar movimiento</button>
      </div>
      <!-- Panel Cambio (compra de USD) -->
      <div id="cambio-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;background:rgba(45,212,191,0.06);border:1px solid rgba(45,212,191,0.2);border-radius:12px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent3);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Comprar USD desde ${c}</div>
        <input id="cambio-ars-${safeC}" type="number" placeholder="Monto en pesos ($)" min="0" step="0.01" oninput="actualizarCotizacion('${safeC}')"
          style="background:var(--bg);border:1px solid var(--accent3);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
        <input id="cambio-usd-${safeC}" type="number" placeholder="Monto en u$s recibido" min="0" step="0.01" oninput="actualizarCotizacion('${safeC}')"
          style="background:var(--bg);border:1px solid var(--accent3);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
        <div id="cambio-cotiz-${safeC}" style="font-size:0.72rem;color:var(--text3)">Cotización: —</div>
        <button onclick="comprarUSD('${c}', '${safeC}')"
          style="background:var(--accent3);border:none;color:#0d0f14;border-radius:10px;padding:14px;font-size:0.9rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700;min-height:48px;width:100%;touch-action:manipulation">💱 Confirmar compra</button>
      </div>
    </div>`;
  }).join('') + extraRow;

  // Cerrar todos los paneles cuando se hace click afuera
  document.querySelectorAll('div[id^="ajuste-"], div[id^="mover-"]').forEach(p => {
    if (!p.id.startsWith('ajuste-input') && !p.id.startsWith('mover-input') && !p.id.startsWith('mover-destino')) {
      // already handled by toggleCuentaPanel
    }
  });
}

function aplicarAjusteCuenta(cuenta, safeC, saldoActual) {
  const input = document.getElementById('ajuste-input-' + safeC);
  const saldoReal = parseFloat(input.value);
  if (isNaN(saldoReal)) { notify('⚠ Ingresá un valor'); return; }
  const diferencia = +(saldoReal - saldoActual).toFixed(2);
  if (diferencia === 0) { notify('El saldo ya coincide'); return; }

  // Guardar en array dedicado — NO afecta ingresos ni gastos ni Dashboard
  if (!ajustesCuentas) ajustesCuentas = [];
  ajustesCuentas.push({
    id: Date.now(),
    cuenta,
    monto: diferencia,
    moneda: 'ARS',
    fecha: new Date().toISOString().slice(0,10),
    saldoAntes: saldoActual,
    saldoDespues: saldoReal
  });

  save();
  notify(`✓ Saldo de ${cuenta} ajustado ${diferencia > 0 ? '+' : ''}$${Math.abs(diferencia).toLocaleString('es-AR')}`);
  input.value = '';
  renderSaldoCuentas();
  renderAjustesHistorial();
}

function eliminarAjuste(id) {
  ajustesCuentas = ajustesCuentas.filter(a => a.id !== id);
  save();
  renderSaldoCuentas();
  renderAjustesHistorial();
  notify('Ajuste eliminado');
}

function moverEntreCuentas(origen, safeC) {
  const input = document.getElementById('mover-input-' + safeC);
  const destSel = document.getElementById('mover-destino-' + safeC);
  const monto = parseFloat(input.value);
  const destino = destSel.value;

  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  if (!destino) { notify('⚠ Seleccioná un destino'); return; }

  const hoy = new Date().toISOString().slice(0,10);
  // Salida del origen
  gastos.push({
    id: Date.now(), fecha: hoy,
    desc: `Transferencia → ${destino}`, cat: 'Transferencia',
    medio: origen, monto, notas: `Movimiento a ${destino}`,
    cuota: false, ncuotas: 1, montoXcuota: monto, offsetCuotas: 0,
    esTransferencia: true
  });
  // Entrada en destino (como ingreso extra)
  ingresos.push({
    id: Date.now() + 1,
    key: hoy.slice(0,7),
    ymBase: hoy.slice(0,7),
    año: parseInt(hoy.slice(0,4)),
    mes: MESES[parseInt(hoy.slice(5,7))-1],
    sueldo: 0, sueldoMoneda: 'ARS', sueldoConcepto: '', sueldoDestino: '',
    otros: [{ nombre: `Transferencia desde ${origen}`, monto, moneda: 'ARS', destino }],
    totalARS: monto, total: monto,
    esTransferencia: true
  });

  save();
  notify(`✓ $${fmt(monto)} movido de ${origen} a ${destino}`);
  input.value = '';
  destSel.value = '';
  renderSaldoCuentas();
  renderDashboard();
}

function actualizarCotizacion(safeC) {
  const ars = parseFloat(document.getElementById('cambio-ars-' + safeC)?.value);
  const usd = parseFloat(document.getElementById('cambio-usd-' + safeC)?.value);
  const el = document.getElementById('cambio-cotiz-' + safeC);
  if (!el) return;
  if (ars > 0 && usd > 0) {
    el.textContent = `Cotización: $${(ars/usd).toLocaleString('es-AR', {maximumFractionDigits: 2})} por u$s`;
  } else {
    el.textContent = 'Cotización: —';
  }
}

function comprarUSD(origen, safeC) {
  const montoARS = parseFloat(document.getElementById('cambio-ars-' + safeC)?.value);
  const montoUSD = parseFloat(document.getElementById('cambio-usd-' + safeC)?.value);

  if (!montoARS || montoARS <= 0) { notify('⚠ Ingresá el monto en pesos'); return; }
  if (!montoUSD || montoUSD <= 0) { notify('⚠ Ingresá el monto en u$s recibido'); return; }

  const hoy = new Date().toISOString().slice(0,10);
  // Salida en pesos del origen
  gastos.push({
    id: Date.now(), fecha: hoy,
    desc: `Compra de USD`, cat: 'Compra de USD',
    medio: origen, monto: montoARS, moneda: 'ARS',
    notas: `Cotización $${(montoARS/montoUSD).toLocaleString('es-AR', {maximumFractionDigits: 2})}`,
    cuota: false, ncuotas: 1, montoXcuota: montoARS, offsetCuotas: 0
  });
  // Entrada en USD
  ingresos.push({
    id: Date.now() + 1,
    key: hoy.slice(0,7),
    ymBase: hoy.slice(0,7),
    año: parseInt(hoy.slice(0,4)),
    mes: MESES[parseInt(hoy.slice(5,7))-1],
    sueldo: 0, sueldoMoneda: 'ARS', sueldoConcepto: '', sueldoDestino: '',
    otros: [{ nombre: `Compra de USD`, monto: montoUSD, moneda: 'USD', destino: origen }],
    totalARS: 0, total: 0
  });

  save();
  notify(`✓ Comprados u$s ${fmt(montoUSD)} con $${fmt(montoARS)} de ${origen}`);
  document.getElementById('cambio-ars-' + safeC).value = '';
  document.getElementById('cambio-usd-' + safeC).value = '';
  document.getElementById('cambio-cotiz-' + safeC).textContent = 'Cotización: —';
  renderSaldoCuentas();
  renderDashboard();
}

function borrarTodosLosAjustes() {
  ajustesCuentas = [];
  save();
  renderSaldoCuentas();
  renderDashboard();
}

function calcularDeudaAcumuladaTarjeta(nombreTarjeta) {
  const hoy = new Date().toISOString().slice(0,7);
  const [wy, wm] = hoy.split('-').map(Number);
  let total = 0;
  gastos.forEach(g => {
    if ((g.medio || '') !== nombreTarjeta) return;
    if (!g.cuota) {
      if (g.fecha.slice(0,7) <= hoy) total += g.monto;
    } else {
      const [fy, fm] = g.fecha.split('-').map(Number);
      const off = g.offsetCuotas || 0;
      for (let n = 0; n < g.ncuotas; n++) {
        let cy = fy, cm = fm + off + n;
        while (cm > 12) { cm -= 12; cy++; }
        const cuotaYm = cy + '-' + String(cm).padStart(2,'0');
        if (cuotaYm <= hoy) total += g.montoXcuota;
      }
    }
  });
  const pagosYaHechos = gastos
    .filter(g => !g.cuota && g.cat === 'Tarjeta de crédito' && g.fecha.slice(0,7) <= hoy && g.desc === 'Pago resumen ' + nombreTarjeta)
    .reduce((s, g) => s + g.monto, 0);
  return Math.max(0, total - pagosYaHechos);
}

function calcularTotalTarjetaMes(nombreTarjeta, ym) {
  const [wy, wm] = ym.split('-').map(Number);
  let total = 0;
  gastos.forEach(g => {
    const medio = g.medio || '';
    if (medio !== nombreTarjeta) return;
    if (!g.cuota) {
      if (g.fecha.slice(0,7) === ym) total += g.monto;
    } else {
      const [fy, fm] = g.fecha.split('-').map(Number);
      const off = g.offsetCuotas || 0;
      for (let n = 0; n < g.ncuotas; n++) {
        let cy = fy, cm = fm + off + n;
        while (cm > 12) { cm -= 12; cy++; }
        if (cy === wy && cm === wm) total += g.montoXcuota;
      }
    }
  });
  // Restar pagos ya registrados para esta tarjeta en este mes
  const pagosYaHechos = gastos
    .filter(g => !g.cuota && g.cat === 'Tarjeta de crédito' && g.fecha.slice(0,7) === ym && g.desc === 'Pago resumen ' + nombreTarjeta)
    .reduce((s, g) => s + g.monto, 0);
  return Math.max(0, total - pagosYaHechos);
}
// ---- DASHBOARD CUOTAS ----

function toggleDashCuotas() {
  const body = $('dash-cuotas-body');
  const icon = $('dash-cuotas-icon');
  if (!body) return;
  const open = body.style.display !== 'none';
  body.style.display = open ? 'none' : 'block';
  if (icon) icon.style.transform = open ? '' : 'rotate(180deg)';
}

function renderDashCuotas() {
  const el = $('dash-cuotas-body');
  if (!el) return;
  const hoy = new Date().toISOString().slice(0,7);
  const [hy, hm] = hoy.split('-').map(Number);
  // Cuotas activas: tienen cuotas restantes
  const activas = gastos.filter(g => {
    if (!g.cuota) return false;
    const [fy, fm] = g.fecha.split('-').map(Number);
    const off = g.offsetCuotas || 0;
    let sy = fy, sm = fm + off;
    while (sm > 12) { sm -= 12; sy++; }
    const endCm = sm + g.ncuotas - 1;
    let ey = sy, em = endCm;
    while (em > 12) { em -= 12; ey++; }
    const endYm = ey + '-' + String(em).padStart(2,'0');
    return endYm >= hoy;
  });

  // Actualizar contadores del header
  const dcAct = $('dc-activas'); if (dcAct) dcAct.textContent = activas.length;
  const totalAdeu = activas.reduce((s,g) => {
    const [fy,fm] = g.fecha.split('-').map(Number);
    const off = g.offsetCuotas||0; let sy=fy,sm=fm+off;
    while(sm>12){sm-=12;sy++;}
    const today2 = new Date(); const cuotaAct2 = (today2.getFullYear()-sy)*12+(today2.getMonth()+1-sm)+1;
    const rest2 = g.ncuotas - Math.min(cuotaAct2, g.ncuotas);
    return s + rest2 * g.montoXcuota;
  }, 0);
  const dcTot = $('dc-total'); if (dcTot) dcTot.textContent = '$' + fmt(totalAdeu);

  if (!activas.length) {
    el.innerHTML = emptyState('cuotas', 'Sin cuotas activas', '¡Todo al día!');
    return;
  }

  // Calcular restantes para cada cuota y ordenar por urgencia (menos restantes primero)
  const activasConInfo = activas.map(g => {
    const [fy, fm] = g.fecha.split('-').map(Number);
    const off = g.offsetCuotas || 0;
    let sy = fy, sm = fm + off;
    while (sm > 12) { sm -= 12; sy++; }
    const cuotaActual = (hy - sy) * 12 + (hm - sm) + 1;
    const restantes = g.ncuotas - Math.min(cuotaActual, g.ncuotas);
    return { g, sy, sm, cuotaActual, restantes };
  }).sort((a, b) => a.restantes - b.restantes);

  el.innerHTML = activasConInfo.map(({ g, sy, sm, cuotaActual, restantes }) => {
    const pagadas = Math.min(cuotaActual, g.ncuotas);
    const pct = (pagadas / g.ncuotas * 100).toFixed(0);
    const totalRestante = restantes * g.montoXcuota;

    let borderColor, badgeHtml, barColor;
    if (restantes === 0) {
      borderColor = 'var(--accent)';
      badgeHtml = `<span style="font-size:0.6rem;font-weight:700;background:rgba(24,212,123,0.15);color:var(--accent);border-radius:99px;padding:2px 8px;white-space:nowrap">✓ Última cuota</span>`;
      barColor = 'var(--accent)';
    } else if (restantes === 1) {
      borderColor = 'var(--accent3)';
      badgeHtml = `<span style="font-size:0.6rem;font-weight:700;background:rgba(245,184,46,0.15);color:var(--accent3);border-radius:99px;padding:2px 8px;white-space:nowrap">⚡ Penúltima</span>`;
      barColor = 'var(--accent3)';
    } else if (restantes <= 3) {
      borderColor = 'var(--accent4)';
      badgeHtml = `<span style="font-size:0.6rem;font-weight:700;background:rgba(59,130,246,0.15);color:var(--accent4);border-radius:99px;padding:2px 8px;white-space:nowrap">${restantes} restantes</span>`;
      barColor = 'var(--accent4)';
    } else {
      borderColor = 'var(--border)';
      badgeHtml = '';
      barColor = 'linear-gradient(90deg,var(--accent4),var(--accent))';
    }

    return `<div style="background:var(--surface2);border:1px solid var(--border);border-left:3px solid ${borderColor};border-radius:12px;padding:14px 16px;margin-bottom:8px;transition:border-color 0.2s">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px">
            <span style="font-size:0.85rem;font-weight:700;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(g.desc || g.cat)}</span>
            ${badgeHtml}
          </div>
          <div style="font-size:0.7rem;color:var(--text3)">${escHtml(g.medio || '')}${g.medio ? ' · ' : ''}${g.fecha}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent2);font-size:0.9rem">$${fmt(g.montoXcuota)}<span style="font-size:0.7rem;color:var(--text3);font-weight:400">/mes</span></div>
          <div style="font-size:0.68rem;color:var(--text3)">cuota ${Math.min(cuotaActual,g.ncuotas)} de ${g.ncuotas}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div style="flex:1;height:5px;background:rgba(255,255,255,0.08);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${barColor};border-radius:99px;transition:width 0.4s"></div>
        </div>
        <span style="font-size:0.68rem;color:var(--text3);flex-shrink:0">$${fmt(totalRestante)} restante</span>
      </div>
    </div>`;
  }).join('');
}

// ---- CARD PANELS ----

function toggleCardPanel(panelId) {
  const panel = document.getElementById(panelId);
  const icon  = document.getElementById('icon-' + panelId);
  const isOpen = panel.classList.contains('panel-open');
  ['panel-gasto','panel-ingreso','panel-ahorro','panel-saldo','panel-saldo-usd'].forEach(id => {
    const p = document.getElementById(id);
    if (p) p.classList.remove('panel-open');
    const ic = document.getElementById('icon-' + id);
    if (ic) ic.classList.remove('open');
  });
  if (!isOpen) {
    panel.classList.add('panel-open');
    if (icon) icon.classList.add('open');
    renderCardPanel(panelId.replace('panel-',''));
  }
}

function renderCardPanel(type) {
  if (type === 'gasto') _renderGastoPanel();
  else if (type === 'ingreso') _renderIngresoPanel();
  else if (type === 'ahorro') _renderAhorroPanel();
  else if (type === 'saldo') _renderSaldoPanel(selectedDashMonth);
  else if (type === 'saldo-usd') _renderSaldoUSDPanel(selectedDashMonth);
}

function _renderGastoPanel() {
  const el = $('panel-gasto-body');
  if (!el) return;
  const ym = selectedDashMonth;
  const allItems = gastosDelMes(ym);
  const items = allItems.filter(x => (x.moneda||'ARS')==='ARS');
  const itemsUSD = allItems.filter(x => x.moneda==='USD');
  const totalUSD = itemsUSD.reduce((s,x)=>s+x.monto,0);
  if (!items.length) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text3);font-size:0.82rem">Sin gastos en este período</div>' +
      (totalUSD ? `<div style="text-align:center;padding-top:8px;font-family:'DM Mono',monospace;color:var(--accent3);font-size:0.85rem">u$s ${fmt(totalUSD)} en gastos USD</div>` : '');
    return;
  }
  const catMap = {};
  items.forEach(x => { catMap[x.cat] = (catMap[x.cat] || 0) + x.monto; });
  const sorted = Object.entries(catMap).sort((a,b) => b[1]-a[1]);
  const total = items.reduce((s,x)=>s+x.monto,0);
  el.innerHTML = `<div style="margin-bottom:14px;padding:0 4px">
    <div style="font-size:0.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Por categoría</div>
    ${sorted.map(([cat,val]) => {
      const pct = (val/total*100).toFixed(0);
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:3px">
          <span style="color:var(--text2)">${cat}</span>
          <span style="font-family:monospace;color:var(--accent2)">$${fmt(val)} <span style="color:var(--text3)">(${pct}%)</span></span>
        </div>
        <div style="height:4px;background:rgba(255,255,255,0.08);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent2);border-radius:4px"></div>
        </div>
      </div>`;
    }).join('')}
  </div>
  <div style="padding-top:10px;border-top:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:0.8rem;color:var(--text3)">${items.length} gastos</span>
    <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:1rem;color:var(--accent2)">$${fmt(total)}${totalUSD ? ` <span style="color:var(--accent3);font-size:0.75rem">(+u$s ${fmt(totalUSD)})</span>` : ''}</span>
  </div>`;
}

function _renderIngresoPanel() {
  const el = $('panel-ingreso-body');
  if (!el) return;
  const ym = selectedDashMonth;
  const ingM = ingresos.filter(i => (i.ymBase || i.key?.slice(0,7)) === ym);
  if (!ingM.length) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text3);font-size:0.82rem">Sin ingresos en este período</div>';
    return;
  }
  const totalARS = ingM.reduce((s,i) => s+(i.totalARS??i.total??0), 0);
  el.innerHTML = ingM.map(i => {
    const rows = [];
    if (i.sueldo > 0) rows.push({ label: i.sueldoConcepto || 'Sueldo', monto: i.sueldo, moneda: i.sueldoMoneda||'ARS', dest: i.sueldoDestino||'' });
    (i.otros||[]).forEach(o => rows.push({ label: o.concepto||o.nombre||'Ingreso extra', monto: o.monto, moneda: o.moneda||'ARS', dest: o.destino||'' }));
    return rows.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:0.82rem;color:var(--text2);font-weight:600">${r.label}</div>
        ${r.dest ? `<div style="font-size:0.68rem;color:var(--text3)">→ ${r.dest}</div>` : ''}
      </div>
      <span style="font-family:monospace;font-weight:700;color:var(--accent);font-size:0.88rem">${r.moneda==='USD'?'u$s':'$'}${fmt(r.monto)}</span>
    </div>`).join('');
  }).join('') +
  `<div style="padding-top:10px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:0.8rem;color:var(--text3)">Total ARS</span>
    <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:1rem;color:var(--accent)">$${fmt(totalARS)}</span>
  </div>`;
}

function _renderAhorroPanel() {
  const el = $('panel-ahorro-body');
  if (!el) return;
  const ahoAll = [...ahorros].sort((a,b) => b.key?.localeCompare(a.key||'')||0);
  if (!ahoAll.length) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text3);font-size:0.82rem">Sin ahorros registrados</div>';
    return;
  }
  const totalARS = ahoAll.filter(a=>(a.moneda||'ARS')==='ARS').reduce((s,a)=>s+a.monto,0);
  const totalUSD = ahoAll.filter(a=>a.moneda==='USD').reduce((s,a)=>s+a.monto,0);
  el.innerHTML = ahoAll.slice(0,8).map(a => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:0.82rem;color:var(--text2);font-weight:600">${a.concepto||a.tipo||'Ahorro'}</div>
        <div style="font-size:0.68rem;color:var(--text3)">${a.ymBase||a.key?.slice(0,7)} · ${a.origen||'—'}</div>
      </div>
      <div style="text-align:right">
        <div style="font-family:monospace;font-weight:700;color:var(--accent4);font-size:0.88rem">${(a.moneda||'ARS')==='USD'?'u$s':'$'}${fmt(a.monto)}</div>
        ${a.rendimientos ? `<div style="font-size:0.65rem;color:var(--accent)">+$${fmt(a.rendimientos)} rend.</div>` : ''}
      </div>
    </div>`).join('') +
  (ahoAll.length > 8 ? `<div style="text-align:center;font-size:0.72rem;color:var(--text3);padding:8px 0">+${ahoAll.length-8} más · ver en tab Ahorro</div>` : '') +
  `<div style="padding-top:10px;display:flex;justify-content:space-between;align-items:center">
    <span style="font-size:0.8rem;color:var(--text3)">Total acumulado</span>
    <div style="text-align:right">
      <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:1rem;color:var(--accent4)">$${fmt(totalARS)}</div>
      ${totalUSD ? `<div style="font-family:monospace;font-size:0.8rem;color:var(--accent3)">u$s ${fmt(totalUSD)}</div>` : ''}
    </div>
  </div>`;
}

function _renderSaldoPanel(ym) {
  const fmt2 = v => (v < 0 ? '−' : '+') + ' $' + Math.abs(v).toLocaleString('es-AR');
  const el = $('panel-saldo-body');
  if (!el) return;

  const totalIngresosMes = ingresos.filter(i => (i.ymBase || i.key.slice(0,7)) === ym).reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalGastosMes   = gastosDelMes(ym).reduce((s, x) => s + x.monto, 0);
  const totalAhorroMes   = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === ym && (a.moneda||'ARS')==='ARS').reduce((s, a) => s + a.monto, 0);
  const ajustesMes       = (ajustesCuentas || []).filter(a => a.fecha.slice(0,7) === ym).reduce((s, a) => s + (a.monto || 0), 0);
  const balanceReal      = totalIngresosMes - totalGastosMes - totalAhorroMes + ajustesMes;

  const filas = [
    { label: '💵 Ingresos del mes', val: totalIngresosMes, color: 'var(--accent)' },
    { label: '💸 Gastos del mes',   val: -totalGastosMes,  color: 'var(--accent2)' },
    { label: '🏦 Ahorro del mes',   val: -totalAhorroMes,  color: 'var(--accent4)' },
    ...(ajustesMes !== 0 ? [{ label: '🔧 Ajustes del mes', val: ajustesMes, color: 'var(--accent3)' }] : []),
  ];

  const maxAbs = Math.max(...filas.map(f => Math.abs(f.val)), 1);

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
      ${filas.map(f => `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px">
          <span style="color:var(--text2)">${f.label}</span>
          <span style="font-family:monospace;color:${f.color};font-weight:700">${fmt2(f.val)}</span>
        </div>
        <div style="height:5px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${(Math.abs(f.val)/maxAbs*100).toFixed(1)}%;background:${f.color};border-radius:4px;opacity:0.75"></div>
        </div>
      </div>`).join('')}
    </div>
    <div style="border-top:1px solid var(--border);padding-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:0.85rem;color:var(--text3)">Disponible del mes</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:1.05rem;color:${balanceReal>=0?'var(--accent)':'var(--accent2)'}">
          ${balanceReal>=0?'+':''} $${fmt(Math.abs(balanceReal))}
        </span>
      </div>
      ${balanceReal < 0 ? `<div style="margin-top:6px;font-size:0.72rem;color:var(--accent2);text-align:right">Déficit del mes</div>` : ''}
    </div>`;
}

function _renderSaldoUSDPanel(ym) {
  const fmt2 = v => (v < 0 ? '−' : '+') + ' u$s ' + fmt(Math.abs(v));
  const el = $('panel-saldo-usd-body');
  const card = $('card-saldo-usd');
  if (!el || !card) return;

  const ingresosMes = ingresos.filter(i => (i.ymBase || i.key.slice(0,7)) === ym);
  const totalIngresosUSD = ingresosMes.reduce((s, i) => {
    let usd = 0;
    if (i.sueldoMoneda === 'USD') usd += i.sueldo || 0;
    (i.otros || []).forEach(o => { if (o.moneda === 'USD') usd += o.monto || 0; });
    return s + usd;
  }, 0);
  const totalAhorroUSD = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === ym && a.moneda === 'USD').reduce((s, a) => s + a.monto, 0);
  const totalGastoUSD = gastosDelMes(ym).filter(x => x.moneda === 'USD').reduce((s, x) => s + x.monto, 0);
  const balanceUSD = totalIngresosUSD - totalAhorroUSD - totalGastoUSD;

  if (!totalIngresosUSD && !totalAhorroUSD && !totalGastoUSD) {
    card.style.display = 'none';
    return;
  }
  card.style.display = '';
  animateValue('d-saldo-usd', balanceUSD, 'u$s ');
  $('d-saldo-usd').style.color = balanceUSD >= 0 ? 'var(--accent3)' : 'var(--accent2)';

  const filas = [
    { label: '💵 Ingresos del mes', val: totalIngresosUSD, color: 'var(--accent3)' },
    ...(totalGastoUSD ? [{ label: '💸 Gastos del mes', val: -totalGastoUSD, color: 'var(--accent2)' }] : []),
    ...(totalAhorroUSD ? [{ label: '🏦 Ahorro del mes', val: -totalAhorroUSD, color: 'var(--accent4)' }] : []),
  ];
  const maxAbs = Math.max(...filas.map(f => Math.abs(f.val)), 1);

  el.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px">
      ${filas.map(f => `
      <div>
        <div style="display:flex;justify-content:space-between;font-size:0.8rem;margin-bottom:4px">
          <span style="color:var(--text2)">${f.label}</span>
          <span style="font-family:monospace;color:${f.color};font-weight:700">${fmt2(f.val)}</span>
        </div>
        <div style="height:5px;background:rgba(255,255,255,0.06);border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${(Math.abs(f.val)/maxAbs*100).toFixed(1)}%;background:${f.color};border-radius:4px;opacity:0.75"></div>
        </div>
      </div>`).join('')}
    </div>
    <div style="border-top:1px solid var(--border);padding-top:12px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:0.85rem;color:var(--text3)">Disponible USD del mes</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:1.05rem;color:${balanceUSD>=0?'var(--accent3)':'var(--accent2)'}">
          ${fmt2(balanceUSD)}
        </span>
      </div>
    </div>`;
}

// ---- ADMIN ----

async function addEmailHabilitado() {
  const inp = $('admin-email-input');
  const email = inp.value.trim().toLowerCase();
  if (!email || !email.includes('@')) { notify('Email inválido'); return; }
  try {
    const ref = window._fbDoc(window._fbDb, 'config', 'habilitados');
    const snap = await window._fbGetDoc(ref);
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    if (lista.includes(email)) { notify('Email ya existe'); return; }
    lista.push(email);
    await window._fbSetDoc(ref, { emails: lista });
    inp.value = '';
    notify('✓ Email habilitado');
    renderAdminPanel();
  } catch(e) { notify('Error: ' + e.message); }
}

async function removeEmailHabilitado(email) {
  try {
    const ref = window._fbDoc(window._fbDb, 'config', 'habilitados');
    const snap = await window._fbGetDoc(ref);
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    await window._fbSetDoc(ref, { emails: lista.filter(e => e !== email) });
    notify('Email eliminado');
    renderAdminPanel();
  } catch(e) { notify('Error: ' + e.message); }
}

async function renderAdminPanel() {
  const el = $('admin-email-list');
  if (!el) return;
  el.innerHTML = '<div class="panel-empty">Cargando...</div>';
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'config', 'habilitados'));
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    const countEl = $('admin-count');
    if (countEl) countEl.textContent = lista.length;
    if (!lista.length) {
      el.innerHTML = '<div class="panel-empty">Sin emails habilitados</div>';
      return;
    }
    el.innerHTML = lista.map(email => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border)">
        <span style="font-size:0.85rem;color:var(--text2)">${email}</span>
        <button onclick="removeEmailHabilitado('${email}')"
          style="background:none;border:1px solid rgba(255,79,94,0.4);color:var(--accent2);border-radius:8px;padding:4px 10px;font-size:0.72rem;cursor:pointer">✕</button>
      </div>`).join('');
  } catch(e) {
    el.innerHTML = `<div class="panel-empty">Error: ${e.message}</div>`;
    notify('Error al cargar admin');
  }
}

async function diagUsuario() {
  const el = $('diag-result');
  if (!el) return;
  el.innerHTML = '⏳ Cargando...';
  const uid = window._currentUser?.uid;
  if (!uid) { el.innerHTML = 'Sin sesión activa'; return; }
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    const d = snap.exists() ? snap.data() : null;
    if (!d) { el.innerHTML = 'Sin datos en Firestore'; return; }
    el.innerHTML = `
      <div style="font-size:0.8rem;line-height:1.7;color:var(--text2)">
        <div>📧 <b>Email:</b> ${window._currentUser.email}</div>
        <div>🆔 <b>UID:</b> ${uid}</div>
        <div>💸 <b>Gastos:</b> ${(d.gastos||[]).length}</div>
        <div>💵 <b>Ingresos:</b> ${(d.ingresos||[]).length}</div>
        <div>🏦 <b>Ahorros:</b> ${(d.ahorros||[]).length}</div>
        <div>🃏 <b>Tarjetas:</b> ${(d.tarjetas||[]).length}</div>
        <div>📋 <b>Pendientes:</b> ${(d.pendientes||[]).length}</div>
        <div>🔧 <b>Ajustes:</b> ${(d.ajustesCuentas||[]).length}</div>
        <div>🕐 <b>Última actualización:</b> ${d.updatedAt ? new Date(d.updatedAt).toLocaleString('es-AR') : 'N/D'}</div>
      </div>`;
  } catch(e) { el.innerHTML = 'Error: ' + e.message; }
}

async function recuperarPendientes() {
  const el = $('diag-result');
  if (!el) return;
  el.innerHTML = '⏳ Recuperando...';
  const uid = window._currentUser?.uid;
  if (!uid) { el.innerHTML = 'Sin sesión'; return; }
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    const d = snap.exists() ? snap.data() : null;
    if (d && Array.isArray(d.pendientes) && d.pendientes.length > 0) {
      pendientes = d.pendientes;
      el.innerHTML = `✓ Recuperados ${pendientes.length} pendientes`;
      notify(`✓ ${pendientes.length} pendientes recuperados`);
    } else {
      el.innerHTML = 'No hay pendientes guardados en Firestore';
    }
  } catch(e) { el.innerHTML = 'Error: ' + e.message; }
}

async function verFirestoreRaw() {
  const el = $('diag-raw');
  if (!el) return;
  el.innerHTML = '⏳ Cargando raw...';
  const uid = window._currentUser?.uid;
  if (!uid) { el.innerHTML = 'Sin sesión'; return; }
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    const d = snap.exists() ? snap.data() : {};
    const summary = {
      gastos: (d.gastos||[]).length,
      ingresos: (d.ingresos||[]).length,
      ahorros: (d.ahorros||[]).length,
      tarjetas: (d.tarjetas||[]).length,
      pendientes: (d.pendientes||[]).length,
      ajustesCuentas: (d.ajustesCuentas||[]).length,
      saldosIniciales: Object.keys(d.saldosIniciales||{}).length + ' cuentas',
      updatedAt: d.updatedAt || 'N/D'
    };
    el.innerHTML = `<pre style="font-size:0.72rem;color:var(--text2);overflow:auto;max-height:280px;white-space:pre-wrap">${JSON.stringify(summary, null, 2)}</pre>`;
  } catch(e) { el.innerHTML = 'Error: ' + e.message; }
}

async function limpiarAjustesViejos() {
  if (!ajustesCuentas || ajustesCuentas.length === 0) { notify('No hay ajustes para limpiar'); return; }
  const hace6meses = new Date();
  hace6meses.setMonth(hace6meses.getMonth() - 6);
  const corte = hace6meses.toISOString().slice(0,10);
  const antes = ajustesCuentas.length;
  ajustesCuentas = ajustesCuentas.filter(a => a.fecha >= corte);
  const eliminados = antes - ajustesCuentas.length;
  save();
  notify(`✓ ${eliminados} ajustes eliminados`);
  renderSaldoCuentas();
}


function renderAjustesHistorial() {
  const el = $('ajustes-historial-body');
  if (!el) return;
  const lista = [...(ajustesCuentas || [])].sort((a, b) => b.fecha.localeCompare(a.fecha));
  if (!lista.length) {
    el.innerHTML = '<div class="panel-empty" style="padding:1.2rem">Sin ajustes registrados</div>';
    return;
  }
  const cuentasDisp = ['Efectivo',
    ...tarjetas.filter(t => t.tipo === 'billetera').map(t => t.label || t.banco || t.nombre),
    ...tarjetas.filter(t => t.tipo === 'debito').map(t => {
      let l = t.label || ('CA ' + t.banco);
      return l.startsWith('Débito ') ? 'CA ' + l.slice(7) : l;
    })
  ];
  el.innerHTML = lista.map(a => {
    const pos = a.monto >= 0;
    const isEditing = a._editando;
    const cuentaOpts = cuentasDisp.map(c => `<option value="${c}" ${c === a.cuenta ? 'selected' : ''}>${c}</option>`).join('');
    return `<div id="ajrow-${a.id}" style="padding:12px 16px;border-bottom:1px solid var(--border)">
      ${isEditing ? `
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
        <div style="flex:1;min-width:120px">
          <div style="font-size:0.68rem;color:var(--text3);margin-bottom:3px">Fecha</div>
          <input id="aj-fecha-${a.id}" type="date" value="${a.fecha}"
            style="background:var(--bg);border:1px solid var(--accent3);border-radius:8px;color:var(--text);font-size:16px;padding:12px 14px;width:100%;box-sizing:border-box;min-height:46px">
        </div>
        <div style="flex:1;min-width:120px">
          <div style="font-size:0.68rem;color:var(--text3);margin-bottom:3px">Cuenta</div>
          <select id="aj-cuenta-${a.id}"
            style="background:var(--bg);border:1px solid var(--accent3);border-radius:8px;color:var(--text);font-size:16px;padding:12px 14px;width:100%;box-sizing:border-box;min-height:46px">
            ${cuentaOpts}
          </select>
        </div>
        <div style="flex:1;min-width:120px">
          <div style="font-size:0.68rem;color:var(--text3);margin-bottom:3px">Saldo real</div>
          <input id="aj-saldo-${a.id}" type="number" value="${a.saldoDespues}" step="0.01"
            style="background:var(--bg);border:1px solid var(--accent3);border-radius:8px;color:var(--text);font-family:'DM Mono',monospace;font-size:16px;padding:12px 14px;width:100%;box-sizing:border-box;min-height:46px">
        </div>
        <div style="display:flex;gap:6px;align-self:flex-end;padding-bottom:1px">
          <button onclick="guardarEdicionAjuste(${a.id})"
            style="background:var(--accent3);border:none;color:#0d0f14;border-radius:8px;padding:12px 20px;font-size:0.88rem;cursor:pointer;font-weight:700;min-height:44px;touch-action:manipulation">✓</button>
          <button onclick="cancelarEdicionAjuste(${a.id})"
            style="background:rgba(255,255,255,0.07);border:1px solid var(--border);color:var(--text3);border-radius:8px;padding:12px 18px;font-size:0.88rem;cursor:pointer;min-height:44px;touch-action:manipulation">✕</button>
        </div>
      </div>
      ` : `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="min-width:0;flex:1">
          <div style="font-size:0.82rem;color:var(--text2);font-weight:600">${a.cuenta}</div>
          <div style="font-size:0.7rem;color:var(--text3);margin-top:2px">${a.fecha} · $${(a.saldoAntes||0).toLocaleString('es-AR')} → $${(a.saldoDespues||0).toLocaleString('es-AR')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:0.9rem;color:${pos ? 'var(--accent)' : 'var(--accent2)'}">
            ${pos ? '+' : '−'}$${Math.abs(a.monto).toLocaleString('es-AR')}
          </span>
          <button onclick="iniciarEdicionAjuste(${a.id})"
            style="background:rgba(245,184,46,0.1);border:1px solid rgba(245,184,46,0.35);color:var(--accent3);border-radius:8px;padding:11px 16px;font-size:0.85rem;cursor:pointer;min-height:44px;touch-action:manipulation">✏</button>
          <button onclick="eliminarAjuste(${a.id})"
            style="background:rgba(255,79,94,0.08);border:1px solid rgba(255,79,94,0.35);color:var(--accent2);border-radius:8px;padding:11px 16px;font-size:0.85rem;cursor:pointer;min-height:44px;touch-action:manipulation">✕</button>
        </div>
      </div>
      `}
    </div>`;
  }).join('');
}

function iniciarEdicionAjuste(id) {
  const aj = ajustesCuentas.find(a => a.id === id);
  if (!aj) return;
  aj._editando = true;
  renderAjustesHistorial();
}

function cancelarEdicionAjuste(id) {
  const aj = ajustesCuentas.find(a => a.id === id);
  if (!aj) return;
  delete aj._editando;
  renderAjustesHistorial();
}

function guardarEdicionAjuste(id) {
  const aj = ajustesCuentas.find(a => a.id === id);
  if (!aj) return;
  const nuevaFecha  = document.getElementById('aj-fecha-' + id)?.value;
  const nuevaCuenta = document.getElementById('aj-cuenta-' + id)?.value;
  const nuevoSaldo  = parseFloat(document.getElementById('aj-saldo-' + id)?.value);
  if (!nuevaFecha || !nuevaCuenta || isNaN(nuevoSaldo)) { notify('⚠ Completá todos los campos'); return; }
  aj.fecha        = nuevaFecha;
  aj.cuenta       = nuevaCuenta;
  aj.saldoDespues = nuevoSaldo;
  aj.monto        = +(nuevoSaldo - (aj.saldoAntes || 0)).toFixed(2);
  delete aj._editando;
  save();
  renderSaldoCuentas();
  renderAjustesHistorial();
  notify('✓ Ajuste actualizado');
}


async function borrarDatosUsuario() {
  const emailInput = $('admin-borrar-email');
  const resultEl   = $('admin-borrar-result');
  const email = (emailInput?.value || '').trim().toLowerCase();
  if (!email || !email.includes('@')) { notify('⚠ Ingresá un email válido'); return; }

  resultEl.innerHTML = '⏳ Buscando usuario...';
  try {
    let uid = null;

    // 1. Si es el propio usuario logueado, usamos su UID directamente
    if (window._currentUser && window._currentUser.email.toLowerCase() === email) {
      uid = window._currentUser.uid;
    }

    // 2. Buscar en el índice email→UID guardado al hacer login
    if (!uid) {
      const idxSnap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'config', 'email_uid_index'));
      if (idxSnap.exists()) {
        uid = idxSnap.data()[email] || null;
      }
    }

    // 3. Fallback: buscar en la colección usuarios por campo email
    if (!uid) {
      const snap = await window._fbGetDocs(
        window._fbQuery(
          window._fbCollection(window._fbDb, 'usuarios'),
          window._fbWhere('email', '==', email)
        )
      );
      if (!snap.empty) uid = snap.docs[0].id;
    }

    if (!uid) {
      resultEl.innerHTML = `<span style="color:var(--accent2)">✕ No se encontró ningún usuario con ese email.<br><small>El usuario debe iniciar sesión al menos una vez para quedar registrado.</small></span>`;
      return;
    }

    const docRef = window._fbDoc(window._fbDb, 'usuarios', uid);
    await window._fbSetDoc(docRef, {
      gastos: [], ingresos: [], ahorros: [], pendientes: [],
      tarjetas: [], saldosIniciales: {}, conceptosGuardados: [],
      ajustesCuentas: [], email,
      updatedAt: new Date().toISOString(),
      _resetAt: new Date().toISOString()
    });

    // Si borramos los datos del usuario actual, resetear estado local
    if (window._currentUser && window._currentUser.uid === uid) {
      gastos = []; ingresos = []; ahorros = []; pendientes = [];
      tarjetas = []; saldosIniciales = {}; conceptosGuardados = []; ajustesCuentas = [];
      renderDashboard();
      renderSaldoCuentas();
    }

    resultEl.innerHTML = `<span style="color:var(--accent)">✓ Datos de <b>${email}</b> borrados correctamente</span>`;
    emailInput.value = '';
    notify(`✓ Datos de ${email} eliminados`);
  } catch(e) {
    resultEl.innerHTML = `<span style="color:var(--accent2)">Error: ${e.message}</span>`;
    notify('Error: ' + e.message);
  }
}

// ---- CONFETTI ----
const _celebratedMetas = new Set();

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.display = 'block';
  haptic([40, 60, 80]);

  const COLORS = ['#18d47b','#38bdf8','#fbbf24','#f472b6','#a78bfa','#fb923c','#ffffff'];
  const pieces = Array.from({ length: 120 }, () => ({
    x: Math.random() * canvas.width,
    y: -10 - Math.random() * 200,
    w: 6 + Math.random() * 8,
    h: 8 + Math.random() * 6,
    r: Math.random() * Math.PI * 2,
    dr: (Math.random() - 0.5) * 0.2,
    dx: (Math.random() - 0.5) * 2.5,
    dy: 2.5 + Math.random() * 3.5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    alpha: 1
  }));

  let frame;
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    pieces.forEach(p => {
      p.x  += p.dx;
      p.y  += p.dy;
      p.r  += p.dr;
      p.dy += 0.07; // gravedad
      if (p.y > canvas.height * 0.7) p.alpha -= 0.025;
      if (p.alpha <= 0) return;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (alive) {
      frame = requestAnimationFrame(draw);
    } else {
      canvas.style.display = 'none';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  if (frame) cancelAnimationFrame(frame);
  draw();
}

// ---- SWIPE BETWEEN TABS ----
(function initSwipeTabs() {
  const TAB_ORDER = ['dashboard', 'gastos', 'ingresos', 'ahorro', 'pendientes', 'ajustes'];
  let tx = 0, ty = 0, swiping = false;
  const MIN_X = 55;   // px mínimo horizontal
  const MAX_Y = 40;   // px máximo vertical (para no interferir con scroll)

  function currentTab() {
    const active = document.querySelector('section.active');
    return active ? active.id.replace('tab-', '') : 'dashboard';
  }

  document.addEventListener('touchstart', e => {
    // No iniciar swipe si el touch empieza en un contenedor con scroll horizontal
    const el = e.target.closest('.cat-chips-row, .mes-nav, [style*="overflow-x"]');
    if (el) { swiping = false; return; }
    tx = e.touches[0].clientX;
    ty = e.touches[0].clientY;
    swiping = true;
  }, { passive: true });

  document.addEventListener('touchend', e => {
    if (!swiping) return;
    swiping = false;
    const dx = e.changedTouches[0].clientX - tx;
    const dy = Math.abs(e.changedTouches[0].clientY - ty);
    if (Math.abs(dx) < MIN_X || dy > MAX_Y) return;
    const cur = TAB_ORDER.indexOf(currentTab());
    if (cur === -1) return;
    const next = dx < 0
      ? TAB_ORDER[Math.min(cur + 1, TAB_ORDER.length - 1)]
      : TAB_ORDER[Math.max(cur - 1, 0)];
    if (next !== currentTab()) {
      haptic(30);
      showTab(next);
    }
  }, { passive: true });
})();

// ---- PULL TO REFRESH ----
(function initPullToRefresh() {
  let startY = 0, pulling = false, triggered = false;
  const THRESHOLD = 72;
  const bar = document.getElementById('ptr-bar');
  if (!bar) return;

  document.addEventListener('touchstart', e => {
    if (window.scrollY === 0) {
      startY = e.touches[0].clientY;
      pulling = true;
      triggered = false;
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 10 && window.scrollY === 0) {
      bar.classList.add('ptr-visible');
    } else if (dy <= 10) {
      bar.classList.remove('ptr-visible');
    }
    if (dy >= THRESHOLD && !triggered) triggered = true;
  }, { passive: true });

  document.addEventListener('touchend', async () => {
    if (!pulling) return;
    pulling = false;
    if (triggered && window._currentUser) {
      bar.classList.remove('ptr-visible');
      bar.classList.add('ptr-loading');
      haptic(40);
      try {
        await window.loadUserData(window._currentUser.uid);
      } finally {
        bar.classList.remove('ptr-loading');
      }
    } else {
      bar.classList.remove('ptr-visible');
    }
    triggered = false;
  });
})();

// ---- WINDOW EXPORTS ----
window.renderDashboard    = renderDashboard;
window.toggleDashCuotas = toggleDashCuotas;
window.toggleCardPanel    = toggleCardPanel;

// ---- WINDOW EXPORTS ----
window.renderSaldoCuentas     = renderSaldoCuentas;
window.renderAhorroTable      = renderAhorroTable;
window.renderFondos           = renderFondos;
window.renderDashCuotas       = renderDashCuotas;
window.renderAjustesHistorial = renderAjustesHistorial;
window.renderPendientesTab    = renderPendientesTab;
window.renderOrigenAhorro     = renderOrigenAhorro;
window.renderAdminPanel       = renderAdminPanel;

window.addAhorro              = addAhorro;
window.deleteAhorro           = deleteAhorro;
window.toggleMetaForm         = toggleMetaForm;
window.guardarMeta            = guardarMeta;
window.deleteMeta             = deleteMeta;
window.agregarRendimiento     = agregarRendimiento;
window.agregarRendimientoFondo = agregarRendimientoFondo;
window.rescatarFondo          = rescatarFondo;
window.cerrarRescate          = cerrarRescate;
window.confirmarRescate       = confirmarRescate;
window.addPendiente           = addPendiente;
window.togglePendiente        = togglePendiente;
window.deletePendiente        = deletePendiente;
window.limpiarCompletados     = limpiarCompletados;
window.setPendienteFiltro     = setPendienteFiltro;

window.showTab                = showTab;
window.toggleDetalleCuenta    = toggleDetalleCuenta;
window.toggleCuentaPanel      = toggleCuentaPanel;
window.toggleCardPanel        = toggleCardPanel;
window.renderCardPanel        = renderCardPanel;
window.toggleDashCuotas       = toggleDashCuotas;
window.renderDashboard        = renderDashboard;
window.selectDashMonth        = selectDashMonth;

window.aplicarAjusteCuenta    = aplicarAjusteCuenta;
window.eliminarAjuste         = eliminarAjuste;
window.moverEntreCuentas      = moverEntreCuentas;
window.actualizarCotizacion   = actualizarCotizacion;
window.comprarUSD             = comprarUSD;
window.borrarTodosLosAjustes  = borrarTodosLosAjustes;
window.iniciarEdicionAjuste   = iniciarEdicionAjuste;
window.cancelarEdicionAjuste  = cancelarEdicionAjuste;
window.guardarEdicionAjuste   = guardarEdicionAjuste;

window.exportData             = exportData;
window.importData             = importData;
window.cancelImport           = cancelImport;
window.confirmImport          = confirmImport;

window.onCatSelect            = onCatSelect;
window.saveNewCat             = saveNewCat;
window.openCatModal           = openCatModal;
window.closeCatModal          = closeCatModal;
window.addCatFromModal        = addCatFromModal;
window.deleteCat              = deleteCat;
window.editCat                = editCat;
window.guardarEditCat         = guardarEditCat;
window.toggleOtro             = toggleOtro;
window.onMedioChange          = onMedioChange;
window.toggleCuotasIfNeeded   = toggleCuotasIfNeeded;

window.addGasto               = addGasto;
window.deleteGasto            = deleteGasto;
window.clearGastoSearch       = clearGastoSearch;
window.filterGastosCat        = filterGastosCat;
window.navMes                 = navMes;
window.abrirNuevoRecurrente   = abrirNuevoRecurrente;
window.cerrarNuevoRecurrente  = cerrarNuevoRecurrente;
window.crearRecurrente        = crearRecurrente;
window.toggleRecurrenteCard   = toggleRecurrenteCard;
window.actualizarRecurrente   = actualizarRecurrente;
window.guardarCamposRecurrente = guardarCamposRecurrente;
window.toggleMesRecurrente    = toggleMesRecurrente;
window.eliminarRecurrente     = eliminarRecurrente;

window.addIngreso             = addIngreso;
window.editarOtroIngreso      = editarOtroIngreso;
window.eliminarOtroIngreso    = eliminarOtroIngreso;
window.editarSueldoIngreso    = editarSueldoIngreso;
window.eliminarSueldoIngreso  = eliminarSueldoIngreso;

window.deleteTarjeta          = deleteTarjeta;

window.addEmailHabilitado     = addEmailHabilitado;
window.removeEmailHabilitado  = removeEmailHabilitado;
window.borrarDatosUsuario     = borrarDatosUsuario;
window.verFirestoreRaw        = verFirestoreRaw;
window.limpiarAjustesViejos   = limpiarAjustesViejos;
window.recuperarPendientes    = recuperarPendientes;

window.seleccionarConcepto    = seleccionarConcepto;
window.toggleConceptoOtro     = toggleConceptoOtro;
window.filtrarConceptos       = filtrarConceptos;
window.seleccionarConceptoOtro = seleccionarConceptoOtro;
