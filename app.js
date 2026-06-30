// ---- HELPERS ----
const $ = id => document.getElementById(id);
const fmt = n => (n ?? 0).toLocaleString('es-AR');

let _newRowId = null;

const _SVG = `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
const EMPTY_ICONS = {
  gastos:   `<svg viewBox="0 0 24 24" ${_SVG}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 3H8L2 7h20l-6-4z"/><circle cx="12" cy="14" r="2"/></svg>`,
  ingresos: `<svg viewBox="0 0 24 24" ${_SVG}><path d="M12 2v20M17 7l-5-5-5 5"/><path d="M2 17h20"/></svg>`,
  ahorro:   `<svg viewBox="0 0 24 24" ${_SVG}><path d="M19 8a7 7 0 1 0-13.47 2.67A2 2 0 0 0 7 14v1h10v-1a2 2 0 0 0 1.47-3.33z"/><path d="M9 14v3m6-3v3M10 21h4"/></svg>`,
  cuotas:   `<svg viewBox="0 0 24 24" ${_SVG}><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>`,
  chart:    `<svg viewBox="0 0 24 24" ${_SVG}><path d="M3 3v18h18"/><path d="m7 16 4-4 4 4 4-6"/></svg>`,
  fondos:   `<svg viewBox="0 0 24 24" ${_SVG}><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 3"/></svg>`,
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
let _pendienteRegistrando = null;
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
let _mesFiltro     = new Date().toISOString().slice(0,7); // arranca en mes actual

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
  document.querySelectorAll('[id^="util-"]:not([id^="util-tab-"]):not(#util-menu):not(#util-detalle)').forEach(s => s.style.display = 'none');
  if (btn) btn.classList.add('active');
  const panel = document.getElementById('util-' + sub);
  if (panel) panel.style.display = '';
  document.getElementById('util-menu').style.display = 'none';
  document.getElementById('util-detalle').style.display = '';
  if (sub === 'compartir') ccRenderGrupos();
  if (sub === 'cotizaciones') cargarCotizaciones();
  if (sub === 'presupuesto') renderPresupuesto();
  if (sub === 'reportes') renderReportes();
  if (sub === 'recurrentes') renderRecurrentesLista();
  if (sub === 'calendario') renderCalendario();
}

function volverUtilidades() {
  document.querySelectorAll('[id^="util-"]:not([id^="util-tab-"]):not(#util-menu):not(#util-detalle)').forEach(s => s.style.display = 'none');
  document.querySelectorAll('[id^="util-tab-"]').forEach(b => b.classList.remove('active'));
  document.getElementById('util-detalle').style.display = 'none';
  document.getElementById('util-menu').style.display = '';
}
window.volverUtilidades = volverUtilidades;

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

// ---- CUENTA CLARA → ver cuenta-clara.js ----

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
  if (tab === 'gastos') { populateFilters(); renderGastosTable(); }
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
  if (!medio) {
    notify('⚠ Seleccioná un medio de pago');
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
  notify(recurrente ? '✓ Gasto recurrente guardado' : `✓ Gasto guardado: ${desc}`);

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
      const gid = r.mesesActivos?.[mes];
      const activo = !!gid;
      const label = MESES[parseInt(mes.slice(5,7))-1].slice(0,3);
      const esActual = mes === mesActual;
      return `<div class="rec-mes-item">
        <span class="rec-mes-label" style="${esActual?'color:var(--accent);font-weight:700':''}">${label}</span>
        <label class="toggle-switch" style="transform:scale(0.8)">
          <input type="checkbox" onchange="toggleMesRecurrente(${r.id},'${mes}',this.checked)"${activo?' checked':''}>
          <span class="toggle-track"></span>
        </label>
        ${activo
          ? `<button onclick="abrirRecMesModal(${r.id},'${mes}',${gid})" title="Editar este mes" style="background:none;border:none;color:var(--accent4);cursor:pointer;font-size:0.8rem;padding:0;line-height:1;height:16px">✏</button>`
          : `<span style="height:16px"></span>`}
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
        <div style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
          <div style="font-size:0.72rem;color:var(--text3);font-weight:600;text-transform:uppercase;letter-spacing:0.5px">Editar</div>
          <input id="rec-f-nombre-${r.id}" value="${escHtml(r.nombre)}" placeholder="Nombre"
            style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text1);font-size:0.85rem;width:100%;box-sizing:border-box">
          <select id="rec-f-cat-${r.id}"
            style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text1);font-size:0.85rem;width:100%">
            <option value="">Categoría...</option>
            ${cats.gastos.map(c => `<option value="${escHtml(c)}"${r.cat===c?' selected':''}>${escHtml(c)}</option>`).join('')}
          </select>
          <select id="rec-f-medio-${r.id}"
            style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text1);font-size:0.85rem;width:100%">
            <option value="">Medio de pago...</option>
            <option value="Efectivo"${r.medio==='Efectivo'?' selected':''}>💵 Efectivo</option>
            ${tarjetas.map(t => { const n = t.label||t.nombre||t.banco; return `<option value="${escHtml(n)}"${r.medio===n?' selected':''}>${escHtml(n)}</option>`; }).join('')}
          </select>
          <input id="rec-f-monto-${r.id}" type="number" value="${r.monto||''}" placeholder="Monto"
            style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text1);font-size:0.85rem;width:100%;box-sizing:border-box">
          <select id="rec-f-moneda-${r.id}"
            style="background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;color:var(--text1);font-size:0.85rem;width:100%">
            <option value="ARS"${(r.moneda||'ARS')==='ARS'?' selected':''}>ARS</option>
            <option value="USD"${r.moneda==='USD'?' selected':''}>USD</option>
          </select>
          <button onclick="guardarCamposRecurrente(${r.id})"
            style="background:var(--accent);color:#000;border:none;border-radius:8px;padding:9px;font-size:0.82rem;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif">
            ✓ Guardar cambios
          </button>
        </div>
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
  const nombreNuevo = document.getElementById(`rec-f-nombre-${id}`)?.value.trim();
  if (nombreNuevo) r.nombre = nombreNuevo;
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

function _reabrirRecCard(id) {
  const body = $(`rec-body-${id}`);
  if (body) body.style.display = '';
  const arrow = $(`rec-arrow-${id}`);
  if (arrow) arrow.style.transform = 'rotate(90deg)';
}

function toggleMesRecurrente(id, mes, activo) {
  const r = recurrentes.find(x => x.id === id);
  if (!r) return;
  if (!r.mesesActivos) r.mesesActivos = {};

  if (activo) {
    // Abrir el modal para configurar el gasto de este mes (categoría, medio, monto, moneda)
    abrirRecMesModal(id, mes, null);
  } else {
    const gastoId = r.mesesActivos[mes];
    if (gastoId) gastos = gastos.filter(g => g.id !== gastoId);
    delete r.mesesActivos[mes];
    save();
    renderRecurrentesLista();
    _reabrirRecCard(id);
    renderGastosTable();
    notify(`Gasto de ${MESES[parseInt(mes.slice(5,7))-1]} eliminado`);
  }
}

function abrirRecMesModal(recId, mes, gastoId) {
  const r = recurrentes.find(x => x.id === recId);
  if (!r) return;
  // Valores iniciales: si es re-edición, los del gasto existente; si es nuevo, los de la plantilla
  let monto, cat, medio, moneda;
  if (gastoId) {
    const g = gastos.find(x => x.id === gastoId);
    monto  = g?.monto  ?? r.monto  ?? '';
    cat    = g?.cat    ?? r.cat    ?? '';
    medio  = g?.medio  ?? r.medio  ?? '';
    moneda = g?.moneda ?? r.moneda ?? 'ARS';
  } else {
    monto  = r.monto  || '';
    cat    = r.cat    || '';
    medio  = r.medio  || '';
    moneda = r.moneda || 'ARS';
  }
  // Poblar categoría
  let catHtml = '<option value="">Seleccionar...</option>';
  (cats.gastos || []).forEach(c => { catHtml += `<option value="${escHtml(c)}"${cat === c ? ' selected' : ''}>${escHtml(c)}</option>`; });
  $('rec-mes-cat').innerHTML = catHtml;
  // Poblar medio de pago (Efectivo + tarjetas)
  let medioHtml = '<option value="">Seleccionar...</option>';
  medioHtml += `<option value="Efectivo"${medio === 'Efectivo' ? ' selected' : ''}>💵 Efectivo</option>`;
  tarjetas.forEach(t => { const l = t.label || t.banco || t.nombre; medioHtml += `<option value="${escHtml(l)}"${medio === l ? ' selected' : ''}>${escHtml(l)}</option>`; });
  $('rec-mes-medio').innerHTML = medioHtml;
  // Monto y moneda
  $('rec-mes-monto').value = monto;
  $('rec-mes-moneda').value = moneda;
  // Título y contexto
  const mesNombre = MESES[parseInt(mes.slice(5, 7)) - 1];
  $('rec-mes-modal-title').textContent = `${gastoId ? 'Editar' : 'Activar'} ${mesNombre} — ${r.nombre}`;
  $('rec-mes-recid').value  = recId;
  $('rec-mes-mes').value    = mes;
  $('rec-mes-gastoid').value = gastoId || '';
  const modal = $('rec-mes-modal');
  modal.dataset.nueva = gastoId ? '0' : '1';
  modal.style.display = 'flex';
  setTimeout(() => $('rec-mes-monto')?.focus(), 60);
}

function cerrarRecMesModal() {
  const modal = $('rec-mes-modal');
  const eraNueva = modal.dataset.nueva === '1';
  const recId = parseInt($('rec-mes-recid').value);
  modal.style.display = 'none';
  if (eraNueva) {
    // Se canceló una activación: re-render para volver a desmarcar el toggle
    renderRecurrentesLista();
    if (!isNaN(recId)) _reabrirRecCard(recId);
  }
}

function guardarRecMesModal() {
  const recId = parseInt($('rec-mes-recid').value);
  const mes = $('rec-mes-mes').value;
  const gidVal = $('rec-mes-gastoid').value;
  const gastoIdExist = gidVal ? parseInt(gidVal) : null;
  const r = recurrentes.find(x => x.id === recId);
  if (!r) return;
  const monto  = parseFloat(String($('rec-mes-monto').value).replace(',', '.'));
  const cat    = $('rec-mes-cat').value;
  const medio  = $('rec-mes-medio').value;
  const moneda = $('rec-mes-moneda').value || 'ARS';
  if (isNaN(monto) || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  if (!cat) { notify('⚠ Seleccioná una categoría'); return; }

  if (!r.mesesActivos) r.mesesActivos = {};
  if (gastoIdExist) {
    // Re-edición: actualizar el gasto existente de ese mes
    const g = gastos.find(x => x.id === gastoIdExist);
    if (g) { g.monto = monto; g.cat = cat; g.medio = medio; g.moneda = moneda; }
  } else {
    // Nueva activación: crear el gasto del mes
    const nuevoId = Date.now();
    gastos.push({
      id: nuevoId, fecha: `${mes}-01`, desc: r.nombre,
      cat, medio, monto, moneda, notas: r.notas || '',
      recurrenteId: recId
    });
    r.mesesActivos[mes] = nuevoId;
  }
  // El último cambio queda como base para los meses que se activen después
  r.monto = monto; r.cat = cat; r.medio = medio; r.moneda = moneda;

  const modal = $('rec-mes-modal');
  modal.dataset.nueva = '0';
  modal.style.display = 'none';

  save();
  renderRecurrentesLista();
  _reabrirRecCard(recId);
  renderGastosTable();
  const mesNombre = MESES[parseInt(mes.slice(5, 7)) - 1];
  notify(`✓ "${r.nombre}" $${fmt(monto)} en ${mesNombre}`);
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
  // Lista: [meses pasados... | mes actual | '' (Todos) | meses futuros...]
  const mesActual = new Date().toISOString().slice(0, 7);
  const meses = [...new Set(gastos.map(g => {
    const off = g.offsetCuotas || 0;
    if (!off) return g.fecha.slice(0,7);
    const [fy, fm] = g.fecha.split('-').map(Number);
    let cm = fm + off, cy = fy;
    while (cm > 12) { cm -= 12; cy++; }
    return `${cy}-${String(cm).padStart(2,'0')}`;
  }))].sort();
  if (!meses.length) return;
  const pasados  = meses.filter(m => m <= mesActual);
  const futuros  = meses.filter(m => m > mesActual);
  const lista = [...pasados, '', ...futuros]; // '' = Todos entre presente y futuro
  let idx = lista.indexOf(_mesFiltro);
  if (idx === -1) idx = lista.indexOf(mesActual); // fallback al mes actual
  const next = idx + dir;
  if (next < 0 || next >= lista.length) return;
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
  if (mesFiltro) rows = rows.filter(g => {
    if (g.cuota) {
      // Cuota: aparece en cada mes donde cae un pago
      const [fy, fm] = g.fecha.split('-').map(Number);
      const off = g.offsetCuotas || 0;
      for (let n = 0; n < g.ncuotas; n++) {
        let cy = fy, cm = fm + off + n;
        while (cm > 12) { cm -= 12; cy++; }
        if (`${cy}-${String(cm).padStart(2,'0')}` === mesFiltro) return true;
      }
      return false;
    }
    const off = g.offsetCuotas || 0;
    if (!off) return g.fecha.slice(0,7) === mesFiltro;
    // Gasto simple con offset (ej: visa pagar mes que viene)
    const [fy, fm] = g.fecha.split('-').map(Number);
    let cm = fm + off, cy = fy;
    while (cm > 12) { cm -= 12; cy++; }
    return `${cy}-${String(cm).padStart(2,'0')}` === mesFiltro;
  });
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
    (g.desc   || g.concepto || '').toLowerCase().includes(query) ||
    (g.cat    || '').toLowerCase().includes(query) ||
    (g.medio  || '').toLowerCase().includes(query) ||
    (g.notas  || '').toLowerCase().includes(query) ||
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
  let totalARS, totalUSD;
  if (mesFiltro) {
    // Usar gastosDelMes que calcula correctamente cuotas y offsetCuotas
    const items = gastosDelMes(mesFiltro);
    totalARS = items.filter(x => (x.moneda||'ARS') === 'ARS').reduce((s,x) => s + x.monto, 0);
    totalUSD = items.filter(x => x.moneda === 'USD').reduce((s,x) => s + x.monto, 0);
  } else {
    totalARS = rows.filter(g => (g.moneda||'ARS') === 'ARS').reduce((s,g) => s + (g.monto||0), 0);
    totalUSD = rows.filter(g => g.moneda === 'USD').reduce((s,g) => s + (g.monto||0), 0);
  }
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
  if (!_mesFiltro) _mesFiltro = mesActual;

  const meses = [...new Set(gastos.map(g => {
    const off = g.offsetCuotas || 0;
    if (!off) return g.fecha.slice(0,7);
    const [fy, fm] = g.fecha.split('-').map(Number);
    let cm = fm + off, cy = fy;
    while (cm > 12) { cm -= 12; cy++; }
    return `${cy}-${String(cm).padStart(2,'0')}`;
  }))].sort().reverse();
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
  if (!el) return;
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
  renderConceptosDropdown();
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
    el.innerHTML = '<div class="panel-empty">Sin cuentas agregadas</div>';
    return;
  }

  let saldos = {}, normalizarDestino = s => s;
  try { ({ saldos, normalizarDestino } = _buildCuentasYSaldos()); } catch(e) {}

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
        const label = t.label || (tipo === 'debito' ? 'CA ' + banco : banco);
        const sub = tipo === 'credito'
          ? (t.red ? t.red : 'Crédito') + (t.limite > 0 ? ' · Límite $' + fmt(t.limite) : '')
          : tipo === 'debito' ? 'Cuenta / Débito' : 'Billetera virtual';
        const key = normalizarDestino(label);
        const saldoCuenta = saldos[key];
        const saldoARS = saldoCuenta?.ars;
        const saldoStr = saldoARS !== undefined
          ? `<span style="font-family:'DM Mono',monospace;font-size:0.8rem;font-weight:700;color:${saldoARS >= 0 ? 'var(--accent3)' : 'var(--accent2)'}">$${fmt(saldoARS)}</span>`
          : '';
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid var(--border);gap:8px">
          <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
            <span style="font-size:1.3rem;flex-shrink:0">${icon}</span>
            <div style="min-width:0">
              <div style="font-size:0.85rem;font-weight:600;color:var(--text2)">${label}</div>
              <div style="font-size:0.72rem;color:var(--text3)">${sub}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
            ${saldoStr}
            <button onclick="deleteTarjeta(${t.id})" title="Eliminar" style="background:transparent;border:none;cursor:pointer;color:var(--text3);font-size:1rem;padding:4px;line-height:1;transition:color 0.15s" onmouseover="this.style.color='var(--accent2)'" onmouseout="this.style.color='var(--text3)'">🗑</button>
          </div>
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

  if (!fechaI) {
    notify('⚠ Completá la fecha');
    $('i-fecha').style.borderColor = 'var(--accent2)';
    setTimeout(() => { $('i-fecha').style.borderColor = ''; }, 2000);
    return;
  }
  if (sueldo <= 0 && !otrosPendientes.length) {
    notify('⚠ Ingresá el monto del ingreso');
    $('i-sueldo').style.borderColor = 'var(--accent2)';
    setTimeout(() => { $('i-sueldo').style.borderColor = ''; }, 2000);
    $('i-sueldo').focus();
    return;
  }

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
    renderConceptosDropdown();
  }

  save();

  // Limpiar formulario
  $('i-fecha').value = '';
  $('i-sueldo').value = '';
  if ($('i-sueldo-destino')) $('i-sueldo-destino').value = '';
  if ($('i-sueldo-concepto')) $('i-sueldo-concepto').value = $('i-sueldo-concepto').options[0]?.value || '';

  notify(`✓ Ingreso guardado`);
  renderIngresosTable();
  renderSaldoCuentas();
  setTimeout(() => renderDashboard(), 200);
  requestAnimationFrame(() => {
    const historial = $('ingresos-table-body');
    if (historial) historial.closest('.table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    const card = historial?.querySelector('.gasto-card');
    if (card) card.classList.add('row-new');
  });
}

function _destinosOptsHtml() {
  let html = '<option value="">Sin destino</option><option value="Efectivo">💵 Efectivo</option>';
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => { const l = t.label||t.banco||t.nombre; html += `<option value="${l}">📱 ${l}</option>`; });
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => { let l = t.label||('CA '+t.banco); if(l.startsWith('Débito ')) l='CA '+l.slice(7); html += `<option value="${l}">🏦 ${l}</option>`; });
  return html;
}

function _renderEiConceptos(currentValue) {
  const sel = $('ei-concepto');
  if (!sel) return;
  const custom = (conceptosGuardados || []).filter(c => !CONCEPTOS_PREDEFINIDOS.includes(c));
  let html = `<option value="Sueldo">💼 Sueldo</option>
<option value="Freelance">💻 Freelance</option>
<option value="Alquiler">🏠 Alquiler</option>
<option value="Facturación">🧾 Facturación</option>
<option value="Inversión">📈 Inversión</option>`;
  if (custom.length) {
    html += `<optgroup label="Mis conceptos">`;
    custom.forEach(c => { html += `<option value="${escHtml(c)}">📝 ${escHtml(c)}</option>`; });
    html += `</optgroup>`;
  }
  const known = ['Sueldo','Freelance','Alquiler','Facturación','Inversión',...custom];
  if (currentValue && !known.includes(currentValue)) {
    html += `<option value="${escHtml(currentValue)}">📝 ${escHtml(currentValue)}</option>`;
  }
  sel.innerHTML = html;
  if (currentValue) sel.value = currentValue;
}

function editarSueldoIngreso(id) {
  const i = ingresos.find(x => x.id === id);
  if (!i) return;
  _renderEiConceptos(i.sueldoConcepto || 'Sueldo');
  $('ei-moneda').value     = i.sueldoMoneda   || 'ARS';
  $('ei-monto').value      = i.sueldo         || 0;
  $('ei-destino').innerHTML = _destinosOptsHtml();
  $('ei-destino').value    = i.sueldoDestino  || '';
  $('ei-ingreso-id').value = id;
  $('ei-otro-id').value    = '';
  $('edit-ingreso-modal').style.display = 'flex';
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
        <button class="btn-edit" onclick="editarSueldoIngreso(${i.id})" title="Editar">✏</button>
        <button class="btn-del" onclick="eliminarSueldoIngreso(${i.id})" title="Eliminar">✕</button>
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
        <button class="btn-edit" onclick="editarOtroIngreso(${ingresoId},${o.id})" title="Editar">✏</button>
        <button class="btn-del" onclick="eliminarOtroIngreso(${ingresoId},${o.id})" title="Eliminar">✕</button>
      </span>
    </div>
  </div>`;
}

function editarOtroIngreso(ingresoId, otroId) {
  const ing = ingresos.find(i => i.id === ingresoId);
  if (!ing) return;
  const o = (ing.otros || []).find(x => x.id === otroId);
  if (!o) return;
  _renderEiConceptos(o.nombre || '');
  $('ei-moneda').value      = o.moneda  || 'ARS';
  $('ei-monto').value       = o.monto   || 0;
  $('ei-destino').innerHTML = _destinosOptsHtml();
  $('ei-destino').value     = o.destino || '';
  $('ei-ingreso-id').value  = ingresoId;
  $('ei-otro-id').value     = otroId;
  $('edit-ingreso-modal').style.display = 'flex';
}

function closeEditIngresoModal() {
  $('edit-ingreso-modal').style.display = 'none';
}

function saveEditIngresoModal() {
  const concepto = $('ei-concepto').value.trim();
  const moneda   = $('ei-moneda').value;
  const monto    = parseFloat($('ei-monto').value);
  const destino  = $('ei-destino').value;
  const ingresoId = parseInt($('ei-ingreso-id').value);
  const otroId    = parseInt($('ei-otro-id').value) || null;
  if (!concepto || isNaN(monto) || monto < 0) { notify('⚠ Completá concepto y monto'); return; }

  const ing = ingresos.find(i => i.id === ingresoId);
  if (!ing) return;

  if (!otroId) {
    // Editando sueldo principal
    const diff = monto - (ing.sueldo || 0);
    const oldMoneda = ing.sueldoMoneda || 'ARS';
    if (oldMoneda === 'ARS') ing.totalARS = (ing.totalARS ?? ing.total ?? 0) - (ing.sueldo || 0);
    if (moneda   === 'ARS') ing.totalARS = (ing.totalARS ?? 0) + monto;
    ing.total        = ing.totalARS;
    ing.sueldo       = monto;
    ing.sueldoConcepto = concepto;
    ing.sueldoMoneda   = moneda;
    ing.sueldoDestino  = destino;
    if (monto <= 0 && !(ing.otros && ing.otros.length)) {
      ingresos = ingresos.filter(x => x.id !== ingresoId);
    }
  } else {
    // Editando item de "otros"
    const o = (ing.otros || []).find(x => x.id === otroId);
    if (!o) return;
    if (o.moneda === 'ARS') ing.totalARS = (ing.totalARS || 0) - o.monto;
    if (moneda   === 'ARS') ing.totalARS = (ing.totalARS || 0) + monto;
    ing.total  = ing.totalARS;
    o.nombre   = concepto;
    o.monto    = monto;
    o.moneda   = moneda;
    o.destino  = destino;
  }

  save();
  closeEditIngresoModal();
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

const CONCEPTOS_PREDEFINIDOS = ['Sueldo','Freelance','Alquiler','Facturación','Inversión','Otros'];

function renderConceptosDropdown() {
  const sel = $('i-sueldo-concepto');
  if (!sel) return;
  const current = sel.value;
  const custom = (conceptosGuardados || []).filter(c => !CONCEPTOS_PREDEFINIDOS.includes(c));
  let html = `<option value="Sueldo">💼 Sueldo</option>
    <option value="Freelance">💻 Freelance</option>
    <option value="Alquiler">🏠 Alquiler</option>
    <option value="Facturación">🧾 Facturación</option>
    <option value="Inversión">📈 Inversión</option>`;
  if (custom.length) {
    html += `<optgroup label="Mis conceptos">`;
    custom.forEach(c => { html += `<option value="${c}">📝 ${c}</option>`; });
    html += `</optgroup>`;
  }
  html += `<option value="Otros">✏ Otros...</option>`;
  sel.innerHTML = html;
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
  toggleConceptoOtro();
}

function toggleConceptoOtro() {
  const sel = $('i-sueldo-concepto');
  const inp = $('i-sueldo-concepto-otro');
  const lbl = $('i-sueldo-label');
  const delBtn = $('concepto-delete-btn');
  if (!inp || !sel) return;
  const isOtros = sel.value === 'Otros';
  const isCustom = !CONCEPTOS_PREDEFINIDOS.includes(sel.value);
  inp.style.display = isOtros ? 'block' : 'none';
  if (isOtros) { inp.value = ''; inp.focus(); }
  if (delBtn) delBtn.style.display = (isCustom && !isOtros) ? 'block' : 'none';
  if (lbl) lbl.textContent = (isOtros || isCustom) ? 'Monto del ingreso' : (sel.value === 'Sueldo' ? 'Sueldo / Salario' : 'Monto');
}

function deleteConceptoIngreso() {
  const sel = $('i-sueldo-concepto');
  if (!sel) return;
  const nombre = sel.value;
  if (CONCEPTOS_PREDEFINIDOS.includes(nombre)) return;
  if (!confirm(`¿Eliminar el concepto "${nombre}"?`)) return;
  conceptosGuardados = conceptosGuardados.filter(c => c !== nombre);
  save();
  renderConceptosDropdown();
  notify(`✓ Concepto "${nombre}" eliminado`);
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
  const ingM      = ingresos.filter(i => !i.esTransferencia && (i.ymBase || (i.key||'').slice(0,7)) === ym);
  const totalIng  = ingM.reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalAho  = ahorros.filter(a => (a.ymBase || (a.key||'').slice(0,7)) === ym).reduce((s, a) => s + a.monto, 0);
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
  // "Promedio" y "Mejor mes" cuentan solo depósitos reales: excluyen rescates
  // (retiros) y transferencias entre fondos (movimientos de plata que ya estaba ahorrada)
  const depositosARS = ahorrosARS.filter(a => !a.rescate && !a.transfer && a.monto > 0);
  const mesesDep = [...new Set(depositosARS.map(a => a.ymBase || a.key))];
  const totalDepARS = depositosARS.reduce((s,a) => s + a.monto, 0);
  const promedio = mesesDep.length ? totalDepARS / mesesDep.length : 0;
  // Mejor mes
  const byMes = {};
  depositosARS.forEach(a => {
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
  const btn = (color, bg) => `border:1px solid ${color};background:${bg};color:${color};border-radius:10px;padding:9px 8px;font-size:0.78rem;font-weight:700;cursor:pointer;font-family:'Sora',sans-serif;min-height:42px;touch-action:manipulation;white-space:nowrap`;
  el.innerHTML = Object.entries(tipos).map(([tipo, v]) => `
    <div style="padding:0.9rem 1.2rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:10px">
        <div style="flex:1;min-width:0">
          <div style="font-size:0.9rem;font-weight:600;color:var(--text2)">${escHtml(tipo)}</div>
          ${v.rend > 0 ? `<div style="font-size:0.72rem;color:var(--accent);font-family:'DM Mono',monospace;margin-top:2px">▲ rendimientos: +$${fmt(v.rend)}</div>` : ''}
          ${v.usd > 0 ? `<div style="font-size:0.75rem;color:var(--accent3);font-family:'DM Mono',monospace">u$s ${fmt(v.usd)}</div>` : ''}
        </div>
        <div style="font-family:'DM Mono',monospace;font-weight:700;color:var(--accent);font-size:1.05rem;flex-shrink:0">$${fmt(v.ars)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <button onclick="agregarRendimientoFondo(this.dataset.tipo)" data-tipo="${tipo}" style="${btn('var(--accent)','rgba(168,255,220,0.08)')}">+$ Interés</button>
        <button onclick="transferirFondo(this.dataset.tipo)" data-tipo="${tipo}" style="${btn('var(--accent4)','rgba(59,130,246,0.1)')}">↔ Transferir</button>
        <button onclick="rescatarFondo(this.dataset.tipo)" data-tipo="${tipo}" style="${btn('var(--accent3)','rgba(245,184,46,0.1)')}">↓ Rescatar</button>
        <button onclick="eliminarFondo(this.dataset.tipo)" data-tipo="${tipo}" style="${btn('var(--accent2)','rgba(255,79,94,0.08)')}">🗑 Eliminar</button>
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

// ---- TRANSFERENCIA ENTRE FONDOS ----

function transferirFondo(tipo) {
  const sel = $('transfer-destino');
  if (!sel) return;
  // Fondos existentes distintos del origen
  const otros = [...new Set(ahorros.map(a => a.tipo || a.concepto || 'Otros'))].filter(t => t !== tipo);
  let opts = '<option value="">Seleccionar...</option>';
  otros.forEach(t => { opts += `<option value="${escHtml(t)}">💼 ${escHtml(t)}</option>`; });
  opts += '<option value="__nuevo__">➕ Nuevo fondo...</option>';
  sel.innerHTML = opts;

  const sub = $('transfer-modal-sub');
  if (sub) sub.textContent = `Desde: ${tipo}`;
  const montoEl = $('transfer-monto');
  if (montoEl) montoEl.value = '';
  const nuevoWrap = $('transfer-nuevo-wrap');
  if (nuevoWrap) nuevoWrap.style.display = 'none';
  const nuevoInp = $('transfer-destino-nuevo');
  if (nuevoInp) nuevoInp.value = '';

  window._transfiriendoTipo = tipo;
  const modal = $('transfer-modal');
  if (modal) modal.style.display = 'flex';
  setTimeout(() => { if (montoEl) montoEl.focus(); }, 100);
}

function onTransferDestinoChange() {
  const sel = $('transfer-destino');
  const wrap = $('transfer-nuevo-wrap');
  if (!sel || !wrap) return;
  if (sel.value === '__nuevo__') { wrap.style.display = 'block'; setTimeout(() => $('transfer-destino-nuevo')?.focus(), 50); }
  else wrap.style.display = 'none';
}

function cerrarTransferencia() {
  const modal = $('transfer-modal');
  if (modal) modal.style.display = '';
  window._transfiriendoTipo = null;
}

function confirmarTransferencia() {
  const origen = window._transfiriendoTipo;
  if (!origen) return;
  const monto = parseFloat($('transfer-monto')?.value);
  let destino = $('transfer-destino')?.value;
  if (destino === '__nuevo__') destino = ($('transfer-destino-nuevo')?.value || '').trim();
  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  if (!destino) { notify('⚠ Elegí o nombrá el fondo destino'); return; }
  if (destino === origen) { notify('⚠ El fondo destino debe ser distinto al de origen'); return; }

  // Verificar saldo suficiente en el fondo de origen (ARS)
  const totalFondo = ahorros
    .filter(a => (a.tipo || a.concepto || 'Otros') === origen && (a.moneda||'ARS') === 'ARS')
    .reduce((s, a) => s + (a.monto || 0), 0);
  if (monto > totalFondo) { notify(`⚠ Saldo insuficiente ($${fmt(totalFondo)})`); return; }

  const hoy = new Date();
  const fecha = hoy.toISOString().slice(0, 10);
  const ymBase = fecha.slice(0, 7);
  const mes  = MESES[hoy.getMonth()];
  const año  = hoy.getFullYear();
  const baseId = Date.now();

  // Sale del fondo origen (origen:'' → no afecta el saldo de ninguna cuenta)
  ahorros.push({
    id: baseId, ymBase, key: ymBase, fecha, año, mes,
    monto: -monto, moneda: 'ARS', tipo: origen, concepto: origen,
    notas: `Transferencia → ${destino}`, origen: '',
    rendimientos: 0, transfer: true
  });
  // Entra al fondo destino
  ahorros.push({
    id: baseId + 1, ymBase, key: ymBase, fecha, año, mes,
    monto: monto, moneda: 'ARS', tipo: destino, concepto: destino,
    notas: `Transferencia ← ${origen}`, origen: '',
    rendimientos: 0, transfer: true
  });

  cerrarTransferencia();
  save();
  renderAhorroTable();
  renderSaldoCuentas();
  renderDashboard();
  notify(`✓ Transferencia de $${fmt(monto)}: ${origen} → ${destino}`);
}

function eliminarFondo(tipo) {
  const delTipo = ahorros.filter(a => (a.tipo || a.concepto || 'Otros') === tipo);
  if (!delTipo.length) return;
  const saldoArs = delTipo.filter(a => (a.moneda||'ARS') === 'ARS').reduce((s,a) => s + (a.monto||0), 0);
  const saldoUsd = delTipo.filter(a => a.moneda === 'USD').reduce((s,a) => s + (a.monto||0), 0);
  let msg = `¿Eliminar el fondo "${tipo}"?\n\nSe borrarán ${delTipo.length} movimiento(s) del historial de ahorro.`;
  if (saldoArs !== 0 || saldoUsd !== 0) {
    msg += `\n\n⚠ OJO: este fondo todavía tiene saldo (`;
    const partes = [];
    if (saldoArs !== 0) partes.push(`$${fmt(saldoArs)}`);
    if (saldoUsd !== 0) partes.push(`u$s ${fmt(saldoUsd)}`);
    msg += partes.join(' / ') + `). Esa plata se va a descontar de tu total ahorrado.`;
  }
  if (!confirm(msg)) return;
  ahorros = ahorros.filter(a => (a.tipo || a.concepto || 'Otros') !== tipo);
  save({ skipMerge: true });
  renderAhorroTable();
  renderSaldoCuentas();
  renderDashboard();
  notify(`✓ Fondo "${tipo}" eliminado`);
}

// ---- PENDIENTES (MEMO) ----

const NOTA_COLORS = [
  { id: 'default', bg: 'var(--surface)',              border: 'var(--border)',              dot: '#555' },
  { id: 'yellow',  bg: 'rgba(245,184,46,0.15)',       border: 'rgba(245,184,46,0.4)',       dot: '#f5b82e' },
  { id: 'green',   bg: 'rgba(24,212,123,0.13)',       border: 'rgba(24,212,123,0.38)',      dot: '#18d47b' },
  { id: 'blue',    bg: 'rgba(59,130,246,0.13)',       border: 'rgba(59,130,246,0.38)',      dot: '#3b82f6' },
  { id: 'purple',  bg: 'rgba(168,85,247,0.13)',       border: 'rgba(168,85,247,0.38)',      dot: '#a855f7' },
  { id: 'red',     bg: 'rgba(255,79,94,0.13)',        border: 'rgba(255,79,94,0.38)',       dot: '#ff4f5e' },
];

function _notaColor(id) {
  return NOTA_COLORS.find(c => c.id === id) || NOTA_COLORS[0];
}

let _notaColorSeleccionado = 'default';

function abrirModalNota(id) {
  _notaColorSeleccionado = 'default';
  $('nota-titulo').value      = '';
  $('nota-body').value        = '';
  $('nota-monto').value       = '';
  $('nota-vencimiento').value = '';
  $('nota-editing-id').value  = '';

  if (id) {
    const p = pendientes.find(x => x.id === id);
    if (p) {
      $('nota-titulo').value      = p.desc || '';
      $('nota-body').value        = p.body || '';
      $('nota-monto').value       = p.monto || '';
      $('nota-vencimiento').value = p.vencimiento || '';
      $('nota-editing-id').value  = id;
      _notaColorSeleccionado = p.color || 'default';
    }
  }

  _renderColorPicker();
  $('notas-grid').style.display    = 'none';
  $('notas-search').closest('div').style.display = 'none';
  $('notas-filtros').style.display = 'none';
  $('nota-panel').style.display = 'block';
  setTimeout(() => $('nota-titulo').focus(), 100);
}

function _renderColorPicker() {
  const el = $('nota-colores');
  if (!el) return;
  el.innerHTML = NOTA_COLORS.map(c => `
    <div onclick="_selectNotaColor('${c.id}')" id="nc-${c.id}"
      style="width:28px;height:28px;border-radius:50%;background:${c.dot};cursor:pointer;
             border:3px solid ${_notaColorSeleccionado === c.id ? '#fff' : 'transparent'};
             box-shadow:${_notaColorSeleccionado === c.id ? '0 0 0 2px '+c.dot : 'none'};
             transition:all 0.15s;flex-shrink:0"></div>
  `).join('');
}

function _selectNotaColor(id) {
  _notaColorSeleccionado = id;
  _renderColorPicker();
}

function cerrarModalNota(e) {
  $('nota-panel').style.display = 'none';
  $('notas-grid').style.display = 'grid';
  const searchWrap = $('notas-search')?.closest('div');
  if (searchWrap) searchWrap.style.display = '';
  $('notas-filtros').style.display = 'flex';
}

function guardarNota() {
  const titulo = $('nota-titulo').value.trim();
  const body   = $('nota-body').value.trim();
  const monto  = parseFloat($('nota-monto').value) || 0;
  if (!titulo && !body) { notify('⚠ Escribí algo'); return; }

  const vencimiento = $('nota-vencimiento').value || '';
  const editingId = parseInt($('nota-editing-id').value) || null;
  if (editingId) {
    const p = pendientes.find(x => x.id === editingId);
    if (p) {
      p.desc        = titulo || body.slice(0, 40);
      p.body        = body;
      p.monto       = monto;
      p.color       = _notaColorSeleccionado;
      p.vencimiento = vencimiento;
    }
  } else {
    pendientes.push({
      id: Date.now(),
      desc:  titulo || body.slice(0, 40),
      body,
      monto,
      vencimiento,
      color: _notaColorSeleccionado,
      estado: 'pendiente',
      fecha:  new Date().toISOString().slice(0,10)
    });
  }

  save();
  cerrarModalNota();
  notify('✓ Nota guardada');
  renderNotasGrid();
}

function togglePendiente(id) {
  const p = pendientes.find(x => x.id === id);
  if (!p) return;
  const completando = p.estado !== 'completado';
  p.estado = completando ? 'completado' : 'pendiente';
  if (completando && p.monto > 0) {
    _pendienteRegistrando = id;
  } else {
    if (_pendienteRegistrando === id) _pendienteRegistrando = null;
  }
  save();
  renderNotasGrid();
}

function registrarPendienteComoGasto(id) {
  const p = pendientes.find(x => x.id === id);
  if (!p) return;
  const cat   = document.getElementById(`pr-cat-${id}`)?.value;
  const medio = document.getElementById(`pr-medio-${id}`)?.value;
  if (!cat)   { notify('⚠ Seleccioná una categoría'); return; }
  if (!medio) { notify('⚠ Seleccioná un medio de pago'); return; }
  const hoy = new Date().toISOString().slice(0,10);
  gastos.push({
    id: Date.now(), fecha: hoy, desc: p.desc, cat, medio,
    monto: p.monto, moneda: 'ARS', cuota: false,
    ncuotas: 1, montoXcuota: p.monto,
    mes: MESES[new Date().getMonth()]
  });
  _pendienteRegistrando = null;
  save();
  notify('✓ Gasto registrado');
  renderNotasGrid();
  renderDashboard();
}

function saltarRegistroPendiente(id) {
  _pendienteRegistrando = null;
  renderNotasGrid();
}

function deletePendiente(id) {
  if (!confirm('¿Eliminar esta nota?')) return;
  pendientes = pendientes.filter(p => p.id !== id);
  if (_pendienteRegistrando === id) _pendienteRegistrando = null;
  save({ skipMerge: true });
  notify('Nota eliminada');
  renderNotasGrid();
}

function addPendiente() { abrirModalNota(null); }

function limpiarCompletados() {
  const n = pendientes.filter(p => p.estado === 'completado').length;
  if (!n) { notify('No hay notas listas'); return; }
  if (!confirm(`¿Eliminar ${n} nota${n>1?'s':''} lista${n>1?'s':''}?`)) return;
  pendientes = pendientes.filter(p => p.estado !== 'completado');
  save();
  notify(`${n} eliminada${n>1?'s':''}`);
  renderNotasGrid();
}

function setPendienteFiltro(filtro, btn) {
  pendienteFiltro = filtro;
  document.querySelectorAll('[id^="pf-"]').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderNotasGrid();
}

function renderPendientesTab() { renderNotasGrid(); }

function renderNotasGrid() {
  const el = $('notas-grid');
  if (!el) return;

  const q = ($('notas-search')?.value || '').toLowerCase();
  const hoy = new Date().toISOString().slice(0,10);
  const _vScore = p => {
    if (!p.vencimiento || p.estado === 'completado') return 99999;
    const diff = Math.round((new Date(p.vencimiento) - new Date(hoy)) / 86400000);
    return diff;
  };
  let rows = [...pendientes].sort((a,b) => {
    const va = _vScore(a), vb = _vScore(b);
    if (va !== vb) return va - vb;
    return b.id - a.id;
  });
  if (pendienteFiltro === 'pendientes')  rows = rows.filter(p => p.estado !== 'completado');
  if (pendienteFiltro === 'completados') rows = rows.filter(p => p.estado === 'completado');
  if (q) rows = rows.filter(p => (p.desc||'').toLowerCase().includes(q) || (p.body||'').toLowerCase().includes(q));

  const catOpts  = cats.gastos.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
  const medioOpts = ['Efectivo', ...tarjetas.map(t => t.label||t.nombre||t.banco)]
    .map(m => `<option value="${escHtml(m)}">${escHtml(m)}</option>`).join('');

  const nuevaCard = `<div onclick="abrirModalNota(null)"
    style="border:2px dashed var(--border);border-radius:14px;padding:14px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:90px;transition:border-color 0.18s"
    onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
    <span style="font-size:1.8rem;color:var(--accent);line-height:1">+</span>
    <span style="font-size:0.75rem;color:var(--text3)">Nueva nota</span>
  </div>`;

  const emptyMsg = !rows.length ? `<div style="grid-column:span 1;display:flex;align-items:center;justify-content:center;padding:2rem 0.5rem;color:var(--text3);font-size:0.82rem;text-align:center">${q ? 'Sin resultados' : 'Tus notas\naparecen acá'}</div>` : '';

  el.innerHTML = nuevaCard + emptyMsg + rows.map(p => {
    const done  = p.estado === 'completado';
    const col   = _notaColor(p.color);
    const mostrarForm = done && p.monto > 0 && _pendienteRegistrando === p.id;
    const bodyPreview = (p.body || '').slice(0, 80) + ((p.body||'').length > 80 ? '…' : '');

    return `<div onclick="abrirModalNota(${p.id})"
      style="background:${col.bg};border:1px solid ${mostrarForm ? 'var(--accent)' : col.border};border-radius:14px;padding:14px;cursor:pointer;position:relative;opacity:${done && !mostrarForm ? 0.6 : 1};transition:transform 0.15s;active:scale(0.97)">

      <!-- Checkbox done -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div onclick="event.stopPropagation();togglePendiente(${p.id})"
          style="width:20px;height:20px;border-radius:50%;border:2px solid ${done ? 'var(--accent)' : col.border};background:${done ? 'var(--accent)' : 'transparent'};display:flex;align-items:center;justify-content:center;flex-shrink:0;cursor:pointer;transition:all 0.18s">
          ${done ? '<span style="color:#000;font-size:0.7rem;font-weight:900">✓</span>' : ''}
        </div>
        <button class="btn-del" onclick="event.stopPropagation();deletePendiente(${p.id})"
          style="padding:3px 7px;font-size:0.7rem;min-height:24px;min-width:24px">✕</button>
      </div>

      <!-- Título -->
      ${p.desc ? `<div style="font-size:0.92rem;font-weight:700;color:${done?'var(--text3)':'var(--text1)'};text-decoration:${done?'line-through':'none'};margin-bottom:4px;word-break:break-word;line-height:1.3">${escHtml(p.desc)}</div>` : ''}

      <!-- Cuerpo -->
      ${bodyPreview ? `<div style="font-size:0.78rem;color:var(--text3);line-height:1.5;word-break:break-word">${escHtml(bodyPreview)}</div>` : ''}

      <!-- Monto -->
      ${p.monto > 0 ? `<div style="margin-top:8px;font-family:'DM Mono',monospace;font-size:0.82rem;font-weight:700;color:var(--accent)">$${fmt(p.monto)}</div>` : ''}

      <!-- Vencimiento -->
      ${(() => {
        if (!p.vencimiento || done) return '';
        const hoy = new Date().toISOString().slice(0,10);
        const diff = Math.round((new Date(p.vencimiento) - new Date(hoy)) / 86400000);
        const color = diff < 0 ? '#f87171' : diff <= 3 ? '#fcd34d' : 'var(--text3)';
        const label = diff < 0 ? `Venció hace ${-diff}d` : diff === 0 ? 'Vence hoy' : diff === 1 ? 'Vence mañana' : `Vence en ${diff}d`;
        return `<div style="margin-top:6px;font-size:0.75rem;color:${color};font-weight:${diff<=3?'700':'400'}">📅 ${label}</div>`;
      })()}

      <!-- Form registrar gasto -->
      ${mostrarForm ? `
      <div onclick="event.stopPropagation()" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
        <div style="font-size:0.68rem;color:var(--accent);font-weight:700;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">¿Registrar como gasto?</div>
        <select id="pr-cat-${p.id}" style="background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:6px 8px;color:var(--text1);font-size:0.78rem;width:100%;margin-bottom:6px">
          <option value="">Categoría...</option>${catOpts}
        </select>
        <select id="pr-medio-${p.id}" style="background:var(--bg2);border:1px solid var(--border);border-radius:7px;padding:6px 8px;color:var(--text1);font-size:0.78rem;width:100%;margin-bottom:8px">
          <option value="">Medio de pago...</option>${medioOpts}
        </select>
        <div style="display:flex;gap:6px">
          <button onclick="registrarPendienteComoGasto(${p.id})"
            style="flex:1;background:var(--accent);color:#000;border:none;border-radius:7px;padding:7px;font-size:0.75rem;font-weight:700;cursor:pointer;font-family:inherit">✓ Registrar</button>
          <button onclick="saltarRegistroPendiente(${p.id})"
            style="flex:1;background:var(--bg2);color:var(--text3);border:1px solid var(--border);border-radius:7px;padding:7px;font-size:0.75rem;cursor:pointer;font-family:inherit">Solo listo</button>
        </div>
      </div>` : ''}
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
      <button class="btn-edit" onclick="editCat(${i})" title="Renombrar">✏</button>
      <button class="btn-del" onclick="deleteCat(${i})" title="Eliminar">✕</button>
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
let registerStep = 1;   // 1 = verificar email, 2 = crear cuenta

function _authError(msg) {
  const el = $('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function authAction() {
  const email = $('auth-email').value.trim();
  const errEl = $('auth-error');
  errEl.textContent = '';
  errEl.style.display = 'none';
  errEl.style.background = '';
  errEl.style.borderColor = '';
  errEl.style.color = '';

  if (!email) { _authError('Ingresá tu correo electrónico'); return; }

  if (authMode === 'login') {
    const pass = $('auth-pass').value;
    if (!pass) { _authError('Ingresá tu contraseña'); return; }
    window._fbSignIn(window._fbAuth, email, pass)
      .catch(e => _authError(e.code === 'auth/invalid-credential' ? 'Email o contraseña incorrectos' : e.message));
    return;
  }

  // Modo registro - paso 1: verificar si el email está habilitado
  if (registerStep === 1) {
    const btn = $('auth-btn');
    btn.textContent = 'Verificando...';
    btn.disabled = true;
    window._fbGetDoc(window._fbDoc(window._fbDb, 'config', 'habilitados'))
      .then(snap => {
        const lista = snap.exists() ? (snap.data().emails || []) : [];
        if (lista.includes(email.toLowerCase())) {
          registerStep = 2;
          $('auth-pass-wrap').style.display  = '';
          $('auth-pass2-wrap').style.display = '';
          $('auth-pass-hint').style.display  = '';
          $('auth-subtitle').textContent = 'Tu correo está habilitado. Elegí una contraseña.';
          btn.textContent = 'Crear cuenta';
          btn.disabled = false;
          setTimeout(() => $('auth-pass').focus(), 100);
        } else {
          const waMsg = encodeURIComponent(`Hola, quiero acceso a finanzapp. Mi correo es: ${email}`);
          const waLink = $('wa-acceso-link');
          if (waLink) waLink.href = `https://wa.me/5492995075494?text=${waMsg}`;
          document.getElementById('auth-screen').style.display = 'none';
          document.getElementById('acceso-denegado-screen').style.display = 'flex';
          btn.textContent = 'Verificar acceso';
          btn.disabled = false;
        }
      })
      .catch(() => {
        const waMsg = encodeURIComponent(`Hola, quiero acceso a finanzapp. Mi correo es: ${email}`);
        const waLink = $('wa-acceso-link');
        if (waLink) waLink.href = `https://wa.me/5492995075494?text=${waMsg}`;
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('acceso-denegado-screen').style.display = 'flex';
        $('auth-btn').textContent = 'Verificar acceso';
        $('auth-btn').disabled = false;
      });
    return;
  }

  // Modo registro - paso 2: crear cuenta
  const pass  = $('auth-pass').value;
  const pass2 = $('auth-pass2').value;
  if (pass.length < 6) { _authError('La contraseña debe tener al menos 6 caracteres'); return; }
  if (pass !== pass2)  { _authError('Las contraseñas no coinciden'); return; }
  const btn = $('auth-btn');
  btn.textContent = 'Creando cuenta...';
  btn.disabled = true;
  window._fbCreateUser(window._fbAuth, email, pass)
    .catch(e => {
      btn.textContent = 'Crear cuenta';
      btn.disabled = false;
      if (e.code === 'auth/email-already-in-use') {
        _authError('Ya existe una cuenta con este email. Usá la opción "Ingresá" para iniciar sesión.');
      } else {
        _authError(e.message);
      }
    });
}

function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  const isReg = authMode === 'register';
  registerStep = 1;
  $('auth-title').textContent    = isReg ? 'Crear cuenta' : 'Iniciar sesión';
  $('auth-subtitle').textContent = isReg ? 'Ingresá tu correo para verificar si tenés acceso' : 'Ingresá con tu cuenta para continuar';
  $('auth-btn').textContent      = isReg ? 'Verificar acceso' : 'Ingresar';
  $('auth-toggle').innerHTML     = isReg
    ? '¿Ya tenés cuenta? <span onclick="window.toggleAuthMode()">Ingresá</span>'
    : '¿No tenés cuenta? <span onclick="window.toggleAuthMode()">Registrate</span>';
  $('auth-pass-wrap').style.display   = isReg ? 'none' : '';
  $('auth-pass2-wrap').style.display  = 'none';
  $('auth-pass-hint').style.display   = 'none';
  $('auth-reset-wrap').style.display  = isReg ? 'none' : '';
  $('auth-error').textContent = '';
  $('auth-error').style.display = 'none';
  $('auth-pass').value  = '';
  $('auth-pass2').value = '';
}

function resetPassword() {
  const email = $('auth-email').value.trim();
  if (!email) { _authError('Ingresá tu email arriba y luego tocá este botón'); return; }
  window._fbResetPassword(window._fbAuth, email)
    .then(() => {
      const el = $('auth-error');
      el.style.background = 'rgba(24,212,123,0.1)';
      el.style.borderColor = 'rgba(24,212,123,0.3)';
      el.style.color = 'var(--accent)';
      el.textContent = '✓ Te enviamos un email para restablecer la contraseña';
      el.style.display = 'block';
    })
    .catch(e => _authError(e.code === 'auth/user-not-found' ? 'No existe una cuenta con ese email' : e.message));
}

window.volverAlLogin = function() {
  document.getElementById('acceso-denegado-screen').style.display = 'none';
  document.getElementById('auth-screen').style.display = 'flex';
  // Resetear al paso 1 de registro por si quiere reintentar
  if (authMode === 'register') {
    registerStep = 1;
    $('auth-pass-wrap').style.display  = 'none';
    $('auth-pass2-wrap').style.display = 'none';
    $('auth-pass-hint').style.display  = 'none';
    $('auth-subtitle').textContent = 'Ingresá tu correo para verificar si tenés acceso';
    $('auth-btn').textContent = 'Verificar acceso';
    $('auth-btn').disabled = false;
    $('auth-pass').value  = '';
    $('auth-pass2').value = '';
  }
};

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

// Los n meses justo anteriores al período actual (para comparar)
function _getMesesPrevios(n) {
  const meses = [];
  const now = new Date();
  for (let i = 2 * n - 1; i >= n; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    meses.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return meses;
}

// Chip de variación vs período anterior. invert=true → bajar es bueno (gastos). points=true → diferencia en pp.
function _kpiVar(actual, prev, { invert = false, points = false } = {}) {
  if (prev === null || prev === undefined) return '';
  if (!points && prev === 0) return '';
  const igual = Math.abs(actual - prev) < 0.005;
  if (igual) return `<span style="font-size:0.66rem;color:var(--text3);font-weight:600">→ 0%${points ? 'pp' : ''}</span>`;
  const subio = actual > prev;
  const texto = points
    ? Math.abs(Math.round(actual - prev)) + 'pp'
    : Math.abs(Math.round((actual - prev) / Math.abs(prev) * 100)) + '%';
  const good = invert ? !subio : subio;
  const color = good ? 'var(--accent)' : 'var(--accent2)';
  return `<span style="font-size:0.66rem;color:${color};font-weight:600">${subio ? '▲' : '▼'} ${texto}<span style="color:var(--text3);font-weight:400"> vs ant.</span></span>`;
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

  // Ahorro neto y ajustes por mes (para la tasa de ahorro y el gráfico de balance)
  const ahorroPorMes  = meses.map(m => ahorros.filter(a => (a.ymBase || a.key?.slice(0, 7) || '') === m && (a.moneda || 'ARS') === 'ARS').reduce((s, a) => s + (a.monto || 0), 0));
  const ajustesPorMes = meses.map(m => (ajustesCuentas || []).filter(a => (a.fecha || '').slice(0, 7) === m).reduce((s, a) => s + (a.monto || 0), 0));

  // ── Resumen del período (KPIs con variación vs período anterior) ─────────
  const totIng = ingData.reduce((a, b) => a + b, 0);
  const totGas = gasData.reduce((a, b) => a + b, 0);
  const totAho = ahorroPorMes.reduce((a, b) => a + b, 0);
  const tasa   = totIng > 0 ? (totAho / totIng * 100) : 0;

  const mesesPrev = _getMesesPrevios(repPeriodo);
  const sumIngM = mm => mm.reduce((s, m) => s + _totalIngresosYm(m), 0);
  const sumGasM = mm => mm.reduce((s, m) => s + gastosDelMes(m).filter(g => (g.moneda || 'ARS') === 'ARS').reduce((ss, g) => ss + g.monto, 0), 0);
  const sumAhoM = mm => mm.reduce((s, m) => s + ahorros.filter(a => (a.ymBase || a.key?.slice(0, 7) || '') === m && (a.moneda || 'ARS') === 'ARS').reduce((ss, a) => ss + (a.monto || 0), 0), 0);
  const totIngPrev = sumIngM(mesesPrev);
  const totGasPrev = sumGasM(mesesPrev);
  const totAhoPrev = sumAhoM(mesesPrev);
  const tasaPrev   = totIngPrev > 0 ? (totAhoPrev / totIngPrev * 100) : 0;

  const resumenEl = $('rep-resumen');
  if (resumenEl) {
    const card = (label, valor, varHtml, color, title) => `
      <div title="${title}" style="background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:0.9rem 1rem">
        <div style="font-size:0.64rem;color:var(--text3);font-weight:600;letter-spacing:0.6px;text-transform:uppercase;margin-bottom:6px">${label}</div>
        <div style="font-family:'DM Mono',monospace;font-weight:700;font-size:1.12rem;color:${color}">${valor}</div>
        <div style="margin-top:4px;min-height:14px">${varHtml}</div>
      </div>`;
    resumenEl.innerHTML =
      card('Ingresos', '$' + fmt(totIng), _kpiVar(totIng, totIngPrev), 'var(--accent)', 'Total de ingresos registrados en el período') +
      card('Gastos', '$' + fmt(totGas), _kpiVar(totGas, totGasPrev, { invert: true }), 'var(--accent2)', 'Total de gastos del período') +
      card('Tasa de ahorro', Math.round(tasa) + '%', _kpiVar(tasa, tasaPrev, { points: true }), tasa >= 0 ? 'var(--accent3)' : 'var(--accent2)', 'Que parte de tus ingresos fue a ahorro (Ahorro neto / Ingresos)');
  }

  // ── 2. Balance mensual (ingresos − gastos) ──────────────────────────────
  _destroyChart('balance');
  const balanceData = meses.map((m, i) => ingData[i] - gasData[i]);
  const ajustesDataset = meses.map((m, i) => ajustesPorMes[i] !== 0 ? balanceData[i] : null);

  _charts['balance'] = new Chart($('chart-balance'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Balance',
          data: balanceData,
          borderColor: '#6ee7b7',
          backgroundColor: balanceData.map(v => v >= 0 ? '#6ee7b722' : '#f8717122'),
          borderWidth: 2,
          pointRadius: 4,
          pointBackgroundColor: balanceData.map(v => v >= 0 ? '#6ee7b7' : '#f87171'),
          fill: true,
          tension: 0.3
        },
        {
          label: 'Ajuste manual',
          data: ajustesDataset,
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          pointRadius: 7,
          pointBackgroundColor: '#fcd34d',
          pointBorderColor: '#fcd34d',
          pointStyle: 'triangle',
          showLine: false
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            afterBody: (items) => {
              const idx = items[0]?.dataIndex;
              if (idx === undefined) return;
              const aj = ajustesPorMes[idx];
              if (aj === 0) return;
              return `⚠ Ajuste manual: ${aj > 0 ? '+' : ''}$${fmt(Math.abs(aj))}`;
            }
          }
        }
      },
      scales: {
        x: { ticks: { color: text2 }, grid: { color: border } },
        y: { ticks: { color: text2, callback: v => '$' + fmt(v) }, grid: { color: border },
             afterDataLimits: axis => { const m = Math.max(Math.abs(axis.min), Math.abs(axis.max)); axis.min = -m * 1.1; axis.max = m * 1.1; } }
      }
    }
  });

  // ── 3. Gastos por categoría (donut) ─────────────────────────────────────
  _destroyChart('cats');
  const gastadoCat = {};
  meses.forEach(m => gastosDelMes(m).forEach(g => {
    if ((g.moneda || 'ARS') !== 'ARS') return;
    gastadoCat[g.cat] = (gastadoCat[g.cat] || 0) + g.monto;
  }));
  const catEntries = Object.entries(gastadoCat).sort((a, b) => b[1] - a[1]);
  const totalCat = catEntries.reduce((s, [, v]) => s + v, 0);

  if (catEntries.length) {
    const catColors = catEntries.map(([c]) => catColor(c));
    const centerTextPlugin = {
      id: 'centerText',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: { width, height, left, top } } = chart;
        ctx.save();
        const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
        const cx = left + width / 2;
        const cy = top + height / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f8fafc';
        ctx.font = "700 15px 'Sora', sans-serif";
        ctx.fillText('$' + fmt(total), cx, cy - 9);
        ctx.font = "11px 'Sora', sans-serif";
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.fillText('total', cx, cy + 10);
        ctx.restore();
      }
    };
    _charts['cats'] = new Chart($('chart-cats'), {
      type: 'doughnut',
      data: {
        labels: catEntries.map(([c]) => c),
        datasets: [{
          data: catEntries.map(([, v]) => v),
          backgroundColor: catColors,
          borderWidth: 2,
          borderColor: 'rgba(9,16,28,0.85)',
          hoverOffset: 10,
          hoverBorderWidth: 0
        }]
      },
      options: {
        responsive: true,
        cutout: '72%',
        animation: { duration: 700, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(9,16,28,0.92)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#f8fafc',
            bodyColor: 'rgba(182,194,209,0.85)',
            titleFont: { family: "'Sora', sans-serif", size: 12, weight: '700' },
            bodyFont: { family: "'DM Mono', monospace", size: 11 },
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              label: ctx => {
                const pct = totalCat > 0 ? Math.round(ctx.parsed / totalCat * 100) : 0;
                return `  $${fmt(ctx.parsed)}  (${pct}%)`;
              }
            }
          }
        }
      },
      plugins: [centerTextPlugin]
    });
    $('chart-cats-legend').innerHTML = catEntries.map(([c, v]) => {
      const pct = totalCat > 0 ? Math.round(v / totalCat * 100) : 0;
      const color = catColor(c);
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <span style="font-size:0.8rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="font-size:0.72rem;background:${color}22;color:${color};border-radius:6px;padding:1px 6px;font-weight:600">${pct}%</span>
          <span style="font-size:0.75rem;color:var(--text3);font-family:'DM Mono',monospace">$${fmt(v)}</span>
        </div>
      </div>`;
    }).join('');
  } else {
    $('chart-cats-legend').innerHTML = '<span style="color:var(--text3)">Sin datos</span>';
  }

  // ── 4. Evolución del ahorro total ────────────────────────────────────────
  _destroyChart('ahorro');
  const ahorroMensual = meses.map(m =>
    ahorros.filter(a => (a.ymBase || a.key?.slice(0, 7) || '') === m)
           .reduce((s, a) => s + ((a.moneda || 'ARS') === 'ARS' ? (a.monto || 0) : 0), 0)
  );
  const ahorroData = meses.map(m =>
    ahorros.filter(a => (a.ymBase || a.key?.slice(0, 7) || '') <= m)
           .reduce((s, a) => s + ((a.moneda || 'ARS') === 'ARS' ? (a.monto || 0) : 0), 0)
  );

  _charts['ahorro'] = new Chart($('chart-ahorro'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Ahorro del mes',
          data: ahorroMensual,
          backgroundColor: '#fcd34d66',
          borderColor: '#fcd34d',
          borderWidth: 2,
          borderRadius: 6,
          order: 2
        },
        {
          label: 'Acumulado',
          data: ahorroData,
          type: 'line',
          borderColor: '#6ee7b7',
          backgroundColor: 'transparent',
          borderWidth: 2,
          pointRadius: 4,
          tension: 0.3,
          order: 1
        }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: text2 } } },
      scales: {
        x: { ticks: { color: text2 }, grid: { color: border } },
        y: { ticks: { color: text2, callback: v => '$' + fmt(v) }, grid: { color: border } }
      }
    }
  });

  // ── 4b. Dónde está el ahorro: distribución por fondo (saldo actual) ──────
  _destroyChart('fondos');
  const fondoTotals = {};
  const fondoUsd = {};
  ahorros.forEach(a => {
    const t = a.tipo || a.concepto || 'Otros';
    if ((a.moneda || 'ARS') === 'ARS') fondoTotals[t] = (fondoTotals[t] || 0) + (a.monto || 0);
    else fondoUsd[t] = (fondoUsd[t] || 0) + (a.monto || 0);
  });
  const fondoEntries = Object.entries(fondoTotals).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const totalFondos = fondoEntries.reduce((s, [, v]) => s + v, 0);

  if (fondoEntries.length) {
    const fondoColors = fondoEntries.map((_, i) => PALETTE[i % PALETTE.length]);
    const centerTextFondos = {
      id: 'centerTextFondos',
      beforeDatasetsDraw(chart) {
        const { ctx, chartArea: { width, height, left, top } } = chart;
        ctx.save();
        const total = chart.data.datasets[0].data.reduce((a, b) => a + b, 0);
        const cx = left + width / 2;
        const cy = top + height / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#f8fafc';
        ctx.font = "700 15px 'Sora', sans-serif";
        ctx.fillText('$' + fmt(total), cx, cy - 9);
        ctx.font = "11px 'Sora', sans-serif";
        ctx.fillStyle = 'rgba(148,163,184,0.7)';
        ctx.fillText('total ahorrado', cx, cy + 10);
        ctx.restore();
      }
    };
    _charts['fondos'] = new Chart($('chart-fondos'), {
      type: 'doughnut',
      data: {
        labels: fondoEntries.map(([c]) => c),
        datasets: [{
          data: fondoEntries.map(([, v]) => v),
          backgroundColor: fondoColors,
          borderWidth: 2,
          borderColor: 'rgba(9,16,28,0.85)',
          hoverOffset: 10,
          hoverBorderWidth: 0
        }]
      },
      options: {
        responsive: true,
        cutout: '72%',
        animation: { duration: 700, easing: 'easeOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(9,16,28,0.92)',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            titleColor: '#f8fafc',
            bodyColor: 'rgba(182,194,209,0.85)',
            titleFont: { family: "'Sora', sans-serif", size: 12, weight: '700' },
            bodyFont: { family: "'DM Mono', monospace", size: 11 },
            padding: 10,
            cornerRadius: 10,
            callbacks: {
              label: ctx => {
                const pct = totalFondos > 0 ? Math.round(ctx.parsed / totalFondos * 100) : 0;
                return `  $${fmt(ctx.parsed)}  (${pct}%)`;
              }
            }
          }
        }
      },
      plugins: [centerTextFondos]
    });
    $('chart-fondos-legend').innerHTML = fondoEntries.map(([c, v], i) => {
      const pct = totalFondos > 0 ? Math.round(v / totalFondos * 100) : 0;
      const color = fondoColors[i];
      const usd = fondoUsd[c] || 0;
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <div style="display:flex;align-items:center;gap:8px;min-width:0">
          <span style="width:10px;height:10px;border-radius:50%;background:${color};flex-shrink:0"></span>
          <span style="font-size:0.8rem;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(c)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          <span style="font-size:0.72rem;background:${color}22;color:${color};border-radius:6px;padding:1px 6px;font-weight:600">${pct}%</span>
          <span style="font-size:0.75rem;color:var(--text3);font-family:'DM Mono',monospace">$${fmt(v)}${usd > 0 ? ` · u$s ${fmt(usd)}` : ''}</span>
        </div>
      </div>`;
    }).join('');
  } else if ($('chart-fondos-legend')) {
    $('chart-fondos-legend').innerHTML = '<span style="color:var(--text3)">Sin fondos con saldo</span>';
  }

  // ── 5. Top categorías (barra horizontal) ────────────────────────────────
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
  const gastosNormalesM = itemsM.filter(g => !g.cuota && !g.esTransferencia);
  const cuotasEnMes = gastos.filter(g => {
    if (!g.cuota) return false;
    const [fy, fm] = g.fecha.split('-').map(Number);
    const [wy, wm] = ym.split('-').map(Number);
    const n0 = (wy - fy) * 12 + (wm - fm);
    return n0 >= 0 && n0 < g.ncuotas;
  });

  const totalGasto = itemsM.filter(x => (x.moneda||'ARS')==='ARS').reduce((s, x) => s + x.monto, 0);
  const totalGastoUSDMes = itemsM.filter(x => x.moneda==='USD').reduce((s, x) => s + x.monto, 0);
  const ingM = ingresos.filter(i => !i.esTransferencia && (i.ymBase || (i.key||'').slice(0,7)) === ym);
  const ahorrosM = ahorros.filter(a => (a.ymBase || (a.key||'').slice(0,7)) === ym);
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

  const totalDisponible = calcTotalSaldoARS();

  animateValue('d-gasto', totalGasto, '$');
  animateValue('d-ingreso', totalIngreso, '$');
  animateValue('d-saldo', totalDisponible, '$');
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
  const ingPrevM = ingresos.filter(i => !i.esTransferencia && (i.ymBase || (i.key||'').slice(0,7)) === prevM).reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
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

  // Header del panel de cuotas activas
  const todayYmN = today.getFullYear() * 12 + today.getMonth();
  const nActivas = gastos.filter(g => {
    if (!g.cuota || g.esTransferencia) return false;
    const [fy, fm] = g.fecha.split('-').map(Number);
    const off = g.offsetCuotas || 0;
    let sy = fy, sm = fm + off;
    while (sm > 12) { sm -= 12; sy++; }
    return todayYmN <= sy * 12 + (sm - 1) + g.ncuotas - 1;
  }).length;
  const dcActivas = $('dc-activas');
  const dcTotal   = $('dc-total');
  if (dcActivas) dcActivas.textContent = nActivas;
  if (dcTotal)   dcTotal.textContent   = totalAdeudado > 0 ? '$' + fmt(totalAdeudado) : '$0';

  renderDashCuotas();
  _renderSaldoUSDPanel(ym);

  // Saldo sub label
  const subEl = $('d-saldo-sub');
  if (subEl) subEl.textContent = 'suma de cuentas';

  // Saldo color
  const saldoEl = $('d-saldo');
  saldoEl.style.color = totalDisponible >= 0 ? 'var(--accent)' : 'var(--accent2)';

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

    const monthlyBars = $('monthly-bars');
    const saldoWrap = $('chart-saldo-evol')?.parentElement;
    if (!allMonths.length) {
      if (monthlyBars) monthlyBars.style.display = 'none';
      if (saldoWrap) saldoWrap.style.display = 'none';
      return;
    }
    if (monthlyBars) monthlyBars.style.display = '';
    if (saldoWrap) saldoWrap.style.display = '';

    const labels = allMonths.map(m => MESES[parseInt(m.slice(5,7))-1].slice(0,3));
    const dataGasto  = allMonths.map(m => totalDelMes(m));
    const dataIngreso = allMonths.map(m =>
      ingresos.filter(i=>(i.ymBase||(i.key||'').slice(0,7))===m).reduce((s,i)=>s+(i.totalARS??i.total??0),0)
    );

    // Saldo evolution chart
    const saldoCanvas = $('chart-saldo-evol');
    if (saldoCanvas) {
      _destroyChart('saldo-evol');
      const saldoData = allMonths.map(m => {
        const ing = ingresos.filter(i => !i.esTransferencia && (i.ymBase || (i.key||'').slice(0,7)) === m)
          .reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
        const gas = gastosDelMes(m).filter(x => (x.moneda||'ARS')==='ARS').reduce((s, x) => s + x.monto, 0);
        const aho = ahorros.filter(a => (a.ymBase || (a.key||'').slice(0,7)) === m).reduce((s, a) => s + a.monto, 0);
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
                callback: v => '$' + fmt(Math.round(v))
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
              callback: v => '$' + fmt(Math.round(v))
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
  const safeC = panelId.replace(/^(ajuste-|mover-|cambio-|vender-|usd-)/, '');
  ['ajuste-' + safeC, 'mover-' + safeC, 'cambio-' + safeC, 'vender-' + safeC, 'usd-' + safeC].forEach(id => {
    const p = document.getElementById(id);
    if (p) p.style.display = 'none';
  });
  if (!isOpen) panel.style.display = 'flex';
}

// Suma lo que cae en la tarjeta de crédito exactamente en el mes `ym`:
// - Gastos normales con fecha efectiva en ese mes
// - La cuota que vence en ese mes (una por gasto en cuotas)
function calcularTotalTarjetaMes(nombreTarjeta, ym) {
  let total = 0;
  gastos.forEach(g => {
    if (g.esTransferencia) return;
    if ((g.moneda || 'ARS') !== 'ARS') return;
    if ((g.medio || '') !== nombreTarjeta) return;
    if (!g.cuota) {
      // Gasto normal: si tiene offsetCuotas, impacta recién en el mes destino
      // (consistente con gastosDelMes: no se descuenta el mes de la compra).
      const off = g.offsetCuotas || 0;
      if (!off) {
        if (g.fecha.slice(0, 7) === ym) total += g.monto;
      } else {
        const [fy, fm] = g.fecha.split('-').map(Number);
        let cy = fy, cm = fm + off;
        while (cm > 12) { cm -= 12; cy++; }
        if (`${cy}-${String(cm).padStart(2, '0')}` === ym) total += g.monto;
      }
    } else {
      // Cuotas: solo la que cae exactamente en `ym`
      const [fy, fm] = g.fecha.split('-').map(Number);
      const off = g.offsetCuotas || 0;
      for (let n = 0; n < g.ncuotas; n++) {
        let cy = fy, cm = fm + off + n;
        while (cm > 12) { cm -= 12; cy++; }
        if (`${cy}-${String(cm).padStart(2, '0')}` === ym) {
          total += g.montoXcuota;
          break;
        }
      }
    }
  });
  return total;
}

// Mes (YYYY-MM) en que un gasto impacta efectivamente la cuenta (considera el offset de cuotas).
function _mesEfectivoGasto(g) {
  if (g.offsetCuotas) {
    const [fy, fm] = (g.fecha || '').split('-').map(Number);
    let cm = fm + g.offsetCuotas, cy = fy;
    while (cm > 12) { cm -= 12; cy++; }
    return `${cy}-${String(cm).padStart(2, '0')}`;
  }
  return (g.fecha || '').slice(0, 7);
}

// Calcula el saldo ARS total de todas las cuentas (Efectivo + billeteras + débito).
// Misma lógica que renderSaldoCuentas. Usado por el dashboard en "Dinero disponible".
function _buildCuentasYSaldos() {
  const cuentas = ['Efectivo'];
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => cuentas.push(t.label || t.banco || t.nombre));
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
    let lbl = t.label || ('CA ' + t.banco);
    if (lbl.startsWith('Débito ')) lbl = 'CA ' + lbl.slice(7);
    cuentas.push(lbl);
  });

  const normalizarDestino = (dest) => {
    if (!dest) return '';
    if (cuentas.includes(dest)) return dest;
    if (dest.startsWith('Débito ')) {
      const alt = 'CA ' + dest.slice(7);
      if (cuentas.includes(alt)) return alt;
    }
    const match = cuentas.find(c => {
      const cn = c.toLowerCase().replace(/^ca |^débito /i, '');
      const dn = dest.toLowerCase().replace(/^ca |^débito /i, '');
      return cn === dn;
    });
    return match || dest;
  };

  const saldos = {};
  cuentas.forEach(c => { saldos[c] = { ars: saldosIniciales[c] || 0, usd: 0 }; });
  saldos['__sinasignar__'] = { ars: 0, usd: 0 };

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

  const mesActualStr = new Date().toISOString().slice(0, 7);
  gastos.forEach(g => {
    if (g.cuota) return;
    // Un gasto con mes efectivo futuro (recurrente agendado o gasto con offset) aún no impacta el saldo
    if (_mesEfectivoGasto(g) > mesActualStr) return;
    const medio = normalizarDestino(g.medio || '');
    if (medio && saldos[medio] !== undefined) saldos[medio].ars -= g.monto;
  });

  (ajustesCuentas || []).forEach(a => {
    const cuenta = normalizarDestino(a.cuenta);
    if (saldos[cuenta] !== undefined) saldos[cuenta].ars += a.monto;
  });

  ahorros.forEach(a => {
    if ((a.origen || '') === '__ya_lo_tenia__') return;
    const orig = normalizarDestino(a.origen || '');
    if (orig && saldos[orig] !== undefined) {
      const base = a.monto - (a.rendimientos || 0);
      if ((a.moneda || 'ARS') === 'ARS') saldos[orig].ars -= base;
      else saldos[orig].usd -= base;
    }
  });

  tarjetas.filter(t => (t.tipo || 'credito') === 'credito').forEach(t => {
    const nombreTarjeta = t.label || t.nombre || t.banco;
    const caDebito = tarjetas.find(d => d.tipo === 'debito' && d.banco === t.banco);
    if (!caDebito) return;
    let caLabel = caDebito.label || ('CA ' + caDebito.banco);
    if (caLabel.startsWith('Débito ')) caLabel = 'CA ' + caLabel.slice(7);
    const caKey = normalizarDestino(caLabel);
    if (saldos[caKey] === undefined) return;
    saldos[caKey].ars -= calcularTotalTarjetaMes(nombreTarjeta, mesActualStr);
  });

  return { cuentas, saldos, normalizarDestino };
}

function calcTotalSaldoARS() {
  const { saldos } = _buildCuentasYSaldos();
  return Object.entries(saldos)
    .filter(([k]) => k !== '__sinasignar__')
    .reduce((s, [, v]) => s + v.ars, 0);
}

function renderSaldoCuentas() {
  const el = $('saldo-cuentas-body');
  if (!el) return;

  const { cuentas, saldos, normalizarDestino } = _buildCuentasYSaldos();
  const mesActualStr = new Date().toISOString().slice(0, 7);

  const mediosReales = new Set(cuentas);

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
      if (i.sueldo > 0 && normalizarDestino(i.sueldoDestino||'') === c) ingC.push({ fecha: i.ymBase||(i.key||'').slice(0,7), desc: 'Sueldo', monto: i.sueldo, moneda: i.sueldoMoneda||'ARS' });
      (i.otros||[]).forEach(o => { if (normalizarDestino(o.destino||'') === c) ingC.push({ fecha: i.ymBase||(i.key||'').slice(0,7), desc: o.concepto||o.nombre||'Ingreso', monto: o.monto, moneda: o.moneda||'ARS' }); });
    });
    const gasCAll = gastos.filter(g => normalizarDestino(g.medio||'') === c);
    const gasCNoCuota = gasCAll.filter(g => !g.cuota);
    const gasC    = gasCNoCuota.filter(g => _mesEfectivoGasto(g) <= mesActualStr); // ya impactaron el saldo
    const gasCFut = gasCNoCuota.filter(g => _mesEfectivoGasto(g) >  mesActualStr); // agendados (mes futuro)
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
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;width:100%;margin-top:8px">
          <button onclick="toggleCuentaPanel('ajuste-${safeC}')" style="background:rgba(245,184,46,0.1);border:1px solid rgba(245,184,46,0.4);color:var(--accent3);border-radius:10px;padding:10px 8px;font-size:0.78rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:44px;touch-action:manipulation">✏ Corregir saldo</button>
          <button onclick="toggleCuentaPanel('mover-${safeC}')" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.4);color:var(--accent4);border-radius:10px;padding:10px 8px;font-size:0.78rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:44px;touch-action:manipulation">↔ Mover entre cuentas</button>
          <button onclick="toggleCuentaPanel('usd-${safeC}')" style="background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.4);color:var(--accent3);border-radius:10px;padding:10px 8px;font-size:0.78rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:44px;grid-column:span 2;touch-action:manipulation">💱 Compra/Venta USD</button>
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
        ${gasCFut.length ? `
        <div style="background:rgba(255,255,255,0.02);border:1px dashed var(--border);border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:9px 12px;background:rgba(255,255,255,0.02);border-bottom:1px solid var(--border)">
            <span style="font-weight:600;color:var(--text3)">🕒 Agendados <span style="font-size:0.7rem;color:var(--text3);font-weight:400">${gasCFut.length} · todavía no impactan</span></span>
            <span style="font-family:monospace;font-weight:700;color:var(--text3)">− $${fmt(gasCFut.reduce((s,g)=>s+g.monto,0))}</span>
          </div>
          ${gasCFut.sort((a,b)=>_mesEfectivoGasto(a).localeCompare(_mesEfectivoGasto(b))).map(g=>{
            const me = _mesEfectivoGasto(g);
            const mesLbl = MESES[parseInt(me.slice(5,7))-1] + ' ' + me.slice(0,4);
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 12px 6px 20px;border-bottom:1px solid rgba(255,255,255,0.04);opacity:0.6">
            <div style="min-width:0;flex:1;margin-right:8px">
              <div style="color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(g.desc||g.cat)}</div>
              <div style="font-size:0.68rem;color:var(--text3)">📅 ${mesLbl} · ${escHtml(g.cat||'')}</div>
            </div>
            <span style="font-family:monospace;color:var(--text3);font-size:0.77rem;flex-shrink:0">− $${fmt(g.monto)}</span>
          </div>`;}).join('')}
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
            <span style="color:var(--text3)">${a.ymBase||(a.key||'').slice(0,7)} · ${a.concepto||a.tipo||'Ahorro'}</span>
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
            <button class="btn-del" onclick="eliminarAjuste(${a.id})">✕</button>
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
      <!-- Panel USD (selector compra/venta) -->
      <div id="usd-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;background:rgba(45,212,191,0.06);border:1px solid rgba(45,212,191,0.2);border-radius:12px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent3);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">¿Qué querés hacer con USD?</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button onclick="toggleCuentaPanel('usd-${safeC}');toggleCuentaPanel('cambio-${safeC}')" style="background:rgba(45,212,191,0.1);border:1px solid rgba(45,212,191,0.4);color:var(--accent3);border-radius:10px;padding:12px 8px;font-size:0.82rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:48px;touch-action:manipulation">💱 Comprar USD</button>
          <button onclick="toggleCuentaPanel('usd-${safeC}');toggleCuentaPanel('vender-${safeC}')" style="background:rgba(255,184,0,0.1);border:1px solid rgba(255,184,0,0.4);color:var(--accent3);border-radius:10px;padding:12px 8px;font-size:0.82rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600;min-height:48px;touch-action:manipulation">💵 Vender USD</button>
        </div>
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
      <!-- Panel Vender USD -->
      <div id="vender-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;background:rgba(255,184,0,0.06);border:1px solid rgba(255,184,0,0.2);border-radius:12px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent3);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Vender USD desde ${c}</div>
        <input id="vender-usd-${safeC}" type="number" placeholder="Monto en u$s a vender" min="0" step="0.01" oninput="actualizarCotizacionVenta('${safeC}')"
          style="background:var(--bg);border:1px solid var(--accent3);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
        <input id="vender-ars-${safeC}" type="number" placeholder="Monto en pesos recibido ($)" min="0" step="0.01" oninput="actualizarCotizacionVenta('${safeC}')"
          style="background:var(--bg);border:1px solid var(--accent3);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
        <div id="vender-cotiz-${safeC}" style="font-size:0.72rem;color:var(--text3)">Cotización: —</div>
        <select id="vender-destino-${safeC}"
          style="background:var(--bg);border:1px solid var(--accent3);border-radius:10px;color:var(--text);font-family:'Sora',sans-serif;font-size:16px;padding:12px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
          <option value="">→ ¿A qué cuenta van los pesos?</option>
          ${opcionesDestino(c)}
        </select>
        <button onclick="venderUSD('${c}', '${safeC}')"
          style="background:var(--accent3);border:none;color:#0d0f14;border-radius:10px;padding:14px;font-size:0.9rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700;min-height:48px;width:100%;touch-action:manipulation">💵 Confirmar venta</button>
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

function renderAjustesHistorial() {
  const el = $('ajustes-historial-body');
  if (!el) return;
  if (!ajustesCuentas || !ajustesCuentas.length) {
    el.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:0.85rem">Sin ajustes registrados.</div>';
    return;
  }
  const sorted = [...ajustesCuentas].sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));
  el.innerHTML = sorted.map(a => {
    const signo = a.monto >= 0 ? '+' : '';
    const color = a.monto >= 0 ? 'var(--accent3)' : 'var(--accent2)';
    return `<div class="oi-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border);gap:8px">
      <div style="flex:1;min-width:0">
        <div style="font-size:0.88rem;color:var(--text1);font-weight:600">${escHtml(a.cuenta || '')}</div>
        <div style="font-size:0.75rem;color:var(--text3)">${a.fecha || ''} ${a.notas ? '· ' + escHtml(a.notas) : ''}</div>
      </div>
      <div style="font-family:'DM Mono',monospace;font-size:0.9rem;font-weight:700;color:${color};flex-shrink:0">${signo}$${fmt(Math.abs(a.monto))}</div>
      <button class="btn-del" style="padding:4px 10px;font-size:0.75rem;min-height:28px;flex-shrink:0" onclick="eliminarAjuste(${a.id})">✕</button>
    </div>`;
  }).join('');
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
  // Entrada al destino
  const ymKeyT = hoy.slice(0,7);
  ingresos.push({
    id: Date.now()+1, key: `${ymKeyT}_tr${Date.now()}`, ymBase: ymKeyT,
    fecha: hoy, sueldo: 0, sueldoMoneda: 'ARS',
    otros: [{ id: Date.now()+2, nombre: `Transferencia desde ${origen}`, monto, moneda: 'ARS', destino, fecha: hoy }],
    totalARS: monto, total: monto, extra: 0, esTransferencia: true
  });
  save();
  notify(`✓ Movido $${fmt(monto)} de ${origen} → ${destino}`);
  input.value = '';
  destSel.value = '';
  renderSaldoCuentas();
}

function actualizarCotizacion(safeC) {
  const ars = parseFloat(document.getElementById('cambio-ars-'+safeC)?.value) || 0;
  const usd = parseFloat(document.getElementById('cambio-usd-'+safeC)?.value) || 0;
  const el = document.getElementById('cambio-cotiz-'+safeC);
  if (!el) return;
  el.textContent = (ars > 0 && usd > 0) ? `Cotización: $${fmt(ars/usd)} / u$s` : 'Cotización: —';
}

function comprarUSD(origen, safeC) {
  const arsInput = document.getElementById('cambio-ars-'+safeC);
  const usdInput = document.getElementById('cambio-usd-'+safeC);
  const ars = parseFloat(arsInput?.value);
  const usd = parseFloat(usdInput?.value);
  if (!ars || ars <= 0) { notify('⚠ Ingresá el monto en pesos'); return; }
  if (!usd || usd <= 0) { notify('⚠ Ingresá el monto en dólares'); return; }
  const hoy = new Date().toISOString().slice(0,10);
  const cotiz = (ars/usd).toFixed(2);
  gastos.push({
    id: Date.now(), fecha: hoy, desc: `Compra USD u$s${fmt(usd)} @ $${cotiz}`,
    cat: 'Transferencia', medio: origen, monto: ars,
    cuota: false, ncuotas: 1, montoXcuota: ars, offsetCuotas: 0, esTransferencia: true
  });
  const ymKeyC = hoy.slice(0,7);
  ingresos.push({
    id: Date.now()+1, key: `${ymKeyC}_comprusd${Date.now()}`, ymBase: ymKeyC,
    fecha: hoy, sueldo: 0, sueldoMoneda: 'ARS',
    otros: [{ id: Date.now()+2, nombre: `Compra USD desde ${origen}`, monto: usd, moneda: 'USD', destino: origen, fecha: hoy }],
    totalARS: 0, total: 0, extra: 0, esTransferencia: true
  });
  save();
  notify(`✓ Compra: u$s${fmt(usd)} → ${origen} (@ $${cotiz})`);
  arsInput.value = ''; usdInput.value = '';
  document.getElementById('cambio-cotiz-'+safeC).textContent = 'Cotización: —';
  renderSaldoCuentas();
}

function actualizarCotizacionVenta(safeC) {
  const usd = parseFloat(document.getElementById('vender-usd-'+safeC)?.value) || 0;
  const ars = parseFloat(document.getElementById('vender-ars-'+safeC)?.value) || 0;
  const el = document.getElementById('vender-cotiz-'+safeC);
  if (!el) return;
  el.textContent = (ars > 0 && usd > 0) ? `Cotización: $${fmt(ars/usd)} / u$s` : 'Cotización: —';
}

function venderUSD(origen, safeC) {
  const usdInput = document.getElementById('vender-usd-'+safeC);
  const arsInput = document.getElementById('vender-ars-'+safeC);
  const destSel2 = document.getElementById('vender-destino-'+safeC);
  const usd = parseFloat(usdInput?.value);
  const ars = parseFloat(arsInput?.value);
  const destino = destSel2?.value;
  if (!usd || usd <= 0) { notify('⚠ Ingresá el monto en dólares'); return; }
  if (!ars || ars <= 0) { notify('⚠ Ingresá el monto en pesos recibido'); return; }
  if (!destino) { notify('⚠ Seleccioná la cuenta destino'); return; }
  const hoy = new Date().toISOString().slice(0,10);
  const cotiz = (ars/usd).toFixed(2);
  const ymKeyV = hoy.slice(0,7);
  // Deducir USD de origen (ingreso con monto negativo)
  ingresos.push({
    id: Date.now(), key: `${ymKeyV}_vendusd${Date.now()}`, ymBase: ymKeyV,
    fecha: hoy, sueldo: 0, sueldoMoneda: 'ARS',
    otros: [{ id: Date.now()+1, nombre: `Venta USD desde ${origen}`, monto: -usd, moneda: 'USD', destino: origen, fecha: hoy }],
    totalARS: 0, total: 0, extra: 0, esTransferencia: true
  });
  // Ingreso ARS al destino
  ingresos.push({
    id: Date.now()+2, key: `${ymKeyV}_ventaars${Date.now()}`, ymBase: ymKeyV,
    fecha: hoy, sueldo: 0, sueldoMoneda: 'ARS',
    otros: [{ id: Date.now()+3, nombre: `Venta USD → ARS`, monto: ars, moneda: 'ARS', destino, fecha: hoy }],
    totalARS: ars, total: ars, extra: 0, esTransferencia: true
  });
  save();
  notify(`✓ Vendido: u$s${fmt(usd)} → $${fmt(ars)} en ${destino} (@ $${cotiz})`);
  usdInput.value = ''; arsInput.value = '';
  document.getElementById('vender-cotiz-'+safeC).textContent = 'Cotización: —';
  destSel2.value = '';
  renderSaldoCuentas();
}

// ── CALENDARIO ────────────────────────────────────────────────────────────
let _calMes = new Date().getMonth();
let _calAño = new Date().getFullYear();
let _calDiaSeleccionado = null;

function renderCalendario() {
  const el = $('cal-container');
  if (!el) return;

  const año = _calAño, mes = _calMes;
  const ym  = `${año}-${String(mes+1).padStart(2,'0')}`;
  const hoy = new Date().toISOString().slice(0,10);

  // ── Construir mapa día → eventos ─────────────────────────────────────
  const eventos = {}; // { 'YYYY-MM-DD': [{tipo, label, monto, moneda}] }
  const addEv = (fecha, ev) => { if (!eventos[fecha]) eventos[fecha] = []; eventos[fecha].push(ev); };

  // Gastos normales (no cuota)
  gastos.forEach(g => {
    if (g.esTransferencia) return;
    if (!g.cuota) {
      const off = g.offsetCuotas || 0;
      if (!off) {
        if (g.fecha.slice(0,7) === ym)
          addEv(g.fecha, { tipo:'gasto', label: g.desc||g.concepto||'Gasto', monto: g.monto, moneda: g.moneda||'ARS' });
      } else {
        // Impacta el mes siguiente: se muestra el día 1, con referencia a la fecha real de compra
        const [fy,fm,fd] = g.fecha.split('-').map(Number);
        let cm = fm+off, cy = fy;
        while (cm>12){cm-=12;cy++;}
        const gastoYm = `${cy}-${String(cm).padStart(2,'0')}`;
        if (gastoYm === ym) {
          const dia1 = `${ym}-01`;
          const fechaOrig = `${String(fd).padStart(2,'0')}/${String(fm).padStart(2,'0')}`;
          addEv(dia1, { tipo:'gasto', label: `${g.desc||g.concepto||'Gasto'} (compra ${fechaOrig})`, monto: g.monto, moneda: g.moneda||'ARS' });
        }
      }
    } else {
      // Cuotas: mostrar en el 1° del mes donde cae cada cuota, con referencia a la fecha de compra
      const [fy,fm,fd] = g.fecha.split('-').map(Number);
      const off = g.offsetCuotas||0;
      const fechaOrig = `${String(fd).padStart(2,'0')}/${String(fm).padStart(2,'0')}`;
      for (let n=0; n<g.ncuotas; n++) {
        let cy=fy, cm=fm+off+n;
        while(cm>12){cm-=12;cy++;}
        const cuotaYm = `${cy}-${String(cm).padStart(2,'0')}`;
        if (cuotaYm===ym) {
          const dia1 = `${ym}-01`;
          addEv(dia1, { tipo:'cuota', label:`${g.desc||'Cuota'} (${n+1}/${g.ncuotas}) · compra ${fechaOrig}`, monto: g.montoXcuota, moneda: g.moneda||'ARS' });
        }
      }
    }
  });

  // Ingresos → día 1 del mes
  ingresos.forEach(i => {
    const iym = i.ymBase || i.key?.slice(0,7) || '';
    if (iym !== ym) return;
    const dia1 = `${ym}-01`;
    if (i.sueldo > 0) addEv(dia1, { tipo:'ingreso', label: i.sueldoConcepto||'Sueldo', monto: i.sueldo, moneda: i.sueldoMoneda||'ARS' });
    (i.otros||[]).forEach(o => addEv(dia1, { tipo:'ingreso', label: o.nombre||'Ingreso', monto: o.monto, moneda: o.moneda||'ARS' }));
  });

  // Recurrentes → día 1 del mes (si están activos este mes)
  recurrentes.forEach(r => {
    if (r.mesesActivos && r.mesesActivos[ym]) {
      // Buscar el gasto real para obtener fecha exacta
      const gastoId = String(r.mesesActivos[ym]);
      const g = gastos.find(x => String(x.id) === gastoId);
      const fecha = (g?.fecha?.slice(0,7)===ym) ? g.fecha : `${ym}-01`;
      addEv(fecha, { tipo:'recurrente', label: r.nombre||'Recurrente', monto: r.monto||0, moneda: r.moneda||'ARS' });
    }
  });

  // ── Construir grilla ─────────────────────────────────────────────────
  const primerDia = new Date(año, mes, 1).getDay(); // 0=dom
  const diasEnMes = new Date(año, mes+1, 0).getDate();
  const offset    = (primerDia+6)%7; // lunes=0

  const DIAS = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];
  const colores = { gasto:'var(--accent2)', cuota:'var(--accent3)', ingreso:'var(--accent)', recurrente:'var(--accent4)' };

  let html = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem">
    <button onclick="navCalendario(-1)" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 14px;font-size:1rem;cursor:pointer">←</button>
    <span style="font-weight:700;font-size:1rem;color:var(--text)">${MESES[mes]} ${año}</span>
    <button onclick="navCalendario(1)"  style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 14px;font-size:1rem;cursor:pointer">→</button>
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px">
    ${DIAS.map(d=>`<div style="text-align:center;font-size:0.65rem;color:var(--text3);font-weight:700;padding:4px 0">${d}</div>`).join('')}
  </div>
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:3px">`;

  // celdas vacías al inicio
  for (let i=0; i<offset; i++) html += `<div></div>`;

  for (let d=1; d<=diasEnMes; d++) {
    const fecha = `${ym}-${String(d).padStart(2,'0')}`;
    const evs   = eventos[fecha] || [];
    const esHoy = fecha === hoy;
    const selec = fecha === _calDiaSeleccionado;
    const tipos = [...new Set(evs.map(e=>e.tipo))];

    html += `<div onclick="selCalDia('${fecha}')" style="
      background:${selec?'rgba(0,229,160,0.12)':(esHoy?'rgba(0,229,160,0.06)':'var(--surface)')};
      border:1px solid ${selec?'var(--accent)':(esHoy?'rgba(0,229,160,0.4)':'var(--border)')};
      border-radius:8px;padding:5px 3px;min-height:52px;cursor:pointer;
      display:flex;flex-direction:column;align-items:center;gap:3px">
      <span style="font-size:0.72rem;font-weight:${esHoy?'700':'400'};color:${esHoy?'var(--accent)':'var(--text2)'}">${d}</span>
      <div style="display:flex;flex-wrap:wrap;gap:2px;justify-content:center">
        ${tipos.map(t=>`<span style="width:7px;height:7px;border-radius:50%;background:${colores[t]};display:inline-block"></span>`).join('')}
      </div>
    </div>`;
  }
  html += `</div>`;

  // Leyenda
  html += `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:10px;padding:8px 0">
    ${Object.entries(colores).map(([t,c])=>`
      <div style="display:flex;align-items:center;gap:5px;font-size:0.72rem;color:var(--text3)">
        <span style="width:8px;height:8px;border-radius:50%;background:${c};display:inline-block"></span>
        ${t.charAt(0).toUpperCase()+t.slice(1)}
      </div>`).join('')}
  </div>`;

  // Detalle día seleccionado
  if (_calDiaSeleccionado && eventos[_calDiaSeleccionado]?.length) {
    const [ay,am,ad] = _calDiaSeleccionado.split('-');
    html += `<div style="margin-top:12px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:12px">
      <div style="font-weight:700;font-size:0.82rem;color:var(--text2);margin-bottom:8px">${parseInt(ad)} de ${MESES[parseInt(am)-1]}</div>`;
    eventos[_calDiaSeleccionado].forEach(ev => {
      const color = colores[ev.tipo];
      const montoStr = ev.monto ? ` · ${ev.moneda==='USD'?'u$s':'$'}${fmt(ev.monto)}` : '';
      html += `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)">
        <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0"></span>
        <span style="font-size:0.82rem;color:var(--text)">${escHtml(ev.label)}</span>
        <span style="margin-left:auto;font-size:0.78rem;font-family:'DM Mono',monospace;color:${color}">${montoStr}</span>
      </div>`;
    });
    html += `</div>`;
  } else if (_calDiaSeleccionado) {
    html += `<div style="margin-top:10px;text-align:center;color:var(--text3);font-size:0.78rem;padding:12px">Sin eventos este día</div>`;
  }

  el.innerHTML = html;
}

function navCalendario(dir) {
  _calMes += dir;
  if (_calMes > 11) { _calMes = 0; _calAño++; }
  if (_calMes < 0)  { _calMes = 11; _calAño--; }
  _calDiaSeleccionado = null;
  renderCalendario();
}

function selCalDia(fecha) {
  _calDiaSeleccionado = _calDiaSeleccionado === fecha ? null : fecha;
  renderCalendario();
}

// ── CUOTAS DASHBOARD ──────────────────────────────────────────────────────────

function renderDashCuotas() {
  const el = $('dash-cuotas-body');
  if (!el) return;
  const hoy = new Date();
  const hy = hoy.getFullYear(), hm = hoy.getMonth() + 1;
  const todayYm = hy * 12 + (hm - 1);

  const activas = gastos.filter(g => {
    if (!g.cuota || g.esTransferencia) return false;
    const [fy, fm] = g.fecha.split('-').map(Number);
    const off = g.offsetCuotas || 0;
    let sy = fy, sm = fm + off;
    while (sm > 12) { sm -= 12; sy++; }
    const startYm = sy * 12 + (sm - 1);
    const endYm   = startYm + g.ncuotas - 1;
    return todayYm <= endYm;
  });

  if (!activas.length) {
    el.innerHTML = '<div style="text-align:center;padding:1.5rem;color:var(--text3);font-size:0.82rem">Sin cuotas activas</div>';
    return;
  }

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

function toggleDashCuotas() {
  const body = $('dash-cuotas-body');
  const icon = $('dash-cuotas-icon');
  if (!body) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  if (icon) icon.style.transform = isOpen ? '' : 'rotate(180deg)';
  if (!isOpen) renderDashCuotas();
}

// ── CARD PANELS ───────────────────────────────────────────────────────────────

function toggleCardPanel(panelId) {
  const panel = document.getElementById(panelId);
  const icon  = document.getElementById('icon-' + panelId);
  if (!panel) return;
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
  // Recolectar todas las filas
  const allRows = [];
  ingM.forEach(i => {
    if (i.sueldo > 0) allRows.push({ label: i.sueldoConcepto||'Sueldo', monto: i.sueldo, moneda: i.sueldoMoneda||'ARS', dest: i.sueldoDestino||'' });
    (i.otros||[]).forEach(o => allRows.push({ label: o.concepto||o.nombre||'Ingreso extra', monto: o.monto, moneda: o.moneda||'ARS', dest: o.destino||'' }));
  });
  // Agrupar por concepto + moneda + destino
  const grouped = [];
  const groupMap = new Map();
  allRows.forEach(r => {
    const key = `${r.label}||${r.moneda}||${r.dest}`;
    if (groupMap.has(key)) { grouped[groupMap.get(key)].monto += r.monto; }
    else { groupMap.set(key, grouped.length); grouped.push({...r}); }
  });
  el.innerHTML = grouped.map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
    <div>
      <div style="font-size:0.82rem;color:var(--text2);font-weight:600">${r.label}</div>
      ${r.dest ? `<div style="font-size:0.68rem;color:var(--text3)">→ ${r.dest}</div>` : ''}
    </div>
    <span style="font-family:monospace;font-weight:700;color:var(--accent);font-size:0.88rem">${r.moneda==='USD'?'u$s':'$'}${fmt(r.monto)}</span>
  </div>`).join('') +
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

  const totalIngresosMes = ingresos.filter(i => (i.ymBase || i.key?.slice(0,7)) === ym).reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalGastosMes   = gastosDelMes(ym).reduce((s, x) => s + x.monto, 0);
  const totalAhorroMes   = ahorros.filter(a => (a.ymBase || a.key?.slice(0,7)) === ym && (a.moneda||'ARS')==='ARS').reduce((s, a) => s + a.monto, 0);
  const ajustesMes       = (ajustesCuentas || []).filter(a => a.fecha?.slice(0,7) === ym).reduce((s, a) => s + (a.monto || 0), 0);
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
        <span style="font-size:0.85rem;color:var(--text3)">Disponible total</span>
        <span style="font-family:'DM Mono',monospace;font-weight:700;font-size:1.05rem;color:${calcTotalSaldoARS()>=0?'var(--accent)':'var(--accent2)'}">
          ${calcTotalSaldoARS()>=0?'+':''} $${fmt(Math.abs(calcTotalSaldoARS()))}
        </span>
      </div>
      ${calcTotalSaldoARS() < 0 ? `<div style="margin-top:6px;font-size:0.72rem;color:var(--accent2);text-align:right">Saldo negativo</div>` : ''}
    </div>`;
}

function _renderSaldoUSDPanel(ym) {
  const fmt2 = v => (v < 0 ? '−' : '+') + ' u$s ' + fmt(Math.abs(v));
  const el = $('panel-saldo-usd-body');
  const card = $('card-saldo-usd');
  if (!el || !card) return;

  const ingresosMes = ingresos.filter(i => (i.ymBase || i.key?.slice(0,7)) === ym);
  const totalIngresosUSD = ingresosMes.reduce((s, i) => {
    let usd = 0;
    if (i.sueldoMoneda === 'USD') usd += i.sueldo || 0;
    (i.otros || []).forEach(o => { if (o.moneda === 'USD') usd += o.monto || 0; });
    return s + usd;
  }, 0);
  const totalAhorroUSD = ahorros.filter(a => (a.ymBase || a.key?.slice(0,7)) === ym && a.moneda === 'USD').reduce((s, a) => s + a.monto, 0);
  const totalGastoUSD  = gastosDelMes(ym).filter(x => x.moneda === 'USD').reduce((s, x) => s + x.monto, 0);
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
    ...(totalGastoUSD  ? [{ label: '💸 Gastos del mes',  val: -totalGastoUSD,  color: 'var(--accent2)' }] : []),
    ...(totalAhorroUSD ? [{ label: '🏦 Ahorro del mes',  val: -totalAhorroUSD, color: 'var(--accent4)' }] : []),
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

// ── ADMIN / AJUSTES ───────────────────────────────────────────────────────────

function borrarTodosLosAjustes() {
  ajustesCuentas = [];
  save();
  renderSaldoCuentas();
  renderDashboard();
}

function iniciarEdicionAjuste(id) {
  notify('Edición de ajustes próximamente');
}

function cancelarEdicionAjuste() {}

function guardarEdicionAjuste(id) {}

async function renderAdminPanel() {
  const listEl   = document.getElementById('admin-email-list');
  const countEl  = document.getElementById('admin-count');
  if (!listEl) return;
  listEl.innerHTML = '<div style="padding:12px;color:var(--text3);font-size:0.85rem">Cargando...</div>';
  try {
    const ref  = window._fbDoc(window._fbDb, 'config', 'habilitados');
    const snap = await window._fbGetDoc(ref);
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    if (countEl) countEl.textContent = lista.length;
    if (lista.length === 0) {
      listEl.innerHTML = '<div style="padding:16px;color:var(--text3);font-size:0.85rem">No hay emails habilitados todavía.</div>';
      return;
    }
    listEl.innerHTML = lista.map(email => `
      <div class="oi-row" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--border)">
        <span style="font-size:0.9rem;color:var(--text)">${email}</span>
        <button class="btn-del" style="padding:6px 12px;font-size:0.8rem" onclick="removeEmailHabilitado('${email}')">✕ Quitar</button>
      </div>`).join('');
  } catch(e) {
    listEl.innerHTML = '<div style="padding:12px;color:var(--accent2);font-size:0.85rem">Error al cargar: ' + e.message + '</div>';
  }
}

function addEmailHabilitado() {
  const input = document.getElementById('admin-email-input');
  if (!input) return;
  const email = (input.value || '').trim().toLowerCase();
  if (!email) { notify('⚠ Ingresá un email'); return; }
  const ref = window._fbDoc(window._fbDb, 'config', 'habilitados');
  window._fbGetDoc(ref).then(snap => {
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    if (lista.includes(email)) { notify('Ya está habilitado'); return; }
    lista.push(email);
    window._fbSetDoc(ref, { emails: lista }).then(() => {
      notify('✓ Email habilitado');
      input.value = '';
      renderAdminPanel();
    }).catch(e => notify('Error: ' + e.message));
  });
}

function removeEmailHabilitado(email) {
  if (!confirm('¿Deshabilitar ' + email + '?')) return;
  const ref = window._fbDoc(window._fbDb, 'config', 'habilitados');
  window._fbGetDoc(ref).then(snap => {
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    const nueva = lista.filter(e => e !== email);
    window._fbSetDoc(ref, { emails: nueva }).then(() => { notify('✓ Email eliminado'); renderAdminPanel(); });
  });
}

function borrarDatosUsuario() {
  const emailInput = document.getElementById('admin-borrar-email');
  const resultEl   = document.getElementById('admin-borrar-result');
  const emailTarget = (emailInput?.value || '').trim().toLowerCase();
  if (!emailTarget) { notify('⚠ Ingresá el email del usuario'); return; }
  if (!confirm('¿Borrar TODOS los datos de ' + emailTarget + '? Esta acción no se puede deshacer.')) return;
  if (resultEl) resultEl.textContent = 'Buscando usuario...';
  window._fbGetDocs(window._fbCollection(window._fbDb, 'usuarios')).then(snap => {
    const userDoc = snap.docs.find(d => d.data().email === emailTarget);
    if (!userDoc) { if (resultEl) resultEl.textContent = '⚠ Usuario no encontrado'; return; }
    window._fbSetDoc(userDoc.ref, {
      gastos:[], ingresos:[], ahorros:[], saldosIniciales:{}, tarjetas:[],
      pendientes:[], conceptosGuardados:[], ajustesCuentas:[], presupuestos:{},
      presupuestosExplicitos:{}, metasAhorro:{}, recurrentes:[],
      email: emailTarget, updatedAt: new Date().toISOString()
    }).then(() => {
      if (resultEl) resultEl.textContent = '✓ Datos borrados para ' + emailTarget;
      notify('✓ Datos borrados');
    }).catch(e => { if (resultEl) resultEl.textContent = 'Error: ' + e.message; });
  });
}

function verFirestoreRaw() {
  const el = document.getElementById('diag-raw');
  if (!el) return;
  const uid = window._currentUser?.uid;
  if (!uid) { notify('Sin sesión'); return; }
  el.style.display = 'block';
  el.textContent = 'Cargando...';
  window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid)).then(snap => {
    if (!snap.exists()) { el.textContent = 'Sin datos'; return; }
    el.textContent = JSON.stringify(snap.data(), null, 2);
  }).catch(e => { el.textContent = 'Error: ' + e.message; });
}

function limpiarAjustesViejos() {
  const hace6Meses = new Date();
  hace6Meses.setMonth(hace6Meses.getMonth() - 6);
  const corte = hace6Meses.toISOString().slice(0,10);
  const antes = ajustesCuentas.length;
  ajustesCuentas = ajustesCuentas.filter(a => a.fecha >= corte);
  const eliminados = antes - ajustesCuentas.length;
  save();
  renderSaldoCuentas();
  notify(`✓ Eliminados ${eliminados} ajustes viejos`);
}

function recuperarPendientes() {
  try {
    const local = JSON.parse(localStorage.getItem('gf_pendientes') || '[]');
    if (!local.length) { notify('No hay memos en localStorage'); return; }
    const ids = new Set(pendientes.map(p => String(p.id)));
    const nuevos = local.filter(p => !ids.has(String(p.id)));
    pendientes = [...pendientes, ...nuevos];
    save();
    notify(`✓ Recuperados ${nuevos.length} memos`);
  } catch(e) { notify('Error: ' + e.message); }
}

// ── WINDOW EXPORTS ────────────────────────────────────────────────────────────

window.toggleMetaForm         = toggleMetaForm;
window.guardarMeta            = guardarMeta;
window.deleteMeta             = deleteMeta;
window.agregarRendimiento     = agregarRendimiento;
window.agregarRendimientoFondo = agregarRendimientoFondo;
window.rescatarFondo          = rescatarFondo;
window.cerrarRescate          = cerrarRescate;
window.confirmarRescate       = confirmarRescate;
window.transferirFondo        = transferirFondo;
window.onTransferDestinoChange = onTransferDestinoChange;
window.cerrarTransferencia    = cerrarTransferencia;
window.confirmarTransferencia = confirmarTransferencia;
window.eliminarFondo          = eliminarFondo;
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
window.renderAjustesHistorial = renderAjustesHistorial;
window.eliminarAjuste         = eliminarAjuste;
window.moverEntreCuentas      = moverEntreCuentas;
window.actualizarCotizacion   = actualizarCotizacion;
window.comprarUSD             = comprarUSD;
window.actualizarCotizacionVenta = actualizarCotizacionVenta;
window.venderUSD              = venderUSD;
window.navCalendario          = navCalendario;
window.selCalDia              = selCalDia;
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
window.abrirRecMesModal       = abrirRecMesModal;
window.cerrarRecMesModal      = cerrarRecMesModal;
window.guardarRecMesModal     = guardarRecMesModal;
window.eliminarRecurrente     = eliminarRecurrente;

window.addIngreso             = addIngreso;
window.editarOtroIngreso      = editarOtroIngreso;
window.closeEditIngresoModal  = closeEditIngresoModal;
window.saveEditIngresoModal   = saveEditIngresoModal;
window.eliminarOtroIngreso    = eliminarOtroIngreso;
window.editarSueldoIngreso    = editarSueldoIngreso;
window.eliminarSueldoIngreso  = eliminarSueldoIngreso;

window.deleteTarjeta          = deleteTarjeta;

window.renderAdminPanel       = renderAdminPanel;
window.addEmailHabilitado     = addEmailHabilitado;
window.removeEmailHabilitado  = removeEmailHabilitado;
window.borrarDatosUsuario     = borrarDatosUsuario;
window.verFirestoreRaw        = verFirestoreRaw;
window.limpiarAjustesViejos   = limpiarAjustesViejos;
window.recuperarPendientes    = recuperarPendientes;

window.seleccionarConcepto    = seleccionarConcepto;
window.toggleConceptoOtro     = toggleConceptoOtro;
window.filtrarConceptos       = filtrarConceptos;
window.deleteConceptoIngreso  = deleteConceptoIngreso;
window.seleccionarConceptoOtro = seleccionarConceptoOtro;
window.calcularTotalTarjetaMes = calcularTotalTarjetaMes;
