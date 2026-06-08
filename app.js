// ---- HELPERS ----
const $ = id => document.getElementById(id);
const fmt = n => (n ?? 0).toLocaleString('es-AR');

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

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
let selectedDashMonth = new Date().toISOString().slice(0,7);

async function save() {
  const uid = window._currentUser?.uid;
  if (!uid) return;
  try {
    await window._fbSetDoc(window._fbDoc(window._fbDb, 'usuarios', uid), {
      gastos, ingresos, ahorros, saldosIniciales, tarjetas, pendientes, conceptosGuardados, ajustesCuentas, updatedAt: new Date().toISOString()
    });
  } catch(e) { console.error('Error guardando:', e); }
}

window.loadUserData = async function(uid) {
  // Resetear todo antes de cargar para evitar datos de sesiones anteriores
  gastos = []; ingresos = []; ahorros = []; saldosIniciales = {}; pendientes = [];
  conceptosGuardados = []; otrosPendientes = []; ajustesCuentas = [];
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    if (snap.exists()) {
      const d = snap.data();
      gastos          = d.gastos          || [];
      ingresos        = d.ingresos        || [];
      ahorros         = d.ahorros         || [];
      saldosIniciales = d.saldosIniciales  || {};
      if (Array.isArray(d.conceptosGuardados)) conceptosGuardados = d.conceptosGuardados;
      if (Array.isArray(d.ajustesCuentas)) ajustesCuentas = d.ajustesCuentas;
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
};

// ---- UI ----
function showTab(tab) {
  document.querySelectorAll('section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  const btn = document.querySelector(`nav button[onclick="showTab('${tab}')"]`);
  if (btn) btn.classList.add('active');
  if (tab === 'dashboard') renderDashboard();
  if (tab === 'gastos') { renderGastosTable(); populateFilters(); }
  if (tab === 'ingresos') { renderIngresosTable(); renderDestinosIngreso(); renderSaldoCuentas(); renderConceptosSelect(); }
  if (tab === 'ahorro') { renderAhorroTable(); renderOrigenAhorro(); }
  if (tab === 'pendientes') renderPendientesTab();
  if (tab === 'admin') renderAdminPanel();
  if (tab === 'ajustes') { renderTarjetas(); renderSaldoInicial(); }
  if (tab === 'gastos') renderMedioPago();
}

function notify(msg) {
  const el = $('notif');
  $('notif-msg').textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

function toggleCuotas() {
  const on = $('g-cuota').checked;
  $('g-ncuotas-wrap').style.display = on ? 'flex' : 'none';
  if (on) {
    const medio = $('g-medio').value;
    const fecha = $('g-fecha').value; // YYYY-MM-DD
    const mesGasto = fecha ? fecha.slice(0, 7) : null;
    const mesActual = new Date().toISOString().slice(0, 7);
    const esGastoPasado = mesGasto && mesGasto < mesActual;
    const esCreditoConCierre = tarjetas.some(t =>
      (t.tipo || 'credito') === 'credito' && t.cierre && medio === (t.label || t.nombre)
    );
    // Ocultar la pregunta si: el gasto es de un mes pasado (ya sabemos el offset),
    // o si es tarjeta con cierre (se calcula automático)
    $('g-cerro-wrap').style.display =
      (esGastoPasado || esCreditoConCierre) ? 'none' : 'flex';
  } else {
    $('g-cerro-wrap').style.display = 'none';
  }
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
  const isNueva = sel.value === '__nueva__' || sel.value === 'Otros' || sel.value === 'Otro';
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
  const monto = parseFloat($('g-monto').value);
  const cuota = $('g-cuota').checked;
  const ncuotas = parseInt($('g-ncuotas').value) || 1;
  // Calcular offset: cuántos meses entre la fecha del gasto y la 1ª cuota
  let offsetCuotas = 0;
  if (cuota) {
    const mesGasto  = fecha.slice(0, 7); // YYYY-MM
    const mesActual = new Date().toISOString().slice(0, 7);
    const esGastoPasado = mesGasto < mesActual;
    const tarjetaUsada = tarjetas.find(t =>
      (t.tipo || 'credito') === 'credito' && medio === (t.label || t.nombre)
    );
    if (esGastoPasado) {
      // Gasto anterior: la 1ª cuota cayó en el mes siguiente al del gasto
      // (comportamiento estándar de tarjeta de crédito)
      offsetCuotas = 1;
    } else if (tarjetaUsada && tarjetaUsada.cierre) {
      // Gasto de este mes con tarjeta con fecha de cierre
      const diaGasto = parseInt(fecha.slice(8, 10));
      const [fy, fm] = fecha.split('-').map(Number);
      const diasEnMes = new Date(fy, fm, 0).getDate(); // último día del mes del gasto
      const cierreEfectivo = Math.min(tarjetaUsada.cierre, diasEnMes);
      // Si el cierre cae en el último día del mes (ej: cierre=31 en junio de 30 días),
      // todos los gastos del mes van al mes siguiente porque el ciclo siempre cierra a fin de mes
      if (cierreEfectivo >= diasEnMes) {
        offsetCuotas = 1;
      } else {
        offsetCuotas = diaGasto > cierreEfectivo ? 1 : 0;
      }
    } else {
      // Gasto de este mes sin tarjeta con cierre → preguntar
      const yacerro = document.querySelector('input[name="g-cuota-inicio"]:checked')?.value !== 'proximo';
      offsetCuotas = yacerro ? 0 : 1;
    }
  }
  const notas = $('g-notas').value.trim();

  if (!fecha || !desc || !cat || !monto || monto <= 0) {
    notify('⚠ Completá fecha, descripción, categoría y monto');
    return;
  }

  const mes = MESES[parseInt(fecha.slice(5,7)) - 1];
  const montoXcuota = cuota ? +(monto / ncuotas).toFixed(2) : monto;

  // Si la categoría es nueva, guardarla automáticamente
  autoSaveNewCat(cat, 'gastos');

  gastos.push({ id: Date.now(), fecha, desc, cat, medio, monto, cuota, ncuotas: cuota ? ncuotas : 1, montoXcuota, mes, notas, offsetCuotas });
  save();
  notify('Gasto agregado correctamente');

  // reset
  ['g-desc','g-notas','g-cat-otro'].forEach(id => document.getElementById(id).value = '');
  $('g-cat-otro').style.display = 'none';

  $('g-monto').value = '';
  $('g-cuota').checked = false;
  $('g-ncuotas').value = '';
  $('g-ncuotas-wrap').style.display = 'none';
  $('g-cerro').checked = true;
  $('g-cerro-wrap').style.display = 'none';
  document.querySelector('input[name="g-cuota-inicio"][value="este"]').checked = true;
  $('g-cat').value = '';
  $('g-medio').value = 'Efectivo';
  renderGastosTable();
  populateFilters();
}

function deleteGasto(id) {
  gastos = gastos.filter(g => g.id !== id);
  save();
  renderGastosTable();
  notify('Gasto eliminado');
}

function populateFilters() {
  const fMes = $('filter-mes');
  const fCat = $('filter-cat');
  const meses = [...new Set(gastos.map(g => g.fecha.slice(0,7)))].sort().reverse();
  const cats  = [...new Set(gastos.map(g => g.cat))].filter(Boolean);
  const prevMes = fMes.value, prevCat = fCat.value;
  fMes.innerHTML = '<option value="">Todos los meses</option>' + meses.map(m => `<option value="${m}">${MESES[parseInt(m.slice(5,7))-1]} ${m.slice(0,4)}</option>`).join('');
  fCat.innerHTML = '<option value="">Todas las categorías</option>' + cats.map(c => `<option value="${c}">${c}</option>`).join('');
  if (prevMes) fMes.value = prevMes;
  if (prevCat) fCat.value = prevCat;
}

// Construye el select de medio para la fila de edición
function buildMedioSelect(id, medioActual) {
  const opciones = ['Efectivo'];
  tarjetas.filter(t => (t.tipo||'credito') === 'credito').forEach(t => opciones.push(t.label || t.nombre));
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => opciones.push(t.label || ('CA ' + t.banco)));
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => opciones.push(t.label || t.banco || t.nombre));
  // Si el medio actual no está en la lista, agregarlo
  if (medioActual && !opciones.includes(medioActual)) opciones.push(medioActual);
  return '<select class="edit-input" id="eg-medio-' + id + '" style="width:100%">' +
    opciones.map(o => '<option value="' + o + '"' + (o === medioActual ? ' selected' : '') + '>' + o + '</option>').join('') +
    '</select>';
}

function toggleEditGasto(id) {
  const row = document.getElementById('edit-g-' + id);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

function saveEditGasto(id) {
  const idx = gastos.findIndex(g => g.id === id);
  if (idx < 0) return;
  const fecha = document.getElementById('eg-fecha-' + id).value || gastos[idx].fecha;
  const desc  = document.getElementById('eg-desc-' + id).value.trim() || gastos[idx].desc;
  const monto = parseFloat(document.getElementById('eg-monto-' + id).value) || gastos[idx].monto;
  const notas = document.getElementById('eg-notas-' + id).value.trim();
  const cuota = gastos[idx].cuota;
  const ncuotas = gastos[idx].ncuotas || 1;
  const montoXcuota = cuota ? +(monto / ncuotas).toFixed(2) : monto;
  const mes = MESES[parseInt(fecha.slice(5,7)) - 1];
  const medio = document.getElementById('eg-medio-' + id)?.value || gastos[idx].medio;
  gastos[idx] = { ...gastos[idx], fecha, desc, monto, montoXcuota, notas, mes, medio };
  save();
  notify('Gasto actualizado');
  renderGastosTable();
  populateFilters();
}

function renderGastosTable() {
  const fMes = $('filter-mes').value;
  const fCat = $('filter-cat').value;
  let list = [...gastos].reverse();
  if (fMes) list = list.filter(g => g.fecha.slice(0,7) === fMes);
  if (fCat) list = list.filter(g => g.cat === fCat);

  const el = $('gastos-table-body');
  if (!list.length) { el.innerHTML = '<div class="empty"><div class="icon">🪣</div>Sin gastos cargados aún</div>'; return; }

  el.innerHTML = `<table>
    <thead><tr>
      <th>Fecha</th><th>Descripción</th><th class="col-hide-mobile">Categoría</th>
      <th class="col-hide-mobile">Medio</th><th>Monto</th><th class="col-hide-mobile">Cuotas</th><th class="col-hide-mobile">Notas</th><th></th>
    </tr></thead>
    <tbody>
      ${list.map(g => `
        <tr>
          <td style="font-family:'DM Mono',monospace;font-size:0.78rem;color:var(--text2);white-space:nowrap">${g.fecha}</td>
          <td>${g.desc}</td>
          <td class="col-hide-mobile"><span class="badge badge-cat">${g.cat}</span></td>
          <td class="col-hide-mobile"><span class="badge badge-medio">${g.medio || '—'}</span></td>
          <td class="monto" style="white-space:nowrap">$${fmt(g.monto)}</td>
          <td class="col-hide-mobile">${g.cuota ? `<span class="badge badge-cuota">${g.ncuotas}x $${fmt(g.montoXcuota)}</span>` : '—'}</td>
          <td class="col-hide-mobile" style="color:var(--text3);font-size:0.78rem">${g.notas || '—'}</td>
          <td style="display:flex;gap:4px">
            <button class="btn-edit" onclick="toggleEditGasto(${g.id})">✏</button>
            <button class="btn-del" onclick="deleteGasto(${g.id})">✕</button>
          </td>
        </tr>
        <tr id="edit-g-${g.id}" class="edit-row" style="display:none">
          <td colspan="8" style="padding:12px 14px !important">
            <div class="edit-panel-header">${g.cat} · ${g.fecha}</div>
            <div class="edit-panel-body">
              <input class="edit-input" id="eg-fecha-${g.id}" type="date" value="${g.fecha}">
              <input class="edit-input" id="eg-desc-${g.id}" type="text" value="${g.desc}" placeholder="Descripción">
              ${buildMedioSelect(g.id, g.medio)}
              <input class="edit-input" id="eg-monto-${g.id}" type="number" value="${g.monto}" placeholder="Monto ($)">
              <input class="edit-input" id="eg-notas-${g.id}" type="text" value="${g.notas || ''}" placeholder="Notas (opcional)">
              <button class="btn-save edit-panel-save" onclick="saveEditGasto(${g.id})">✓ Guardar</button>
            </div>
          </td>
        </tr>`).join('')}
    </tbody>
  </table>`;
}

// ---- INGRESOS ----

function saveConceptos() {
  // conceptos se guardan junto con los datos en Firestore al llamar save()
}

function toggleOtrosForm() {
  const f = $('otros-form');
  f.style.display = f.style.display === 'none' ? 'block' : 'none';
  if (f.style.display === 'block') $('i-otro-nombre').focus();
}

function filtrarConceptos() {
  const val = $('i-otro-nombre').value.toLowerCase();
  const lista = $('conceptos-list');
  const filtrados = conceptosGuardados.filter(c => c.toLowerCase().includes(val));
  if (!filtrados.length) { lista.style.display = 'none'; return; }
  lista.style.display = 'block';
  lista.innerHTML = filtrados.map(c =>
    `<div onclick="seleccionarConcepto('${c.replace(/'/g,"&#39;")}')"
      style="padding:8px 12px;cursor:pointer;font-size:0.82rem;color:var(--text2)"
      onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''">${c}</div>`
  ).join('');
}

function seleccionarConcepto(nombre) {
  $('i-otro-nombre').value = nombre;
  $('conceptos-list').style.display = 'none';
  $('i-otro-monto').focus();
}

function agregarOtroIngreso() {
  const nombre = $('i-otro-nombre').value.trim();
  const moneda = $('i-otro-moneda').value;
  const monto  = parseFloat($('i-otro-monto').value);
  if (!nombre || !monto || monto <= 0) { notify('⚠ Completá concepto y monto'); return; }
  // Guardar concepto si es nuevo
  if (!conceptosGuardados.includes(nombre)) {
    conceptosGuardados.push(nombre);
    saveConceptos();
  }
  const otroDestino = resolverDestino('i-otro-destino');
  otrosPendientes.push({ id: Date.now(), nombre, moneda, monto, destino: otroDestino });
  $('i-otro-nombre').value = '';
  $('i-otro-monto').value = '';
  $('i-otro-moneda').value = 'ARS';
  $('i-otro-destino').value = '';
  renderOtrosPendientes();
  notify(`"${nombre}" agregado`);
}

function quitarOtroPendiente(id) {
  otrosPendientes = otrosPendientes.filter(o => o.id !== id);
  renderOtrosPendientes();
}

function renderOtrosPendientes() {
  const el = $('otros-pendientes');
  if (!otrosPendientes.length) { el.innerHTML = ''; return; }
  const fmtObj = o => o.moneda === 'USD' ? `u$s ${fmt(o.monto)}` : `$${fmt(o.monto)}`;
  el.innerHTML = `<div style="padding:0.8rem 1.4rem;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
    <span style="font-size:0.7rem;color:var(--text3);letter-spacing:0.8px;text-transform:uppercase;margin-right:4px">PENDIENTES DE GUARDAR:</span>
    ${otrosPendientes.map(o => `
      <span style="display:inline-flex;align-items:center;gap:6px;background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:4px 10px;font-size:0.78rem">
        <span style="color:var(--text2)">${o.nombre}</span>
        <span style="font-family:'DM Mono',monospace;color:${o.moneda==='USD'?'var(--accent3)':'var(--accent)'}">${fmtObj(o)}</span>
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
    gastos, ingresos, ahorros, saldosIniciales, tarjetas, pendientes, conceptosGuardados, ajustesCuentas, updatedAt: new Date().toISOString()
  }).catch(e => console.error('Error guardando saldos iniciales:', e));
}

function renderSaldoInicial() {
  const el = $('saldo-inicial-lista');
  if (!el) return;
  const cuentas = [
    { label: 'Efectivo', tipo: 'efectivo' },
    ...tarjetas.filter(t => t.tipo === 'billetera').map(t => ({ label: t.label || t.banco || t.nombre, tipo: 'billetera' })),
    ...tarjetas.filter(t => t.tipo === 'debito').map(t => ({ label: t.label || ('CA ' + t.banco), tipo: 'debito' })),
  ];
  if (!cuentas.length) {
    el.innerHTML = '<div class="empty" style="padding:0.5rem">Primero agrega tus medios de pago arriba.</div>';
    return;
  }
  // Construir con DOM para evitar problemas de escape en strings
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;flex-direction:column;gap:10px';
  cuentas.forEach(c => {
    const val = saldosIniciales[c.label] || 0;
    const icon = c.tipo === 'efectivo' ? '💵' : c.tipo === 'billetera' ? '📱' : '🏦';
    const safeId = 'si-' + c.label.replace(/[^a-zA-Z0-9]/g, '_');
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:12px;flex-wrap:wrap';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'min-width:180px;font-size:0.85rem;color:var(--text2)';
    lbl.textContent = icon + ' ' + c.label;
    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = 'display:flex;align-items:center;gap:6px';
    const prefix = document.createElement('span');
    prefix.style.cssText = 'font-size:0.82rem;color:var(--text3)';
    prefix.textContent = '$';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.01';
    input.placeholder = '0';
    input.id = safeId;
    input.className = 'edit-input';
    input.style.width = '140px';
    if (val > 0) input.value = val;
    input.addEventListener('change', function() { guardarSaldoInicial(c.label, this.value); });
    inputWrap.appendChild(prefix);
    inputWrap.appendChild(input);
    row.appendChild(lbl);
    row.appendChild(inputWrap);
    if (val > 0) {
      const badge = document.createElement('span');
      badge.style.cssText = 'font-size:0.75rem;color:var(--accent);font-family:monospace';
      badge.textContent = '$' + fmt(val);
      row.appendChild(badge);
    }
    wrap.appendChild(row);
  });
  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:0.75rem;color:var(--text3);margin-top:12px';
  hint.textContent = 'Los cambios se guardan automaticamente al salir del campo.';
  el.innerHTML = '';
  el.appendChild(wrap);
  el.appendChild(hint);
}

function guardarSaldoInicial(label, valor) {
  const monto = parseFloat(valor) || 0;
  if (monto > 0) {
    saldosIniciales[label] = monto;
  } else {
    delete saldosIniciales[label];
  }
  saveSaldosIniciales();
  renderSaldoInicial();
  notify('Saldo inicial guardado');
}

function saveTarjetas() {
  localStorage.setItem('gf_tarjetas', JSON.stringify(tarjetas));
  save(); // sincronizar con Firestore
}

// Renderiza los checkboxes de productos para el banco ingresado
function renderProductosBanco() {
  const banco = $('tc-banco').value.trim();
  const wrap  = $('tc-productos-wrap');
  if (!banco) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';

  $('tc-productos-lista').innerHTML = `
    <!-- Crédito Visa -->
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px 14px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.85rem;color:var(--text2);text-transform:none;letter-spacing:0;font-weight:600">
        <input type="checkbox" id="tc-ch-visa" onchange="toggleProducto('visa')"
          style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex-shrink:0">
        💳 Tarjeta de crédito Visa
      </label>
      <div id="tc-det-visa" style="display:none;margin-top:10px;display:none">
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <div class="form-group" style="min-width:100px;flex:1"><label>Cierre (día)</label><input class="edit-input" type="number" id="tc-cierre-visa" placeholder="ej: 15" min="1" max="31"></div>
          <div class="form-group" style="min-width:110px;flex:1"><label>Límite (opcional)</label><input class="edit-input" type="number" id="tc-limite-visa" placeholder="$0"></div>
        </div>
      </div>
    </div>
    <!-- Crédito Mastercard -->
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px 14px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.85rem;color:var(--text2);text-transform:none;letter-spacing:0;font-weight:600">
        <input type="checkbox" id="tc-ch-master" onchange="toggleProducto('master')"
          style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex-shrink:0">
        💳 Tarjeta de crédito Mastercard
      </label>
      <div id="tc-det-master" style="display:none">
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          <div class="form-group" style="min-width:100px;flex:1"><label>Cierre (día)</label><input class="edit-input" type="number" id="tc-cierre-master" placeholder="ej: 15" min="1" max="31"></div>
          <div class="form-group" style="min-width:110px;flex:1"><label>Límite (opcional)</label><input class="edit-input" type="number" id="tc-limite-master" placeholder="$0"></div>
        </div>
      </div>
    </div>
    <!-- Crédito American Express -->
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px 14px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.85rem;color:var(--text2);text-transform:none;letter-spacing:0;font-weight:600">
        <input type="checkbox" id="tc-ch-amex" onchange="toggleProducto('amex')"
          style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex-shrink:0">
        💳 Tarjeta de crédito American Express
      </label>
      <div id="tc-det-amex" style="display:none">
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
          <div class="form-group" style="min-width:100px;flex:1"><label>Cierre (día)</label><input class="edit-input" type="number" id="tc-cierre-amex" placeholder="ej: 15" min="1" max="31"></div>
          <div class="form-group" style="min-width:110px;flex:1"><label>Límite (opcional)</label><input class="edit-input" type="number" id="tc-limite-amex" placeholder="$0"></div>
        </div>
      </div>
    </div>
    <!-- Débito -->
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px 14px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.85rem;color:var(--text2);text-transform:none;letter-spacing:0;font-weight:600">
        <input type="checkbox" id="tc-ch-debito" onchange="toggleProducto('debito')"
          style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex-shrink:0">
        🏦 Caja de ahorro / Débito
      </label>
    </div>
    <!-- Billetera -->
    <div style="background:var(--surface2);border:1px solid var(--border);border-radius:14px;padding:12px 14px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:0.85rem;color:var(--text2);text-transform:none;letter-spacing:0;font-weight:600">
        <input type="checkbox" id="tc-ch-billetera"
          style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer;flex-shrink:0">
        📱 Billetera virtual / Cuenta
      </label>
    </div>
  `;
}

function toggleProducto(key) {
  const checked = document.getElementById('tc-ch-' + key).checked;
  const det = document.getElementById('tc-det-' + key);
  if (det) det.style.display = checked ? 'block' : 'none';
}

function agregarMedioPago() {
  const banco = $('tc-banco').value.trim();
  if (!banco) { notify('Ingresá el banco o institución'); return; }

  const productos = [
    { key: 'visa',     tipo: 'credito',   nombre: 'Visa' },
    { key: 'master',   tipo: 'credito',   nombre: 'Mastercard' },
    { key: 'amex',     tipo: 'credito',   nombre: 'American Express' },
    { key: 'debito',   tipo: 'debito',    nombre: '' },
    { key: 'billetera',tipo: 'billetera', nombre: '' },
  ];

  const seleccionados = productos.filter(p => document.getElementById('tc-ch-' + p.key)?.checked);
  if (!seleccionados.length) { notify('Seleccioná al menos un producto'); return; }

  // Validar cierres
  for (const p of seleccionados) {
    if (p.tipo === 'credito') {
      const cierre = parseInt(document.getElementById('tc-cierre-' + p.key)?.value) || 0;
      if (cierre && (cierre < 1 || cierre > 31)) { notify('Día de cierre inválido en ' + p.nombre); return; }
    }
  }

  let agregados = 0;
  seleccionados.forEach(p => {
    const cierre = parseInt(document.getElementById('tc-cierre-' + p.key)?.value) || 0;
    const limite = parseFloat(document.getElementById('tc-limite-' + p.key)?.value) || 0;

    let label = '';
    if (p.tipo === 'credito')   label = p.nombre + ' ' + banco;
    if (p.tipo === 'debito')    label = 'CA ' + banco;
    if (p.tipo === 'billetera') label = banco;

    // Evitar duplicados exactos
    const existe = tarjetas.some(t => t.label === label);
    if (!existe) {
      tarjetas.push({ id: Date.now() + agregados, tipo: p.tipo, banco, nombre: p.nombre, cierre, limite, label });
      agregados++;
    }
  });

  saveTarjetas();

  // Reset
  $('tc-banco').value = '';
  $('tc-productos-wrap').style.display = 'none';

  renderTarjetas();
  renderMedioPago();
  renderDestinosIngreso();
  renderOrigenAhorro();
  renderSaldoInicial();
  notify(agregados + ' medio' + (agregados !== 1 ? 's' : '') + ' agregado' + (agregados !== 1 ? 's' : ''));
}

function toggleEditTarjeta(id) {
  const row = document.getElementById('tc-edit-' + id);
  if (!row) return;
  const isOpen = row.style.display !== 'none';
  // Cerrar todas las filas de edición abiertas
  document.querySelectorAll('#tc-lista .edit-row').forEach(r => r.style.display = 'none');
  // Abrir la seleccionada (si estaba cerrada)
  if (!isOpen) row.style.display = 'table-row';
}

function saveEditTarjeta(id) {
  const idx = tarjetas.findIndex(t => t.id === id);
  if (idx < 0) return;
  const t = tarjetas[idx];
  const tipo = t.tipo || 'credito';

  const banco  = document.getElementById('te-banco-' + id)?.value.trim()  || t.banco  || '';
  const nombre = document.getElementById('te-nombre-' + id)?.value.trim() || t.nombre || '';
  const cierre = parseInt(document.getElementById('te-cierre-' + id)?.value) || 0;
  const limite = parseFloat(document.getElementById('te-limite-' + id)?.value) || 0;

  // Recalcular label
  let label = '';
  if (tipo === 'credito')   label = (nombre ? nombre + ' ' : '') + banco;
  if (tipo === 'debito')    label = 'CA ' + banco + (nombre ? ' (' + nombre + ')' : '');
  if (tipo === 'billetera') label = banco || nombre || t.label;

  tarjetas[idx] = { ...t, banco, nombre, cierre, limite, label };
  saveTarjetas();
  renderTarjetas();
  renderMedioPago();
  renderDestinosIngreso();
  renderOrigenAhorro();
  renderSaldoInicial();
  notify('Medio actualizado');
}

function eliminarTarjeta(id) {
  tarjetas = tarjetas.filter(t => t.id !== id);
  saveTarjetas();
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
    el.innerHTML = '<div class="empty" style="padding:1rem">Sin medios de pago cargados</div>';
    return;
  }

  const iconTipo = t => {
    const tipo = t.tipo || 'credito';
    if (tipo === 'debito')   return '🏦';
    if (tipo === 'billetera') return '📱';
    return '💳';
  };
  const labelTipo = t => {
    const tipo = t.tipo || 'credito';
    if (tipo === 'debito')   return 'Caja/Débito';
    if (tipo === 'billetera') return 'Billetera';
    return 'Crédito';
  };

  el.innerHTML = `<table>
    <thead><tr><th>Tipo</th><th>Medio</th><th>Detalle</th><th></th></tr></thead>
    <tbody>
      ${tarjetas.map(t => {
        const tipo = t.tipo || 'credito';
        const detalle = tipo === 'credito'
          ? (t.cierre ? 'Cierre día ' + t.cierre : 'Sin fecha de cierre') + (t.limite > 0 ? ' · $' + fmt(t.limite) : '')
          : tipo === 'debito' ? (t.nombre ? t.nombre : 'Caja de ahorro')
          : '—';
        const label = t.label || t.nombre;
        return `
        <tr id="tc-row-${t.id}">
          <td><span class="badge badge-cat">${iconTipo(t)} ${labelTipo(t)}</span></td>
          <td><span class="badge badge-medio">${label}</span></td>
          <td style="font-size:0.75rem;color:var(--text3)">${detalle}</td>
          <td style="display:flex;gap:4px">
            <button class="btn-edit" onclick="toggleEditTarjeta(${t.id})">✏</button>
            <button class="btn-del"  onclick="eliminarTarjeta(${t.id})">✕</button>
          </td>
        </tr>
        <tr id="tc-edit-${t.id}" class="edit-row" style="display:none">
          <td colspan="4" style="padding:12px 14px !important">
            <div class="edit-panel-header">${iconTipo(t)} ${labelTipo(t)} · ${t.label || t.banco || ''}</div>
            <div class="edit-panel-body">
              <!-- Banco / Institución -->
              <input class="edit-input" id="te-banco-${t.id}" type="text" value="${t.banco||''}" placeholder="${(t.tipo||'credito') === 'billetera' ? 'Nombre / Institución' : 'Banco'}">
              <!-- Red / Nombre / Alias según tipo -->
              ${(t.tipo||'credito') !== 'billetera'
                ? `<input class="edit-input" id="te-nombre-${t.id}" type="text" value="${t.nombre||''}" placeholder="${(t.tipo||'credito') === 'debito' ? 'Alias / descripción (opcional)' : 'Red (Visa, Mastercard...)'}">`
                : `<input type="hidden" id="te-nombre-${t.id}" value="${t.nombre||''}">`}
              <!-- Cierre y Límite (solo crédito) en fila -->
              ${(t.tipo||'credito') === 'credito' ? `
              <div class="edit-panel-row">
                <input class="edit-input" id="te-cierre-${t.id}" type="number" min="1" max="31" value="${t.cierre||''}" placeholder="Cierre (día)">
                <input class="edit-input" id="te-limite-${t.id}" type="number" value="${t.limite||''}" placeholder="Límite ($)">
              </div>` : ''}
              <button class="btn-save edit-panel-save" onclick="saveEditTarjeta(${t.id})">✓ Guardar</button>
            </div>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

// Reconstruir el select de medio de pago dinámicamente
function renderMedioPago(extraMedio) {
  const container = $('g-medio-container');
  if (!container) return;

  // Reconstruir select si no existe
  if (!$('g-medio')) {
    container.innerHTML = '<select id="g-medio" onchange="toggleCuotasIfNeeded()"></select>';
  }
  const sel = $('g-medio');
  const actual = sel.value;

  const opciones = ['Efectivo'];
  tarjetas.filter(t => (t.tipo||'credito') === 'credito').forEach(t => opciones.push(t.label || t.nombre));
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => opciones.push(t.label || ('CA ' + t.banco)));
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => opciones.push(t.label || t.banco || t.nombre));

  // Si el gasto viejo tiene un medio que ya no está en la lista, lo agregamos como opción
  if (extraMedio && !opciones.includes(extraMedio)) opciones.push(extraMedio);

  const valorActual = actual || 'Efectivo';
  sel.innerHTML = opciones.map(o => '<option value="' + o + '"' + (o === valorActual ? ' selected' : '') + '>' + o + '</option>').join('');
  sel.onchange = () => toggleCuotasIfNeeded();
}

// Recalcular visibilidad del toggle de cuotas al cambiar el medio
function toggleCuotasIfNeeded() {
  if ($('g-cuota').checked) toggleCuotas();
}

// ---- DESTINOS ----
// Guarda destinos usados por tipo: { "Billetera Virtual": ["Mercado Pago","Uala"], "Banco": ["Galicia"] }
let destinosGuardados = JSON.parse(localStorage.getItem('gf_destinos') || '{}');

function saveDestinos() {
  localStorage.setItem('gf_destinos', JSON.stringify(destinosGuardados));
  renderMedioPago();
}

function toggleDestinoDetalle(selectId, detalleId) {
  const val = document.getElementById(selectId).value;
  const wrap = document.getElementById(detalleId);
  wrap.style.display = (val === 'Billetera Virtual' || val === 'Banco') ? 'block' : 'none';
  if (wrap.style.display === 'none') {
    // limpiar input oculto
    const inp = wrap.querySelector('input[type=text]');
    if (inp) inp.value = '';
  }
}

function filtrarDestinos(selectId, inputId, listId) {
  const tipo = document.getElementById(selectId).value;
  const val  = document.getElementById(inputId).value.toLowerCase();
  const lista = document.getElementById(listId);
  const opciones = (destinosGuardados[tipo] || []).filter(d => d.toLowerCase().includes(val));
  if (!opciones.length) { lista.style.display = 'none'; return; }
  lista.style.display = 'block';
  lista.innerHTML = opciones.map(d =>
    `<div onclick="seleccionarDestino('${inputId}','${listId}','${d.replace(/'/g,"&#39;")}')"
      style="padding:8px 12px;cursor:pointer;font-size:0.82rem;color:var(--text2)"
      onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background=''">${d}</div>`
  ).join('');
}

function seleccionarDestino(inputId, listId, valor) {
  document.getElementById(inputId).value = valor;
  document.getElementById(listId).style.display = 'none';
}

function resolverDestino(selectId) {
  const sel = document.getElementById(selectId);
  if (!sel) return '';
  return sel.value || '';
}

function renderDestinosIngreso() {
  // Solo Efectivo + billeteras virtuales + débito (no crédito, no almacena dinero)
  const opciones = ['Efectivo'];
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => opciones.push(t.label || t.banco || t.nombre));
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
    // Normalizar label: si dice "Débito X" mostrarlo como "CA X"
    let lbl = t.label || ('CA ' + t.banco);
    if (lbl.startsWith('Débito ')) lbl = 'CA ' + lbl.slice(7);
    opciones.push(lbl);
  });

  const opcionesHTML = opciones.map(o => '<option value="' + o + '"' + (o === 'Efectivo' ? ' selected' : '') + '>' + o + '</option>').join('');

  const selSueldo = $('i-sueldo-destino');
  if (selSueldo && !selSueldo.value) selSueldo.innerHTML = opcionesHTML;
  else if (selSueldo) {
    const prev = selSueldo.value;
    selSueldo.innerHTML = opcionesHTML;
    if (prev) selSueldo.value = prev;
  }

  const selOtro = $('i-otro-destino');
  if (selOtro) selOtro.innerHTML = opcionesHTML;
}

function renderOrigenAhorro() {
  const sel = $('a-origen');
  if (!sel) return;
  const opciones = ['Efectivo'];
  tarjetas.filter(t => t.tipo === 'billetera').forEach(t => opciones.push(t.label || t.banco || t.nombre));
  tarjetas.filter(t => t.tipo === 'debito').forEach(t => {
    let lbl = t.label || ('CA ' + t.banco);
    if (lbl.startsWith('Débito ')) lbl = 'CA ' + lbl.slice(7);
    opciones.push(lbl);
  });
  sel.innerHTML = '<option value="">Seleccionar...</option>' +
    opciones.map(o => `<option value="${o}">${o}</option>`).join('');
}

const CONCEPTOS_FIJOS = ['Sueldo','Freelance','Alquiler','Facturación','Inversión'];

function renderConceptosSelect() {
  const sel = $('i-sueldo-concepto');
  if (!sel) return;
  const custom = (conceptosGuardados || []).filter(c => !CONCEPTOS_FIJOS.includes(c));
  const prev = sel.value;
  sel.innerHTML =
    `<option value="Sueldo">💼 Sueldo</option>
     <option value="Freelance">💻 Freelance</option>
     <option value="Alquiler">🏠 Alquiler</option>
     <option value="Facturación">🧾 Facturación</option>
     <option value="Inversión">📈 Inversión</option>` +
    custom.map(c => `<option value="${c}">✦ ${c}</option>`).join('') +
    `<option value="Otros">✏ Agregar nuevo...</option>`;
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;

  // Mostrar lista de categorías custom con botón eliminar
  const lista = $('conceptos-custom-lista');
  if (!lista) return;
  if (custom.length === 0) { lista.style.display = 'none'; return; }
  lista.style.display = 'block';
  lista.innerHTML = '<div style="font-size:0.65rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Mis categorías</div>' +
    custom.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:4px 8px;background:var(--bg);border-radius:8px;margin-bottom:4px">
        <span style="font-size:0.82rem;color:var(--text2)">✦ ${c}</span>
        <button onclick="eliminarConcepto('${c}')" style="background:none;border:none;color:var(--accent2);font-size:0.8rem;cursor:pointer;padding:2px 6px">✕</button>
      </div>`).join('');
}

function eliminarConcepto(nombre) {
  conceptosGuardados = conceptosGuardados.filter(c => c !== nombre);
  save();
  renderConceptosSelect();
  notify(`Categoría "${nombre}" eliminada`);
}

function toggleConceptoOtro() {
  const sel = $('i-sueldo-concepto');
  const otro = $('i-sueldo-concepto-otro');
  if (!sel || !otro) return;
  otro.style.display = sel.value === 'Otros' ? 'block' : 'none';
  if (sel.value === 'Otros') otro.focus();
}

function getConceptoIngreso() {
  const sel = $('i-sueldo-concepto');
  if (!sel) return 'Ingreso';
  if (sel.value === 'Otros') {
    const otro = $('i-sueldo-concepto-otro');
    const nombre = otro?.value.trim();
    if (nombre) {
      // Guardar en conceptosGuardados si no existe
      if (!conceptosGuardados.includes(nombre)) {
        conceptosGuardados.push(nombre);
        // No llamamos save() acá, se llama en addIngreso
      }
      return nombre;
    }
    return 'Ingreso';
  }
  return sel.value;
}

function addIngreso() {
  const año    = parseInt($('i-año').value);
  const mes    = $('i-mes').value;
  const sueldo = parseFloat($('i-sueldo').value) || 0;
  const sueldoMoneda = $('i-sueldo-moneda').value;
  const sueldoDestino = resolverDestino('i-sueldo-destino');
  const sueldoConcepto = getConceptoIngreso();
  if (!año) { notify('Ingresá el año'); return; }
  if (sueldo <= 0 && otrosPendientes.length === 0) { notify('⚠ Ingresá al menos un monto'); return; }
  // Calcular totales por moneda (sueldo + otros pendientes)
  let totalARS = sueldoMoneda === 'ARS' ? sueldo : 0;
  let totalUSD = sueldoMoneda === 'USD' ? sueldo : 0;
  otrosPendientes.forEach(o => {
    if (o.moneda === 'ARS') totalARS += o.monto;
    else totalUSD += o.monto;
  });
  // Cada guardado es una fila nueva independiente
  const key = `${año}-${String(MESES.indexOf(mes)+1).padStart(2,'0')}-${Date.now()}`;
  const rec = { key, año, mes, sueldo, sueldoMoneda, sueldoDestino, sueldoConcepto, otros: [...otrosPendientes], totalARS, totalUSD, total: totalARS };
  ingresos.push(rec);
  save();
  otrosPendientes = [];
  renderOtrosPendientes();
  $('i-sueldo').value = '';
  $('i-sueldo-destino').value = '';
  $('i-sueldo-concepto').value = 'Sueldo';
  $('i-sueldo-concepto-otro').style.display = 'none';
  $('i-sueldo-concepto-otro').value = '';
  renderConceptosSelect();
  $('otros-form').style.display = 'none';
  notify('Ingreso guardado');
  renderIngresosTable();
}

function deleteIngreso(key) {
  ingresos = ingresos.filter(i => i.key !== key);
  save();
  renderIngresosTable();
}

function toggleEditIngreso(uid) {
  const row = document.getElementById('edit-i-' + uid);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

function saveEditIngreso(uid) {
  const idx = ingresos.findIndex(i => (i.uid && String(i.uid) === String(uid)) || String(i.key).replace(/[^a-zA-Z0-9_-]/g,'_') === String(uid));
  if (idx < 0) return;
  const sueldo = parseFloat(document.getElementById('ei-sueldo-' + uid).value) || 0;
  const sueldoMoneda = document.getElementById('ei-smoneda-' + uid).value;
  // Leer destino editado directamente del select
  const sueldoDestino = document.getElementById('ei-destino-' + uid)?.value || '';
  const otros = ingresos[idx].otros || [];
  const totalARS = (sueldoMoneda === 'ARS' ? sueldo : 0) + otros.filter(o => o.moneda === 'ARS').reduce((s, o) => s + o.monto, 0);
  const totalUSD = (sueldoMoneda === 'USD' ? sueldo : 0) + otros.filter(o => o.moneda === 'USD').reduce((s, o) => s + o.monto, 0);
  ingresos[idx] = { ...ingresos[idx], sueldo, sueldoMoneda, sueldoDestino, totalARS, totalUSD, total: totalARS };
  save();
  notify('Ingreso actualizado');
  renderIngresosTable();
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
    // Si empieza con "CA ", intentar con "Débito "
    if (dest.startsWith('CA ')) {
      const alt = 'Débito ' + dest.slice(3);
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

  // − Base de ahorros depositados desde cada cuenta
  ahorros.forEach(a => {
    const orig = normalizarDestino(a.origen || '');
    if (orig && saldos[orig] !== undefined) {
      const base = a.monto - (a.rendimientos || 0);
      if ((a.moneda || 'ARS') === 'ARS') saldos[orig].ars -= base;
      else saldos[orig].usd -= base;
    }
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
    return `
    <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
          <span style="font-size:1.3rem;flex-shrink:0">${icon}</span>
          <div>
            <div style="font-size:0.88rem;font-weight:700;color:var(--text2)">${c}</div>
            <div style="font-family:'DM Mono',monospace;font-weight:700;color:${arsColor};font-size:1rem">$${fmt(ars)}</div>
            ${usd !== 0 ? `<div style="font-family:'DM Mono',monospace;font-weight:700;color:${usdColor};font-size:0.82rem">u$s ${fmt(usd)}</div>` : ''}
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button onclick="toggleCuentaPanel('ajuste-${safeC}')" style="background:rgba(245,184,46,0.1);border:1px solid rgba(245,184,46,0.4);color:var(--accent3);border-radius:10px;padding:6px 10px;font-size:0.75rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600">✏ Ajustar</button>
          <button onclick="toggleCuentaPanel('mover-${safeC}')" style="background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.4);color:var(--accent4);border-radius:10px;padding:6px 10px;font-size:0.75rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600">↔ Mover</button>
        </div>
      </div>
      <!-- Panel Ajustar -->
      <div id="ajuste-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;background:rgba(245,184,46,0.06);border:1px solid rgba(245,184,46,0.2);border-radius:12px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent3);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Ajustar saldo de ${c}</div>
        <div style="font-size:0.72rem;color:var(--text3)">Ingresá el saldo real que tenés ahora. La diferencia se registra automáticamente y <strong>no afecta el Dashboard</strong>.</div>
        <input id="ajuste-input-${safeC}" type="number" placeholder="Saldo real actual ($)" step="0.01"
          style="background:var(--bg);border:1px solid var(--accent3);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:0.9rem;padding:10px 14px;outline:none;width:100%;box-sizing:border-box">
        <button onclick="aplicarAjusteCuenta('${c}', '${safeC}', ${ars})"
          style="background:var(--accent3);border:none;color:#0d0f14;border-radius:10px;padding:10px;font-size:0.85rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700">✓ Aplicar ajuste</button>
        ${(ajustesCuentas||[]).filter(a=>a.cuenta===c).length > 0 ? `
        <div style="margin-top:4px;border-top:1px solid rgba(245,184,46,0.2);padding-top:8px">
          <div style="font-size:0.68rem;color:var(--text3);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">Historial de ajustes</div>
          ${(ajustesCuentas||[]).filter(a=>a.cuenta===c).map(a => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
            <div>
              <div style="font-size:0.75rem;color:var(--text2)">${a.fecha} · $${a.saldoAntes?.toLocaleString('es-AR')} → $${a.saldoDespues?.toLocaleString('es-AR')}</div>
              <div style="font-size:0.7rem;color:${a.monto>0?'var(--accent)':'var(--accent2)'}">${a.monto>0?'+':''}$${fmt(a.monto)}</div>
            </div>
            <button onclick="eliminarAjuste(${a.id})" style="background:none;border:1px solid rgba(255,79,94,0.4);color:var(--accent2);border-radius:8px;padding:3px 8px;font-size:0.7rem;cursor:pointer">✕</button>
          </div>`).join('')}
        </div>` : ''}
      </div>
      <!-- Panel Mover -->
      <div id="mover-${safeC}" style="display:none;margin-top:10px;flex-direction:column;gap:8px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:12px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent4);font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Mover dinero desde ${c}</div>
        <input id="mover-input-${safeC}" type="number" placeholder="Monto a mover ($)" min="0" step="0.01"
          style="background:var(--bg);border:1px solid var(--accent4);border-radius:10px;color:var(--text);font-family:'DM Mono',monospace;font-size:0.9rem;padding:10px 14px;outline:none;width:100%;box-sizing:border-box">
        <select id="mover-destino-${safeC}"
          style="background:var(--bg);border:1px solid var(--accent4);border-radius:10px;color:var(--text);font-family:'Sora',sans-serif;font-size:0.88rem;padding:10px 14px;outline:none;width:100%;box-sizing:border-box;min-height:46px">
          <option value="">→ ¿A dónde?</option>
          ${opcionesDestino(c)}
        </select>
        <button onclick="moverEntreCuentas('${c}', '${safeC}')"
          style="background:var(--accent4);border:none;color:#fff;border-radius:10px;padding:10px;font-size:0.85rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700">✓ Confirmar</button>
      </div>
    </div>`;
  }).join('') + extraRow;
}

function toggleCuentaPanel(id) {
  const el = document.getElementById(id);
  if (!el) return;
  const visible = el.style.display !== 'none';
  // Cerrar solo los divs de panel, no los selects ni inputs con mismo prefijo
  document.querySelectorAll('div[id^="ajuste-"], div[id^="mover-"]').forEach(p => {
    if (p.id !== id) p.style.display = 'none';
  });
  if (!visible) {
    el.style.display = 'flex';
    setTimeout(() => el.querySelector('input')?.focus(), 50);
  } else {
    el.style.display = 'none';
  }
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
}

function eliminarAjuste(id) {
  ajustesCuentas = ajustesCuentas.filter(a => a.id !== id);
  save();
  renderSaldoCuentas();
  notify('Ajuste eliminado');
}

function borrarTodosLosAjustes() {
  if (!ajustesCuentas || ajustesCuentas.length === 0) { notify('No hay ajustes guardados'); return; }
  if (!confirm('¿Borrar todos los ajustes? Esta acción no se puede deshacer.')) return;
  ajustesCuentas = [];
  save();
  renderSaldoCuentas();
  renderDashboard();
  notify('Todos los ajustes eliminados');
}

function moverEntreCuentas(origen, safeC) {
  const input = document.getElementById('mover-input-' + safeC);
  const destSel = document.getElementById('mover-destino-' + safeC);
  const monto = parseFloat(input.value);
  const destino = destSel.value;

  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  if (!destino) { notify('⚠ Seleccioná un destino'); return; }

  const key = `mov-${Date.now()}`;
  // Salida del origen (gasto sin categoría de gasto)
  gastos.push({
    id: Date.now(), fecha: new Date().toISOString().slice(0,10),
    desc: `Transferencia → ${destino}`, cat: 'Transferencia',
    medio: origen, monto, notas: `Movimiento a ${destino}`
  });
  // Entrada al destino (ingreso)
  ingresos.push({
    key, uid: key, año: new Date().getFullYear(),
    mes: MESES[new Date().getMonth()],
    sueldo: 0, sueldoMoneda: 'ARS', sueldoDestino: destino,
    otros: [{ id: Date.now()+1, nombre: `Transferencia desde ${origen}`, moneda: 'ARS', monto, destino }],
    totalARS: monto, totalUSD: 0, total: monto
  });

  save();
  notify(`✓ $${fmt(monto)} movidos de ${origen} → ${destino}`);
  input.value = '';
  destSel.value = '';
  renderSaldoCuentas();
}

function renderIngresosTable() {
  const el = $('ingresos-table-body');
  if (!ingresos.length) { el.innerHTML = '<div class="empty"><div class="icon">💵</div>Sin ingresos cargados aún</div>'; return; }
  const list = [...ingresos].sort((a,b) => b.key.localeCompare(a.key));
  const fmtARS = v => v > 0 ? `$${fmt(v)}` : '—';
  const fmtUSD = v => v > 0 ? `u$s ${fmt(v)}` : '—';
  const fmtVal = (v, moneda) => moneda === 'USD'
    ? `<span style="color:var(--accent3);font-family:'DM Mono',monospace">u$s ${fmt(v)}</span>`
    : `<span class="monto">$${fmt(v)}</span>`;
  el.innerHTML = `<table>
    <thead><tr><th>Período</th><th>Detalle</th><th class="col-hide-mobile">Destino</th><th class="col-hide-mobile">Otros</th><th class="col-hide-mobile">Total ARS</th><th class="col-hide-mobile">Total USD</th><th></th></tr></thead>
    <tbody>
      ${list.map(i => {
        const otros = i.otros || [];
        // Detectar si es un ajuste manual viejo (registrado con código anterior)
        const esAjusteViejo = otros.some(o => o.nombre === 'Ajuste manual de saldo') ||
                              i.sueldoConcepto === 'Ajuste' ||
                              (i.key && i.key.startsWith('ajuste-'));
        if (esAjusteViejo) {
          return `
          <tr style="background:rgba(245,184,46,0.06)">
            <td style="white-space:nowrap">
              <div style="font-family:'DM Mono',monospace;color:var(--text2);font-size:0.82rem">${i.mes}</div>
              <div style="font-family:'DM Mono',monospace;color:var(--text3);font-size:0.72rem">${i.año}</div>
            </td>
            <td>
              <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(245,184,46,0.15);border:1px solid rgba(245,184,46,0.3);border-radius:8px;padding:3px 8px;font-size:0.72rem;color:var(--accent3)">⚠ Ajuste manual (código viejo)</div>
              <div style="font-size:0.72rem;color:var(--text3);margin-top:3px">Este registro afecta el Dashboard. Eliminalo para corregir.</div>
              <div class="col-show-mobile" style="color:var(--accent3);font-family:'DM Mono',monospace;font-size:0.82rem;margin-top:3px">${fmtARS(i.totalARS ?? i.total)}</div>
            </td>
            <td class="col-hide-mobile" style="color:var(--accent3);font-family:'DM Mono',monospace">${fmtARS(i.totalARS ?? i.total)}</td>
            <td class="col-hide-mobile"></td>
            <td class="col-hide-mobile"></td>
            <td class="col-hide-mobile"></td>
            <td style="padding-right:8px !important">
              <button class="btn-del" onclick="deleteIngreso('${i.key}')" style="background:rgba(255,79,94,0.15);border-color:var(--accent2);color:var(--accent2)">✕ Eliminar</button>
            </td>
          </tr>`;
        }
        const otrosHtml = otros.length
          ? otros.map(o => '<div style="font-size:0.75rem;color:var(--text2)">' + o.nombre + (o.destino ? ' → <span style="color:var(--accent4)">' + o.destino + '</span>' : '') + ': ' + (o.moneda==='USD'?'u$s':'$') + fmt(o.monto) + '</div>').join('')
          : (i.extra > 0 ? `<div style="font-size:0.75rem;color:var(--text2)">Extra: $${fmt(i.extra)}</div>` : '—');
        const destinoHtml = i.sueldoDestino ? `<span class="badge badge-medio">${i.sueldoDestino}</span>` : '—';
        const uid = i.uid || i.key;
        const safeUid = String(uid).replace(/[^a-zA-Z0-9_-]/g, '_');
        if (!i.uid) i.uid = safeUid;
        const destinoIcono = i.sueldoDestino
          ? (i.sueldoDestino === 'Efectivo' ? '💵' : tarjetas.find(t=>t.tipo==='billetera'&&(t.label||t.banco||t.nombre)===i.sueldoDestino) ? '📱' : '🏦')
          : '💵';
        const tipoLabel = i.sueldo > 0
          ? '<div style="font-size:0.8rem;color:var(--text2)">💼 ' + (i.sueldoConcepto || 'Ingreso') + '</div>' +
            '<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">' + destinoIcono + ' ' + (i.sueldoDestino || 'Efectivo') + '</div>'
          : '';
        const otrosMobile = otros.length
          ? otros.map(o => '<div style="font-size:0.75rem;color:var(--text2);margin-top:3px">✦ ' + o.nombre + (o.destino ? ' <span style="color:var(--text3)">→ ' + o.destino + '</span>' : '') + '</div>').join('')
          : '';
        const montoMobile = (i.totalARS ?? i.total) > 0
          ? `<div class="col-show-mobile" style="color:var(--accent);font-family:'DM Mono',monospace;font-weight:600;font-size:0.82rem;margin-top:4px">${fmtARS(i.totalARS ?? i.total)}</div>`
          : '';
        return `
        <tr>
          <td style="white-space:nowrap">
            <div style="font-family:'DM Mono',monospace;color:var(--text2);font-size:0.82rem">${i.mes}</div>
            <div style="font-family:'DM Mono',monospace;color:var(--text3);font-size:0.72rem">${i.año}</div>
          </td>
          <td>${tipoLabel}${otrosMobile}${montoMobile}</td>
          <td class="col-hide-mobile">${destinoHtml}</td>
          <td class="col-hide-mobile">${otrosHtml}</td>
          <td class="col-hide-mobile" style="color:var(--accent);font-family:'DM Mono',monospace;font-weight:600;white-space:nowrap">${fmtARS(i.totalARS ?? i.total)}</td>
          <td class="col-hide-mobile" style="color:var(--accent3);font-family:'DM Mono',monospace;font-weight:600">${fmtUSD(i.totalUSD ?? 0)}</td>
          <td style="display:flex;gap:4px;padding-right:8px !important">
            <button class="btn-edit" onclick="toggleEditIngreso('${safeUid}')">✏</button>
            <button class="btn-del" onclick="deleteIngreso('${i.key}')">✕</button>
          </td>
        </tr>
        <tr id="edit-i-${safeUid}" class="edit-row" style="display:none">
          <td colspan="7" style="padding:12px 14px !important">
            <div class="edit-panel-header">💼 ${i.mes} ${i.año}</div>
            <div class="edit-panel-body">
              <!-- Moneda + Monto en fila -->
              <div class="edit-panel-row">
                <select id="ei-smoneda-${safeUid}" class="edit-input" style="max-width:110px">
                  <option value="ARS" ${(i.sueldoMoneda||'ARS')==='ARS'?'selected':''}>$ ARS</option>
                  <option value="USD" ${i.sueldoMoneda==='USD'?'selected':''}>u$s USD</option>
                </select>
                <input class="edit-input" id="ei-sueldo-${safeUid}" type="number" value="${i.sueldo||0}" placeholder="Sueldo / Salario">
              </div>
              <!-- Destino -->
              <select id="ei-destino-${safeUid}" class="edit-input">
                <option value="">Sin destino</option>
                <option value="Efectivo" ${(i.sueldoDestino||'')==='Efectivo'?'selected':''}>Efectivo</option>
                ${tarjetas.filter(t=>t.tipo==='billetera').map(t=>`<option value="${t.label||t.banco||t.nombre}" ${(i.sueldoDestino||'')===(t.label||t.banco||t.nombre)?'selected':''}>${t.label||t.banco||t.nombre}</option>`).join('')}
                ${tarjetas.filter(t=>t.tipo==='debito').map(t=>`<option value="${t.label||('Débito '+t.banco)}" ${(i.sueldoDestino||'')===(t.label||('Débito '+t.banco))?'selected':''}>${t.label||('Débito '+t.banco)}</option>`).join('')}
                ${(i.sueldoDestino && i.sueldoDestino !== 'Efectivo' && !tarjetas.some(t=>t.tipo!=='credito' && ((t.label||t.banco||t.nombre)===i.sueldoDestino || (t.label||('Débito '+t.banco))===i.sueldoDestino))) ? `<option value="${i.sueldoDestino}" selected>${i.sueldoDestino}</option>` : ''}
              </select>
              ${(i.otros||[]).length ? '<div style="font-size:0.72rem;color:var(--text3);padding:2px 0 0">Otros: ' + (i.otros||[]).map(o=> o.nombre + ' ' + (o.moneda==='USD'?'u$s':'$') + fmt(o.monto) + (o.destino ? ' → ' + o.destino : '')).join(', ') + '</div>' : ''}
              <button class="btn-save edit-panel-save" onclick="saveEditIngreso('${safeUid}')">✓ Guardar</button>
            </div>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

// ---- CUOTAS ----
// ---- DASHBOARD ----
function buildDashMonths() {
  const all = [...new Set(
    gastos.map(g => g.fecha.slice(0,7))
    .concat(ingresos.map(i => i.ymBase || i.key.slice(0,7)))
    .concat(ahorros.map(a => a.ymBase || a.key.slice(0,7)))
  )].sort().reverse();
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
  const [ymYear, ymMonth] = ym.split('-').map(Number);
  gastos.forEach(g => {
    if (!g.cuota) {
      // Gasto normal: aparece en su mes de compra
      if (g.fecha.slice(0, 7) === ym) items.push({ monto: g.monto, cat: g.cat });
    } else {
      // Cuota: calcular qué cuotas caen en ym
      const [fy, fm, fd] = g.fecha.split('-').map(Number);
      const off = g.offsetCuotas || 0;
      for (let n = 0; n < g.ncuotas; n++) {
        // Mes en que cae la cuota n (0-indexed), con offset si la tarjeta no cerró
        let cy = fy, cm = fm + off + n;
        while (cm > 12) { cm -= 12; cy++; }
        const cuotaYm = `${cy}-${String(cm).padStart(2, '0')}`;
        if (cuotaYm === ym) items.push({ monto: g.montoXcuota, cat: g.cat });
      }
    }
  });
  return items;
}

function totalDelMes(ym) {
  return gastosDelMes(ym).reduce((s, x) => s + x.monto, 0);
}

function renderDashboard() {
  buildDashMonths();
  const ym = selectedDashMonth;

  // Gastos: normales en su mes + cuotas que caen en ym
  const itemsM = gastosDelMes(ym);
  // Cantidad de transacciones: gastos normales del mes + cuotas que caen este mes
  const gastosNormalesM = gastos.filter(g => !g.cuota && g.fecha.slice(0,7) === ym);
  const cuotasEnMes = gastos.filter(g => {
    if (!g.cuota) return false;
    const [fy, fm] = g.fecha.split('-').map(Number);
    const [wy, wm] = ym.split('-').map(Number);
    const n0 = (wy - fy) * 12 + (wm - fm);
    return n0 >= 0 && n0 < g.ncuotas;
  });

  const totalGasto = itemsM.reduce((s, x) => s + x.monto, 0);
  const ingM = ingresos.filter(i => (i.ymBase || i.key.slice(0,7)) === ym);
  const ahorrosM = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === ym);
  const totalIngreso = ingM.reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalAhorroMes = ahorrosM.reduce((s, a) => s + a.monto, 0);

  // Saldo ACUMULATIVO: todos los ingresos historicos + saldos iniciales - todos los gastos - todo el ahorro
  const totalIngresosHistorico = ingresos.reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const totalGastosHistorico = (() => {
    // Sumar todos los gastos normales + todas las cuotas que ya cayeron hasta hoy
    const hoy = new Date().toISOString().slice(0,7);
    let total = 0;
    gastos.forEach(g => {
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
  // Disponible del mes: flujo mensual + ajustes registrados para el mes seleccionado.
  const ajustesDelMes = (ajustesCuentas || []).filter(a => a.fecha.slice(0,7) === ym).reduce((s, a) => s + (a.monto || 0), 0);
  const saldo = totalIngreso - totalGasto - totalAhorroMes + ajustesDelMes;

  $('d-gasto').textContent = '$' + fmt(totalGasto);
  $('d-ingreso').textContent = '$' + fmt(totalIngreso);
  $('d-saldo').textContent = '$' + fmt(saldo);
  $('d-ahorro').textContent = '$' + fmt(totalAhorroAcumulado);
  const totalAhorro = totalAhorroMes; // para compatibilidad con el resto del codigo del mes
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

  // Saldo sub label
  const subEl = $('d-saldo-sub');
  if (subEl) subEl.textContent = ajustesDelMes !== 0 ? 'ingresos − gastos − ahorro + ajustes' : (totalAhorroMes > 0 ? 'ingresos − gastos − ahorro del mes' : 'ingresos − gastos del mes');

  // Saldo color
  const saldoEl = $('d-saldo');
  saldoEl.style.color = saldo >= 0 ? 'var(--accent)' : 'var(--accent2)';

  // Category bars (incluye cuotas del mes)
  const cats = {};
  itemsM.forEach(x => { cats[x.cat] = (cats[x.cat] || 0) + x.monto; });
  const sorted = Object.entries(cats).sort((a,b) => b[1]-a[1]);
  const catEl = $('cat-bars');
  if (!sorted.length) { catEl.innerHTML = '<div class="empty"><div class="icon">🪣</div>Sin gastos este mes</div>'; }
  else {
    const max = sorted[0][1];
    const totalGastosCat = sorted.reduce((s, [, v]) => s + v, 0);
    catEl.innerHTML = sorted.map(([cat, v]) => {
      const pct = (v / max * 100).toFixed(1);
      const pctTotal = totalGastosCat > 0 ? (v / totalGastosCat * 100).toFixed(1) : '0.0';
      return '<div class="bar-item">' +
        '<div class="bar-label"><span>' + cat + '</span>' +
        '<span style="display:flex;gap:8px;align-items:center">' +
        '<span style="font-size:0.72rem;color:var(--accent2);font-family:\'DM Mono\',monospace;opacity:0.85">' + pctTotal + '%</span>' +
        '<span style="color:var(--accent2);font-family:\'DM Mono\',monospace">$' + fmt(v) + '</span>' +
        '</span></div>' +
        '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:var(--accent2)"></div></div>' +
        '</div>';
    }).join('');
  }

  // Gráfico evolución mensual (SVG, 6 meses)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0,7));
  }
  const monthTotals = months.map(m => {
    const ingRec = ingresos.filter(i => (i.ymBase || i.key.slice(0,7)) === m);
    const totalIng = ingRec.reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
    return {
      m,
      label: MESES[parseInt(m.slice(5,7))-1].slice(0,3),
      gastos: totalDelMes(m),
      ingresos: totalIng
    };
  });

  const allVals = monthTotals.flatMap(x => [x.gastos, x.ingresos]).filter(v => v > 0);
  const maxV = Math.max(...allVals, 1);

  // Formato compacto de montos
  function fmtK(v) {
    if (v === 0) return '$0';
    if (v >= 1000000) return '$' + (v/1000000).toFixed(1).replace('.0','') + 'M';
    if (v >= 1000) return '$' + Math.round(v/1000) + 'k';
    return '$' + fmt(v);
  }

  const W = 560, H = 220;
  const padL = 52, padR = 16, padT = 28, padB = 44;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = monthTotals.length;
  const groupW = chartW / n;
  const barW = Math.min(groupW * 0.28, 22);
  const gap = barW * 0.5;

  // Líneas guía Y (3 líneas)
  const guideVals = [0.25, 0.5, 0.75, 1].map(f => Math.round(maxV * f));
  const guides = guideVals.map(v => {
    const y = padT + chartH - (v / maxV) * chartH;
    return `
      <line x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}" stroke="#252a3a" stroke-width="1"/>
      <text x="${padL - 6}" y="${y + 4}" text-anchor="end" fill="#555c78" font-size="9" font-family="DM Mono,monospace">${fmtK(v)}</text>`;
  }).join('');

  const bars = monthTotals.map((x, i) => {
    const cx = padL + groupW * i + groupW / 2;
    const xG = cx - gap/2 - barW;
    const xI = cx + gap/2;
    const hG = x.gastos > 0 ? Math.max((x.gastos / maxV) * chartH, 3) : 0;
    const hI = x.ingresos > 0 ? Math.max((x.ingresos / maxV) * chartH, 3) : 0;
    const yG = padT + chartH - hG;
    const yI = padT + chartH - hI;
    const isCurrent = x.m === ym;
    const colG = isCurrent ? '#ff6b6b' : '#ff6b6b99';
    const colI = isCurrent ? '#00e5a0' : '#00e5a055';
    const labelY = H - padB + 16;

    const valG = x.gastos > 0
      ? `<text x="${xG + barW/2}" y="${yG - 5}" text-anchor="middle" fill="#ff6b6b" font-size="8.5" font-family="DM Mono,monospace" font-weight="500">${fmtK(x.gastos)}</text>`
      : '';
    const valI = x.ingresos > 0
      ? `<text x="${xI + barW/2}" y="${yI - 5}" text-anchor="middle" fill="#00e5a0" font-size="8.5" font-family="DM Mono,monospace" font-weight="500">${fmtK(x.ingresos)}</text>`
      : '';

    const resalte = isCurrent
      ? `<rect x="${cx - groupW/2 + 2}" y="${padT - 8}" width="${groupW - 4}" height="${chartH + 8}" rx="6" fill="rgba(255,255,255,0.025)"/>`
      : '';

    return `
      ${resalte}
      ${hG > 0 ? `<rect x="${xG}" y="${yG}" width="${barW}" height="${hG}" rx="3" fill="${colG}"/>` : ''}
      ${hI > 0 ? `<rect x="${xI}" y="${yI}" width="${barW}" height="${hI}" rx="3" fill="${colI}"/>` : ''}
      ${valG}${valI}
      <text x="${cx}" y="${labelY}" text-anchor="middle" fill="${isCurrent ? '#e8eaf0' : '#8b90a7'}" font-size="10" font-family="DM Mono,monospace" font-weight="${isCurrent ? '600' : '400'}">${x.label}</text>
      ${isCurrent ? `<text x="${cx}" y="${labelY + 11}" text-anchor="middle" fill="#00e5a0" font-size="7.5" font-family="DM Mono,monospace">◆ actual</text>` : ''}
    `;
  }).join('');

  // Eje X base
  const ejeX = `<line x1="${padL}" x2="${W - padR}" y1="${padT + chartH}" y2="${padT + chartH}" stroke="#252a3a" stroke-width="1.5"/>`;

  // Leyenda
  const leyenda = `
    <rect x="${padL}" y="6" width="10" height="10" rx="2" fill="#ff6b6b"/>
    <text x="${padL + 14}" y="15" fill="#8b90a7" font-size="9.5" font-family="Sora,sans-serif">Gastos</text>
    <rect x="${padL + 62}" y="6" width="10" height="10" rx="2" fill="#00e5a0"/>
    <text x="${padL + 76}" y="15" fill="#8b90a7" font-size="9.5" font-family="Sora,sans-serif">Ingresos</text>
  `;

  $('monthly-bars').innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;overflow:visible">
      ${guides}
      ${ejeX}
      ${bars}
      ${leyenda}
    </svg>`;

  // Cerrar paneles al cambiar de mes
  ['panel-gasto','panel-ingreso','panel-ahorro','panel-saldo'].forEach(id => {
    const p = document.getElementById(id);
    if (p && p.style.display !== 'none') {
      renderCardPanel(id.replace('panel-',''));
    }
  });
}

function toggleCardPanel(panelId) {
  const panel = document.getElementById(panelId);
  const icon = document.getElementById('icon-' + panelId);
  const isOpen = panel.style.display !== 'none';

  // Cerrar todos
  ['panel-gasto','panel-ingreso','panel-ahorro','panel-saldo'].forEach(id => {
    document.getElementById(id).style.display = 'none';
    const ic = document.getElementById('icon-' + id);
    if (ic) ic.classList.remove('open');
  });

  if (!isOpen) {
    panel.style.display = 'block';
    if (icon) icon.classList.add('open');
    renderCardPanel(panelId.replace('panel-',''));
  }
}

function renderCardPanel(tipo) {
  const ym = selectedDashMonth;
  const fmt = v => '$' + v.toLocaleString('es-AR');

  if (tipo === 'saldo')  { _renderSaldoPanel(ym); return; }

  if (tipo === 'gasto') {
    const el = $('panel-gasto-body');
    // Gastos normales del mes
    const normales = gastos.filter(g => !g.cuota && g.fecha.slice(0,7) === ym)
      .sort((a,b) => b.monto - a.monto);
    // Cuotas que caen este mes
    const [wy, wm] = ym.split('-').map(Number);
    const cuotasMes = gastos.filter(g => {
      if (!g.cuota) return false;
      const [fy, fm] = g.fecha.split('-').map(Number);
      const n = (wy - fy) * 12 + (wm - fm);
      return n >= 0 && n < g.ncuotas;
    }).map(g => {
      const [fy, fm] = g.fecha.split('-').map(Number);
      const n = (wy - fy) * 12 + (wm - fm) + 1;
      return { ...g, cuotaN: n };
    }).sort((a,b) => b.montoXcuota - a.montoXcuota);

    if (!normales.length && !cuotasMes.length) {
      el.innerHTML = '<div class="panel-empty">Sin gastos este mes</div>'; return;
    }

    let html = '<table class="panel-table">';
    if (normales.length) {
      html += `<tr><td colspan="4" class="panel-section">Gastos normales</td></tr>`;
      normales.forEach(g => {
        html += `<tr>
          <td style="color:var(--text2);font-size:0.75rem;width:85px">${g.fecha.slice(5).replace('-','/')}</td>
          <td>${g.desc}</td>
          <td><span class="badge badge-cat">${g.cat}</span></td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent2);white-space:nowrap">${fmt(g.monto)}</td>
        </tr>`;
      });
    }
    if (cuotasMes.length) {
      html += `<tr><td colspan="4" class="panel-section">Cuotas del mes</td></tr>`;
      cuotasMes.forEach(g => {
        html += `<tr>
          <td style="color:var(--text2);font-size:0.75rem;width:85px">cuota ${g.cuotaN}/${g.ncuotas}</td>
          <td>${g.desc}</td>
          <td><span class="badge badge-cat">${g.cat}</span></td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent2);white-space:nowrap">${fmt(g.montoXcuota)}</td>
        </tr>`;
      });
    }
    const total = normales.reduce((s,g) => s+g.monto,0) + cuotasMes.reduce((s,g) => s+g.montoXcuota,0);
    html += `</table><div class="panel-total"><span>Total del mes</span><span style="color:var(--accent2)">${fmt(total)}</span></div>`;
    el.innerHTML = html;
  }

  if (tipo === 'ingreso') {
    const el = $('panel-ingreso-body');
    const ingM = ingresos.filter(i => (i.ymBase || i.key.slice(0,7)) === ym);
    if (!ingM.length) { el.innerHTML = '<div class="panel-empty">Sin ingresos registrados este mes</div>'; return; }

    let html = '<table class="panel-table">';
    let total = 0;
    ingM.forEach(i => {
      if (i.sueldo > 0) {
        const moneda = i.sueldoMoneda || 'ARS';
        const val = moneda === 'USD'
          ? `<span style="color:var(--accent3);font-family:'DM Mono',monospace">u$s ${fmt(i.sueldo)}</span>`
          : `<span style="font-family:'DM Mono',monospace;color:var(--accent)">${fmt(i.sueldo)}</span>`;
        const dest = i.sueldoDestino ? `<span style="font-size:0.68rem;color:var(--accent3);margin-left:5px">→ ${i.sueldoDestino}</span>` : '';
        html += `<tr>
          <td>💼 Sueldo / Salario${dest}</td>
          <td style="text-align:right">${val}</td>
        </tr>`;
        if (moneda === 'ARS') total += i.sueldo;
      }
      (i.otros || []).forEach(o => {
        const val = o.moneda === 'USD'
          ? `<span style="color:var(--accent3);font-family:'DM Mono',monospace">u$s ${fmt(o.monto)}</span>`
          : `<span style="font-family:'DM Mono',monospace;color:var(--accent)">${fmt(o.monto)}</span>`;
        const dest = o.destino ? `<span style="font-size:0.68rem;color:var(--accent3);margin-left:5px">→ ${o.destino}</span>` : '';
        html += `<tr>
          <td>✦ ${o.nombre}${dest}</td>
          <td style="text-align:right">${val}</td>
        </tr>`;
        if (o.moneda === 'ARS') total += o.monto;
      });
      if (i.extra > 0 && !(i.otros||[]).length) {
        html += `<tr>
          <td>✦ Freelance / Extra</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:var(--accent)">${fmt(i.extra)}</td>
        </tr>`;
        total += i.extra;
      }
    });
    html += `</table><div class="panel-total"><span>Total ARS del mes</span><span style="color:var(--accent)">${fmt(total)}</span></div>`;
    el.innerHTML = html;
  }

  if (tipo === 'ahorro') {
    const el = $('panel-ahorro-body');
    const ahorrosMes = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === ym);
    const totalMes = ahorrosMes.reduce((s,a) => s + a.monto, 0);

    // Acumulado por tipo/categoría (todos los registros)
    const porTipo = {};
    ahorros.filter(a => (a.moneda || 'ARS') === 'ARS').forEach(a => {
      const t = a.tipo || 'Sin categoría';
      porTipo[t] = (porTipo[t] || 0) + a.monto;
    });
    const sortedTipos = Object.entries(porTipo).sort((a,b) => b[1]-a[1]);
    const totalAcum = sortedTipos.reduce((s,[,v]) => s+v, 0);
    const maxTipo = sortedTipos[0]?.[1] || 1;

    if (!ahorrosMes.length && !sortedTipos.length) {
      el.innerHTML = '<div class="panel-empty">Sin ahorros registrados</div>'; return;
    }

    let html = '';

    // Detalle del mes
    if (ahorrosMes.length) {
      html += `<div class="panel-section">Este mes</div><table class="panel-table">`;
      ahorrosMes.forEach(a => {
        const monedaLabel = a.moneda === 'USD' ? 'u$s ' : '$';
        const color = a.moneda === 'USD' ? 'var(--accent3)' : 'var(--accent)';
        html += `<tr>
          <td>${a.tipo || '—'}</td>
          <td style="color:var(--text3);font-size:0.75rem">${a.notas || ''}</td>
          <td style="text-align:right;font-family:'DM Mono',monospace;color:${color};white-space:nowrap">${monedaLabel}${fmt(a.monto)}</td>
        </tr>`;
      });
      html += `</table><div class="panel-total"><span>Ahorrado este mes</span><span style="color:var(--accent)">${fmt(totalMes)}</span></div>`;
    }

    // Acumulado por categoría
    if (sortedTipos.length) {
      html += `<div class="panel-section" style="margin-top:${ahorrosMes.length?'0':''}">Acumulado total por categoría (ARS)</div>`;
      html += '<div style="padding:0.8rem 1.4rem;display:flex;flex-direction:column;gap:10px">';
      sortedTipos.forEach(([tipo, v]) => {
        const pct = (v / maxTipo * 100).toFixed(1);
        const pctTotal = totalAcum > 0 ? (v / totalAcum * 100).toFixed(0) : 0;
        html += `<div>
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:0.78rem;color:var(--text2)">${tipo}</span>
            <span style="font-family:'DM Mono',monospace;font-size:0.78rem;color:var(--accent)">${fmt(v)} <span style="color:var(--text3);font-size:0.7rem">${pctTotal}%</span></span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:var(--accent)"></div></div>
        </div>`;
      });
      html += `</div><div class="panel-total"><span>Total acumulado ARS</span><span style="color:var(--accent)">${fmt(totalAcum)}</span></div>`;
    }

    el.innerHTML = html;
  }
}

function _renderSaldoPanel(ym) {
  const fmt = v => '$' + Math.abs(v).toLocaleString('es-AR');
  const el = $('panel-saldo-body');

  // Disponible del mes seleccionado
  const itemsMes = gastosDelMes(ym);
  const totalGastosMes = itemsMes.reduce((s, x) => s + x.monto, 0);
  const ingresosMes = ingresos.filter(i => (i.ymBase || i.key.slice(0,7)) === ym);
  const totalIngresosMes = ingresosMes.reduce((s, i) => s + (i.totalARS ?? i.total ?? 0), 0);
  const ahorrosMes = ahorros.filter(a => (a.ymBase || a.key.slice(0,7)) === ym);
  const totalAhorroMes = ahorrosMes.reduce((s, a) => s + a.monto, 0);
  const ajustesMes = (ajustesCuentas || []).filter(a => a.fecha.slice(0,7) === ym);
  const totalAjustesMes = ajustesMes.reduce((s, a) => s + (a.monto || 0), 0);
  const saldoMes = totalIngresosMes - totalGastosMes - totalAhorroMes + totalAjustesMes;

  // Balance historico, solo informativo
  const totalIngresosAcum = ingresos.reduce((s,i) => s+(i.totalARS ?? i.total ?? 0), 0);
  const totalGastosAcum = (() => {
    const hoy = new Date().toISOString().slice(0,7);
    let total = 0;
    gastos.forEach(g => {
      if (!g.cuota) { total += g.monto; }
      else {
        const [fy, fm] = g.fecha.split('-').map(Number);
        const off = g.offsetCuotas || 0;
        for (let n = 0; n < g.ncuotas; n++) {
          let cy = fy, cm = fm + off + n;
          while (cm > 12) { cm -= 12; cy++; }
          if ((cy + '-' + String(cm).padStart(2,'0')) <= hoy) total += g.montoXcuota;
        }
      }
    });
    return total;
  })();
  const totalAhorroAcum = ahorros.reduce((s,a) => s+a.monto, 0);
  const totalSaldoIni   = Object.values(saldosIniciales || {}).reduce((s,v) => s+v, 0);
  const balanceHistorico = totalIngresosAcum + totalSaldoIni - totalGastosAcum - totalAhorroAcum;

  const maxVal = Math.max(totalIngresosMes, totalGastosMes, totalAhorroMes, 1);
  function barra(v, color) {
    const pct = Math.min((v / maxVal * 100), 100).toFixed(1);
    return '<div class="bar-track" style="height:8px;margin-top:4px"><div class="bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
  }

  const filas = [
    { label: '💵 Ingresos del mes', v: totalIngresosMes, color: 'var(--accent)',  signo: '+' },
    { label: '💸 Gastos del mes',   v: totalGastosMes,   color: 'var(--accent2)', signo: '−' },
    { label: '🏦 Ahorro del mes',   v: totalAhorroMes,   color: 'var(--accent4)', signo: '−' },
  ];
  if (totalAjustesMes !== 0) filas.push({ label: '🔧 Ajustes del mes', v: Math.abs(totalAjustesMes), color: 'var(--accent3)', signo: totalAjustesMes > 0 ? '+' : '−' });

  let html = '<div style="padding:1rem 1.4rem;display:flex;flex-direction:column;gap:12px">';
  filas.forEach(f => {
    if (f.v === 0) return;
    html += '<div><div style="display:flex;justify-content:space-between;align-items:center">' +
      '<span style="font-size:0.82rem;color:var(--text2)">' + f.label + '</span>' +
      '<span style="font-family:monospace;font-size:0.85rem;color:' + f.color + '">' + f.signo + ' ' + fmt(f.v) + '</span>' +
      '</div>' + barra(f.v, f.color) + '</div>';
  });
  html += '</div>';

  const saldoColor = saldoMes >= 0 ? 'var(--accent)' : 'var(--accent2)';
  const saldoLabel = saldoMes >= 0 ? '✓ Disponible del mes' : '⚠ Déficit del mes';
  html += '<div class="panel-total" style="border-top:2px solid var(--border)">' +
    '<span>' + saldoLabel + '</span>' +
    '<span style="color:' + saldoColor + ';font-size:1rem">' + (saldoMes < 0 ? '−' : '') + fmt(saldoMes) + '</span>' +
    '</div>';

  const histColor = balanceHistorico >= 0 ? 'var(--accent)' : 'var(--accent2)';
  html += '<div class="panel-total" style="border-top:1px solid var(--border);opacity:.82">' +
    '<span>Balance histórico informativo</span>' +
    '<span style="color:' + histColor + '">' + (balanceHistorico < 0 ? '−' : '') + fmt(balanceHistorico) + '</span>' +
    '</div>';

  el.innerHTML = html;
}
function renderDashCuotas() {
  const fmt = v => '$' + v.toLocaleString('es-AR');
  const el = $('dash-cuotas-body');
  if (!el) return;
  const cuotaGastos = gastos.filter(g => g.cuota);

  // Actualizar contadores del header
  const today = new Date();
  const ym = selectedDashMonth;
  const [wy, wm] = ym.split('-').map(Number);

  const rows = cuotaGastos.map(g => {
    const [fy, fm] = g.fecha.split('-').map(Number);
    const off = g.offsetCuotas || 0;
    let sy = fy, sm = fm + off;
    while (sm > 12) { sm -= 12; sy++; }
    const mesesDesde = (wy - sy) * 12 + (wm - sm);
    const cuotaActual = Math.min(Math.max(mesesDesde + 1, 0), g.ncuotas);
    const restantes   = g.ncuotas - cuotaActual;
    const adeudado    = restantes * g.montoXcuota;
    let ey = sy, em = sm + g.ncuotas - 1;
    while (em > 12) { em -= 12; ey++; }
    const finLabel = MESES[em-1].slice(0,3) + ' ' + ey;
    return { g, cuotaActual, restantes, adeudado, finLabel, activa: restantes > 0 };
  }).sort((a,b) => b.adeudado - a.adeudado);

  const activas = rows.filter(r => r.activa);
  const pagas   = rows.filter(r => !r.activa);
  const totalAdeudado = rows.reduce((s,r) => s + r.adeudado, 0);
  const maxAdeudado = Math.max(...rows.map(r => r.adeudado), 1);

  const dcActivas = $('dc-activas');
  const dcTotal   = $('dc-total');
  if (dcActivas) dcActivas.textContent = activas.length;
  if (dcTotal)   dcTotal.textContent   = totalAdeudado > 0 ? fmt(totalAdeudado) : 'todo pago';

  if (!cuotaGastos.length) {
    el.innerHTML = '<div class="panel-empty" style="padding:1rem 1.2rem">Sin gastos en cuotas registrados</div>';
    return;
  }

  let html = '<table class="panel-table">';

  if (activas.length) {
    html += '<tr><td colspan="3" class="panel-section">Activas (' + activas.length + ')</td></tr>';
    activas.forEach(r => {
      const pct = (r.adeudado / maxAdeudado * 100).toFixed(0);
      const mono = "font-family:'DM Mono',monospace";
      html += '<tr>' +
        '<td style="min-width:0">' +
          '<div style="font-size:0.82rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38vw">' + r.g.desc + '</div>' +
          '<div style="font-size:0.68rem;color:var(--text3);margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38vw">' + r.g.cat + (r.g.medio ? ' · <span style="color:var(--accent3)">' + r.g.medio + '</span>' : '') + '</div>' +
          '<div style="font-size:0.66rem;color:var(--text3)">hasta ' + r.finLabel + '</div>' +
          '<div class="bar-track" style="margin-top:4px;width:70px">' +
            '<div class="bar-fill" style="width:' + pct + '%;background:var(--accent4)"></div>' +
          '</div>' +
        '</td>' +
        '<td style="text-align:center;white-space:nowrap;width:48px">' +
          '<span style="' + mono + ';font-size:0.75rem;color:var(--text2)">' + r.cuotaActual + '/' + r.g.ncuotas + '</span>' +
          '<div style="font-size:0.62rem;color:var(--text3)">' + r.restantes + ' rest.</div>' +
        '</td>' +
        '<td style="text-align:right;white-space:nowrap">' +
          '<div style="' + mono + ';font-size:0.75rem;color:var(--accent2)">' + fmt(r.g.montoXcuota) + '/mes</div>' +
          '<div style="' + mono + ';font-size:0.68rem;color:var(--text3)">' + fmt(r.adeudado) + '</div>' +
        '</td>' +
      '</tr>';
    });
  }

  if (pagas.length) {
    html += '<tr><td colspan="3" class="panel-section">Pagadas (' + pagas.length + ')</td></tr>';
    const mono = "font-family:'DM Mono',monospace";
    pagas.forEach(r => {
      html += '<tr style="opacity:0.45">' +
        '<td><div style="font-size:0.82rem;text-decoration:line-through;color:var(--text3)">' + r.g.desc + '</div>' +
          '<div style="font-size:0.7rem;color:var(--text3)">' + r.g.cat + '</div></td>' +
        '<td style="text-align:center"><span style="' + mono + ';font-size:0.78rem;color:var(--text3)">' + r.g.ncuotas + '/' + r.g.ncuotas + ' ✓</span></td>' +
        '<td style="text-align:right;' + mono + ';font-size:0.75rem;color:var(--text3)">' + fmt(r.g.monto) + ' total</td>' +
      '</tr>';
    });
  }

  html += '</table>';
  el.innerHTML = html;
}

// ---- AHORRO ----
function addAhorro() {
  const año   = parseInt($('a-año').value);
  const mes   = $('a-mes').value;
  const monto = parseFloat($('a-monto').value);
  const moneda = $('a-moneda').value;
  const tipo  = resolveOtro('a-tipo', 'a-tipo-otro');
  const origen = $('a-origen')?.value || '';
  const notas = $('a-notas').value.trim();
  if (!año || !monto || monto <= 0) { notify('⚠ Completá año y monto'); return; }
  autoSaveNewCat(tipo, 'ahorro');
  // Key única con timestamp para no pisar registros anteriores del mismo mes
  const mesNum = String(MESES.indexOf(mes)+1).padStart(2,'0');
  const ymBase = `${año}-${mesNum}`;
  const key = `${ymBase}-${moneda}-${Date.now()}`;
  const rec = { key, ymBase, año, mes, monto, moneda, tipo, origen, notas };
  ahorros.push(rec);
  save();
  notify('Ahorro guardado');
  $('a-monto').value = '';
  $('a-notas').value = '';
  $('a-tipo').value = '';
  $('a-tipo-otro').value = '';
  $('a-tipo-otro').style.display = 'none';
  if ($('a-origen')) $('a-origen').value = '';
  renderAhorroTable();
}

function deleteAhorro(key) {
  ahorros = ahorros.filter(a => a.key !== key);
  save();
  renderAhorroTable();
  notify('Registro eliminado');
}

function toggleRendInput(key) {
  const wrap = document.getElementById('rend-wrap-' + key);
  if (!wrap) return;
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : 'flex';
  if (!visible) wrap.querySelector('input').focus();
}

function agregarRendimiento(key, signo) {
  signo = signo || 1; // 1 = sumar, -1 = restar
  const input = document.getElementById('rend-input-' + key);
  const monto = parseFloat(input.value);
  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  const idx = ahorros.findIndex(a => a.key === key);
  if (idx < 0) return;
  const ajuste = +(monto * signo).toFixed(2);
  const nuevoSaldo = +(ahorros[idx].monto + ajuste).toFixed(2);
  // Permitir saldo negativo (rendimiento negativo puede dejar el fondo en rojo)
  ahorros[idx].monto = nuevoSaldo;
  ahorros[idx].rendimientos = +((ahorros[idx].rendimientos || 0) + ajuste).toFixed(2);
  ahorros[idx].historialRendimientos = ahorros[idx].historialRendimientos || [];
  ahorros[idx].historialRendimientos.push({ monto: ajuste, fecha: new Date().toISOString().slice(0,10) });
  save();
  const s = ahorros[idx].moneda === 'USD' ? 'u$s ' : '$';
  notify(`${signo > 0 ? '+' : '−'}${s}${fmt(monto)} ${signo > 0 ? 'sumado' : 'restado'} como rendimiento`);
  input.value = '';
  renderAhorroTable();
}

function toggleEditAhorro(key) {
  const ek = key.replace(/[^a-zA-Z0-9_-]/g,'_');
  const row = document.getElementById('edit-a-' + ek);
  if (!row) return;
  row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
}

function saveEditAhorro(key) {
  const idx = ahorros.findIndex(a => a.key === key);
  if (idx < 0) return;
  const ek = key.replace(/[^a-zA-Z0-9_-]/g,'_');
  const montoBase = parseFloat(document.getElementById('ea-monto-' + key).value);
  const notas = document.getElementById('ea-notas-' + key).value.trim();
  const tipo  = document.getElementById('ea-tipo-' + key).value.trim();
  const origen = document.getElementById('ea-origen-' + ek)?.value || ahorros[idx].origen || '';
  if (isNaN(montoBase) || montoBase < 0) { notify('⚠ Monto inválido'); return; }
  const rendimientos = ahorros[idx].rendimientos || 0;
  // El saldo total = monto base editado + rendimientos acumulados (puede ser negativo)
  const montoTotal = +(montoBase + rendimientos).toFixed(2);
  ahorros[idx] = { ...ahorros[idx], monto: montoTotal, notas, tipo, origen };
  save();
  notify('Ahorro actualizado');
  renderAhorroTable();
}

function renderFondos() {
  const el = $('fondos-body');
  if (!el) return;
  if (!ahorros.length) { el.innerHTML = '<div class="empty" style="padding:1rem">Sin fondos registrados</div>'; return; }

  // Agrupar por tipo (o "Sin clasificar" si no tiene tipo)
  const grupos = {};
  ahorros.forEach(a => {
    const key = (a.tipo || 'Sin clasificar') + '|' + (a.moneda || 'ARS');
    if (!grupos[key]) grupos[key] = { tipo: a.tipo || 'Sin clasificar', moneda: a.moneda || 'ARS', items: [] };
    grupos[key].items.push(a);
  });

  const html = Object.entries(grupos).map(([gkey, g]) => {
    const s = g.moneda === 'USD' ? 'u$s ' : '$';
    const color = g.moneda === 'USD' ? 'var(--accent3)' : 'var(--accent)';
    const totalMonto = g.items.reduce((sum, a) => sum + a.monto, 0);
    const totalRend  = g.items.reduce((sum, a) => sum + (a.rendimientos || 0), 0);
    const totalBase  = g.items.reduce((sum, a) => sum + (a.monto - (a.rendimientos||0)), 0);
    const montoColor = totalMonto < 0 ? 'var(--accent2)' : color;
    const safeGkey = gkey.replace(/[^a-zA-Z0-9_-]/g, '_');

    return `
    <div style="padding:1rem 1.2rem;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="min-width:0;flex:1">
          <div style="font-size:0.85rem;font-weight:700;color:var(--text);margin-bottom:2px">${g.tipo}</div>
          <div style="font-size:0.7rem;color:var(--text3)">${g.items.length} depósito${g.items.length>1?'s':''} · ${g.moneda}</div>
          <div style="font-family:'DM Mono',monospace;font-size:1.1rem;font-weight:700;color:${montoColor};margin-top:6px">${s}${fmt(totalMonto)}</div>
          ${totalRend !== 0 ? `<div style="font-size:0.72rem;color:${totalRend>0?'#a8ffdc':'var(--accent2)'};margin-top:2px">${totalRend>0?'▲':'▼'} Rendimientos: ${totalRend>0?'+':''}${s}${Math.abs(totalRend).toLocaleString('es-AR')}</div>` : ''}
          <div style="font-size:0.68rem;color:var(--text3);margin-top:1px">Base depositada: ${s}${fmt(totalBase)}</div>
        </div>
        <button onclick="toggleFondoRend('${safeGkey}')" style="background:none;border:1px solid rgba(168,255,220,0.3);color:#a8ffdc;border-radius:10px;padding:6px 12px;font-size:0.75rem;cursor:pointer;font-family:'Sora',sans-serif;white-space:nowrap;flex-shrink:0">± Rend.</button>
      </div>

      <!-- Panel rendimiento -->
      <div id="fondo-rend-${safeGkey}" style="display:none;margin-top:10px;flex-direction:column;gap:8px">
        <input id="fondo-input-${safeGkey}" type="number" placeholder="Monto del rendimiento" min="0" step="0.01"
          style="background:var(--bg);border:1px solid var(--accent);border-radius:12px;color:var(--text);font-family:'DM Mono',monospace;font-size:0.9rem;padding:10px 14px;outline:none;width:100%;box-sizing:border-box">
        <div style="display:flex;gap:8px">
          <button onclick="aplicarRendFondo('${safeGkey}', '${g.tipo}', '${g.moneda}', 1)" style="flex:1;background:rgba(0,229,160,0.12);border:1px solid var(--accent);color:var(--accent);border-radius:12px;padding:10px;font-size:0.85rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700">+ Sumar</button>
          <button onclick="aplicarRendFondo('${safeGkey}', '${g.tipo}', '${g.moneda}', -1)" style="flex:1;background:rgba(255,79,94,0.1);border:1px solid var(--accent2);color:var(--accent2);border-radius:12px;padding:10px;font-size:0.85rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700">− Restar</button>
        </div>
      </div>

      <!-- Botón Rescatar -->
      <button onclick="toggleFondoRescate('${safeGkey}')" style="margin-top:10px;width:100%;background:rgba(59,130,246,0.1);border:1px solid var(--accent4);color:var(--accent4);border-radius:12px;padding:9px;font-size:0.85rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:600">💸 Rescatar</button>

      <!-- Panel rescate -->
      <div id="fondo-rescate-${safeGkey}" style="display:none;margin-top:8px;flex-direction:column;gap:8px;background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);border-radius:14px;padding:12px">
        <div style="font-size:0.72rem;color:var(--accent4);font-weight:700;letter-spacing:0.5px;text-transform:uppercase;margin-bottom:2px">Rescatar de: ${g.tipo}</div>
        <input id="fondo-rescate-monto-${safeGkey}" type="number" placeholder="Monto a rescatar" min="0" step="0.01" max="${totalMonto}"
          style="background:var(--bg);border:1px solid var(--accent4);border-radius:12px;color:var(--text);font-family:'DM Mono',monospace;font-size:0.9rem;padding:10px 14px;outline:none;width:100%;box-sizing:border-box">
        <div>
          <label style="font-size:0.7rem;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;display:block">Destino del dinero</label>
          <select id="fondo-rescate-destino-${safeGkey}"
            style="width:100%;background:var(--bg);border:1px solid var(--accent4);border-radius:12px;color:var(--text);font-family:'Sora',sans-serif;font-size:0.88rem;padding:10px 14px;outline:none;box-sizing:border-box">
            <option value="">Seleccionar destino...</option>
            <option value="Efectivo">💵 Efectivo</option>
            ${tarjetas.filter(t=>t.tipo==='billetera').map(t=>`<option value="${t.label||t.banco||t.nombre}">📱 ${t.label||t.banco||t.nombre}</option>`).join('')}
            ${tarjetas.filter(t=>t.tipo==='debito').map(t=>`<option value="${t.label||('CA '+t.banco)}">🏦 ${t.label||('CA '+t.banco)}</option>`).join('')}
          </select>
        </div>
        <button onclick="confirmarRescate('${safeGkey}', '${g.tipo}', '${g.moneda}')"
          style="width:100%;background:var(--accent4);border:none;color:#fff;border-radius:12px;padding:11px;font-size:0.88rem;cursor:pointer;font-family:'Sora',sans-serif;font-weight:700">✓ Confirmar rescate</button>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = html || '<div class="empty" style="padding:1rem">Sin fondos</div>';
}

function toggleFondoRend(safeGkey) {
  const wrap = document.getElementById('fondo-rend-' + safeGkey);
  if (!wrap) return;
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : 'flex';
  if (!visible) document.getElementById('fondo-input-' + safeGkey)?.focus();
}

function toggleFondoRescate(safeGkey) {
  const wrap = document.getElementById('fondo-rescate-' + safeGkey);
  if (!wrap) return;
  const visible = wrap.style.display !== 'none';
  wrap.style.display = visible ? 'none' : 'flex';
  if (!visible) document.getElementById('fondo-rescate-monto-' + safeGkey)?.focus();
}

function confirmarRescate(safeGkey, tipo, moneda) {
  const montoInput = document.getElementById('fondo-rescate-monto-' + safeGkey);
  const destinoSel = document.getElementById('fondo-rescate-destino-' + safeGkey);
  const monto = parseFloat(montoInput.value);
  const destino = destinoSel.value;

  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }
  if (!destino) { notify('⚠ Seleccioná un destino'); return; }

  // Calcular saldo total del fondo
  const items = ahorros.filter(a => (a.tipo || 'Sin clasificar') === tipo && (a.moneda || 'ARS') === moneda);
  const totalMonto = items.reduce((s, a) => s + a.monto, 0);
  if (monto > totalMonto) { notify('⚠ El monto supera el saldo del fondo'); return; }

  // Descontar del fondo proporcionalmente
  const fecha = new Date().toISOString().slice(0, 10);
  let restante = monto;
  items.forEach((item, i) => {
    const idx = ahorros.findIndex(a => a.key === item.key);
    if (idx < 0 || restante <= 0) return;
    const descuento = i < items.length - 1
      ? +Math.min(ahorros[idx].monto, +(item.monto / totalMonto * monto).toFixed(2)).toFixed(2)
      : +restante.toFixed(2);
    ahorros[idx].monto = +(ahorros[idx].monto - descuento).toFixed(2);
    ahorros[idx].rendimientos = +((ahorros[idx].rendimientos || 0) - +(descuento * ((ahorros[idx].rendimientos||0) / item.monto) || 0)).toFixed(2);
    ahorros[idx].historialRendimientos = ahorros[idx].historialRendimientos || [];
    ahorros[idx].historialRendimientos.push({ monto: -descuento, fecha, concepto: `Rescate → ${destino}` });
    restante -= descuento;
  });

  // Registrar como ingreso en la cuenta destino
  const s = moneda === 'USD' ? 'u$s ' : '$';
  const mesActual = MESES[new Date().getMonth()];
  const añoActual = new Date().getFullYear();
  const key = `${añoActual}-${String(new Date().getMonth()+1).padStart(2,'0')}-${Date.now()}`;
  ingresos.push({
    key, uid: key.replace(/[^a-zA-Z0-9_-]/g,'_'),
    año: añoActual, mes: mesActual,
    sueldo: 0, sueldoMoneda: moneda, sueldoDestino: destino,
    otros: [{ id: Date.now(), nombre: `Rescate: ${tipo}`, moneda, monto, destino }],
    totalARS: moneda === 'ARS' ? monto : 0,
    totalUSD: moneda === 'USD' ? monto : 0,
    total: moneda === 'ARS' ? monto : 0
  });

  save();
  notify(`✓ Rescate de ${s}${fmt(monto)} → ${destino} registrado`);
  montoInput.value = '';
  destinoSel.value = '';
  renderAhorroTable();
  if ($('tab-ingresos').classList.contains('active')) renderIngresosTable();
}

function aplicarRendFondo(safeGkey, tipo, moneda, signo) {
  const input = document.getElementById('fondo-input-' + safeGkey);
  const monto = parseFloat(input.value);
  if (!monto || monto <= 0) { notify('⚠ Ingresá un monto válido'); return; }

  // Encontrar todos los items de este fondo y distribuir el rendimiento proporcionalmente
  const items = ahorros.filter(a => (a.tipo || 'Sin clasificar') === tipo && (a.moneda || 'ARS') === moneda);
  if (!items.length) return;

  const totalBase = items.reduce((s, a) => s + Math.max(a.monto, 0.01), 0);
  const ajusteTotal = +(monto * signo).toFixed(2);
  const fecha = new Date().toISOString().slice(0, 10);

  // Distribuir proporcionalmente entre los items del fondo
  items.forEach((item, i) => {
    const idx = ahorros.findIndex(a => a.key === item.key);
    if (idx < 0) return;
    // Último item recibe el residuo para evitar errores de redondeo
    const proporcion = i < items.length - 1
      ? +((Math.max(item.monto, 0.01) / totalBase) * ajusteTotal).toFixed(2)
      : ajusteTotal - items.slice(0, -1).reduce((s, a) => s + +((Math.max(a.monto, 0.01) / totalBase) * ajusteTotal).toFixed(2), 0);
    ahorros[idx].monto = +(ahorros[idx].monto + proporcion).toFixed(2);
    ahorros[idx].rendimientos = +((ahorros[idx].rendimientos || 0) + proporcion).toFixed(2);
    ahorros[idx].historialRendimientos = ahorros[idx].historialRendimientos || [];
    ahorros[idx].historialRendimientos.push({ monto: proporcion, fecha });
  });

  save();
  const s = moneda === 'USD' ? 'u$s ' : '$';
  notify(`${signo > 0 ? '+' : '−'}${s}${fmt(monto)} aplicado al fondo "${tipo}"`);
  input.value = '';
  renderAhorroTable();
}

function renderAhorroTable() {
  renderFondos();
  const el = $('ahorro-table-body');
  const list = [...ahorros].sort((a,b) => {
    const ka = a.ymBase || a.key.slice(0,7);
    const kb = b.ymBase || b.key.slice(0,7);
    return kb.localeCompare(ka);
  });

  const ahorrosARS = ahorros.filter(a => (a.moneda || 'ARS') === 'ARS');
  const ahorrosUSD = ahorros.filter(a => a.moneda === 'USD');
  const totalARS = ahorrosARS.reduce((s,a) => s + a.monto, 0);
  const totalUSD = ahorrosUSD.reduce((s,a) => s + a.monto, 0);
  const promedioARS = ahorrosARS.length ? Math.round(totalARS / ahorrosARS.length) : 0;
  const mejor = ahorros.length ? ahorros.reduce((best, a) => a.monto > best.monto ? a : best, ahorros[0]) : null;

  $('a-total-ars').textContent = '$' + fmt(totalARS);
  $('a-total-usd').textContent = 'u$s ' + fmt(totalUSD);
  $('a-promedio').textContent = '$' + fmt(promedioARS);
  const sym = mejor ? (mejor.moneda === 'USD' ? 'u$s ' : '$') : '$';
  $('a-mejor').textContent = mejor ? sym + fmt(mejor.monto) : '$0';
  $('a-mejor-mes').textContent = mejor ? `${mejor.mes} ${mejor.año}` : '—';

  if (!list.length) { el.innerHTML = '<div class="empty"><div class="icon">🏦</div>Sin ahorros registrados aún</div>'; return; }

  const maxMonto = Math.max(...list.map(a => a.monto), 1);

  el.innerHTML = `<table>
    <thead><tr><th>Período</th><th>Detalle</th><th class="col-hide-mobile">Saldo</th><th class="col-hide-mobile">Rendimientos</th><th class="col-hide-mobile">Origen</th><th class="col-hide-mobile">Evolución</th><th class="col-hide-mobile">Notas</th><th></th></tr></thead>
    <tbody>
      ${list.map(a => {
        const moneda = a.moneda || 'ARS';
        const esUSD = moneda === 'USD';
        const s = esUSD ? 'u$s ' : '$';
        const color = esUSD ? 'var(--accent3)' : 'var(--accent)';
        const badge = esUSD
          ? `<span class="badge" style="background:rgba(255,209,102,0.15);color:var(--accent3)">u$s USD</span>`
          : `<span class="badge" style="background:rgba(0,229,160,0.1);color:var(--accent)">$ ARS</span>`;
        const rend = a.rendimientos || 0;
        const montoBase = +(a.monto - rend).toFixed(2);
        const rendLabel = rend !== 0
          ? `<span style="color:${rend>0?'#a8ffdc':'var(--accent2)'};font-family:'DM Mono',monospace;font-size:0.78rem">${rend>0?'+':''}${s}${fmt(rend)}</span>`
          : `<span style="color:var(--text3);font-size:0.78rem">—</span>`;
        const montoColor = a.monto < 0 ? 'var(--accent2)' : color;
        const safeKey = a.key.replace(/'/g, "\'");
        const ek = a.key.replace(/[^a-zA-Z0-9_-]/g,'_');
        const origenHtml = a.origen
          ? `<span class="badge badge-medio">${a.origen}</span>`
          : `<span style="color:var(--text3);font-size:0.78rem">—</span>`;
        return `
        <tr>
          <td style="white-space:nowrap">
            <div style="font-family:'DM Mono',monospace;color:var(--text2);font-size:0.82rem">${a.mes}</div>
            <div style="font-family:'DM Mono',monospace;color:var(--text3);font-size:0.7rem">${a.año}</div>
          </td>
          <td>
            <div>${badge}</div>
            ${a.tipo ? '<div style="font-size:0.7rem;color:var(--text3);margin-top:3px">' + a.tipo + '</div>' : ''}
            ${a.origen ? '<div style="font-size:0.7rem;color:var(--text3)">→ ' + a.origen + '</div>' : ''}
            <div style="font-family:'DM Mono',monospace;color:${montoColor};font-weight:600;font-size:0.82rem;margin-top:4px">${s}${fmt(a.monto)}</div>
            ${rend !== 0 ? `<div style="font-size:0.68rem;color:${rend>0?'#a8ffdc':'var(--accent2)'};margin-top:2px">${rend>0?'▲':'▼'} rend: ${rend>0?'+':''}${s}${Math.abs(rend).toLocaleString('es-AR')}</div>` : ''}
          </td>
          <td class="col-hide-mobile" style="font-family:'DM Mono',monospace;color:${color};font-weight:600;white-space:nowrap">${s}${fmt(a.monto)}</td>
          <td class="col-hide-mobile">
            ${rendLabel}
            <div style="margin-top:5px;display:flex;align-items:center;gap:5px">
              <button class="btn-export" style="padding:3px 9px;font-size:0.7rem;border-color:rgba(168,255,220,0.3);color:#a8ffdc" onclick="toggleRendInput('${safeKey}')">+ Rendimiento</button>
            </div>
            <div id="rend-wrap-${a.key}" style="display:none;margin-top:6px;gap:5px;align-items:center">
              <input id="rend-input-${a.key}" type="number" placeholder="ej: 1500" min="0" step="0.01"
                style="width:110px;background:var(--bg);border:1px solid var(--accent);border-radius:7px;color:var(--text);font-family:'DM Mono',monospace;font-size:0.8rem;padding:5px 8px;outline:none"
                onkeydown="if(event.key==='Enter') agregarRendimiento('${safeKey}')">
              <button class="btn-add" style="padding:4px 12px;font-size:0.75rem;border-radius:7px" onclick="agregarRendimiento('${safeKey}')">✓</button>
            </div>
          </td>
          <td class="col-hide-mobile">${origenHtml}</td>
          <td class="col-hide-mobile">
            <div class="bar-track" style="width:80px"><div class="bar-fill" style="width:${(a.monto/maxMonto*100).toFixed(1)}%;background:${color}"></div></div>
          </td>
          <td class="col-hide-mobile" style="color:var(--text3);font-size:0.78rem">${a.notas || '—'}</td>
          <td style="display:flex;gap:4px">
            <button class="btn-edit" onclick="toggleEditAhorro('${safeKey}')">✏</button>
            <button class="btn-del" onclick="deleteAhorro('${safeKey}')">✕</button>
          </td>
        </tr>
        <tr id="edit-a-${ek}" class="edit-row" style="display:none">
          <td colspan="8" style="padding:12px 14px !important">
            <div class="edit-panel-header">🏦 ${a.mes} ${a.año} · ${moneda}${rend > 0 ? ' · +' + s + fmt(rend) + ' rend.' : ''}</div>
            <div class="edit-panel-body">
              <input class="edit-input" id="ea-monto-${a.key}" type="number" value="${montoBase}" placeholder="Monto base">
              <select id="ea-origen-${ek}" class="edit-input">
                <option value="">Sin origen</option>
                <option value="Efectivo" ${(a.origen||'')==='Efectivo'?'selected':''}>Efectivo</option>
                ${tarjetas.filter(t=>t.tipo==='billetera').map(t=>`<option value="${t.label||t.banco||t.nombre}" ${(a.origen||'')===(t.label||t.banco||t.nombre)?'selected':''}>${t.label||t.banco||t.nombre}</option>`).join('')}
                ${tarjetas.filter(t=>t.tipo==='debito').map(t=>`<option value="${t.label||('Débito '+t.banco)}" ${(a.origen||'')===(t.label||('Débito '+t.banco))?'selected':''}>${t.label||('Débito '+t.banco)}</option>`).join('')}
                ${(a.origen && a.origen !== 'Efectivo' && !tarjetas.some(t=>t.tipo!=='credito'&&((t.label||t.banco||t.nombre)===a.origen||(t.label||('Débito '+t.banco))===a.origen))) ? `<option value="${a.origen}" selected>${a.origen}</option>` : ''}
              </select>
              <input class="edit-input" id="ea-tipo-${a.key}" type="text" value="${a.tipo||''}" placeholder="Dónde guardás">
              <input class="edit-input" id="ea-notas-${a.key}" type="text" value="${a.notas||''}" placeholder="Notas (opcional)">
              <button class="btn-save edit-panel-save" onclick="saveEditAhorro('${a.key}')">✓ Guardar</button>
            </div>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}


// ---- EXPORT / IMPORT ----
function exportData() {
  const data = { gastos, ingresos, ahorros, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const fecha = new Date().toISOString().slice(0,10);
  a.href = url;
  a.download = `mis-finanzas-${fecha}.json`;
  a.click();
  URL.revokeObjectURL(url);
  notify('Datos exportados correctamente');
}

let pendingImportData = null;

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.gastos || !data.ingresos) throw new Error('Formato inválido');
      pendingImportData = data;
      $('import-modal').classList.add('show');
    } catch {
      notify('⚠ El archivo no es válido');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function confirmImport() {
  if (!pendingImportData) return;
  gastos = pendingImportData.gastos;
  ingresos = pendingImportData.ingresos;
  ahorros = pendingImportData.ahorros || [];
  save();
  pendingImportData = null;
  $('import-modal').classList.remove('show');
  notify('Datos importados correctamente');
  renderDashboard();
}

function cancelImport() {
  pendingImportData = null;
  $('import-modal').classList.remove('show');
}

// ---- AUTH UI ----
let authMode = 'login'; // 'login' | 'register'

// ---- DIAGNÓSTICO ADMIN ----
async function diagUsuario(uid, email) {
  const el = $('diag-result');
  if (!uid) { el.textContent = '❌ No hay usuario logueado'; return; }
  el.textContent = '⏳ Leyendo Firestore...';
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    if (!snap.exists()) {
      el.textContent = '⚠️ No existe documento en Firestore para este usuario.';
      return;
    }
    const d = snap.data();
    const lines = [
      `👤 Usuario: ${email}`,
      `📅 Última actualización: ${d.updatedAt || '(sin fecha)'}`,
      `💸 Gastos: ${(d.gastos||[]).length} registros`,
      `💵 Ingresos: ${(d.ingresos||[]).length} registros`,
      `🏦 Ahorros: ${(d.ahorros||[]).length} registros`,
      `📝 Memos/Pendientes: ${(d.pendientes||[]).length} registros`,
      `💳 Tarjetas: ${(d.tarjetas||[]).length} registros`,
      `💡 Conceptos guardados: ${(d.conceptosGuardados||[]).length} registros`,
      ``,
      `🔑 Campos presentes en Firestore:`,
      Object.keys(d).map(k => `  • ${k}: ${JSON.stringify(d[k]).slice(0,60)}`).join('\n'),
    ];
    el.textContent = lines.join('\n');

    // Si hay pendientes en Firestore, recargarlos
    if (Array.isArray(d.pendientes) && d.pendientes.length > 0) {
      pendientes = d.pendientes;
      renderPendientesTab();
      el.textContent += '\n\n✅ Memos recargados desde Firestore (' + d.pendientes.length + ' ítems).';
    }
  } catch(e) {
    el.textContent = '❌ Error: ' + e.message;
  }
}

async function verFirestoreRaw() {
  const el = $('diag-raw');
  const uid = window._currentUser?.uid;
  if (!uid) { el.textContent = '❌ Sin usuario'; el.style.display = 'block'; return; }
  el.textContent = '⏳ Cargando...';
  el.style.display = 'block';
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'usuarios', uid));
    if (!snap.exists()) { el.textContent = '⚠️ Sin documento'; return; }
    const d = snap.data();
    // Mostrar solo pendientes y metadata para no saturar
    el.textContent = JSON.stringify({
      updatedAt: d.updatedAt,
      pendientesCount: (d.pendientes||[]).length,
      pendientes: d.pendientes || [],
      gastosCount: (d.gastos||[]).length,
      ingresosCount: (d.ingresos||[]).length,
      ahorrosCount: (d.ahorros||[]).length,
    }, null, 2);
  } catch(e) {
    el.textContent = '❌ Error: ' + e.message;
  }
}

function recuperarPendientes() {
  const el = $('diag-result');
  const local = JSON.parse(localStorage.getItem('gf_pendientes') || '[]');
  if (!local.length) {
    el.textContent = '⚠️ No hay memos en localStorage de este dispositivo.';
    return;
  }
  if (!confirm(`¿Restaurar ${local.length} memo(s) desde este dispositivo? Esto va a AGREGAR los memos al array actual (no reemplazar).`)) return;
  // Agregar sin duplicar por id
  const existingIds = new Set(pendientes.map(p => p.id));
  const nuevos = local.filter(p => !existingIds.has(p.id));
  pendientes = [...pendientes, ...nuevos];
  save();
  renderPendientesTab();
  el.textContent = `✅ Recuperados ${nuevos.length} memo(s) desde localStorage y guardados en Firestore.`;
  notify(`${nuevos.length} memos recuperados`);
}

window.toggleAuthMode = function() {
  authMode = authMode === 'login' ? 'register' : 'login';
  const isReg = authMode === 'register';
  $('auth-subtitle').textContent = isReg ? 'Creá tu cuenta' : 'Ingresá con tu cuenta';
  $('auth-btn').textContent = isReg ? 'Registrarme' : 'Ingresar';
  $('auth-toggle').innerHTML = isReg
    ? '¿Ya tenés cuenta? <span onclick="window.toggleAuthMode()">Iniciá sesión</span>'
    : '¿No tenés cuenta? <span onclick="window.toggleAuthMode()">Registrate</span>';
  $('auth-pass2-wrap').style.display = isReg ? 'block' : 'none';
  $('auth-reset-wrap').style.display = isReg ? 'none' : 'block';
  $('auth-error').style.display = 'none';
};

window.resetPassword = async function() {
  const email = $('auth-email').value.trim();
  const errEl = $('auth-error');
  errEl.style.display = 'none';
  if (!email) {
    errEl.textContent = 'Escribí tu email primero';
    errEl.style.display = 'block';
    return;
  }
  try {
    await window._fbResetPassword(window._fbAuth, email);
    errEl.style.background = 'rgba(0,229,160,0.1)';
    errEl.style.borderColor = 'rgba(0,229,160,0.3)';
    errEl.style.color = 'var(--accent)';
    errEl.textContent = '✓ Te mandamos un email para restablecer tu contraseña';
    errEl.style.display = 'block';
  } catch(e) {
    errEl.style.background = 'rgba(255,107,107,0.1)';
    errEl.style.borderColor = 'rgba(255,107,107,0.3)';
    errEl.style.color = 'var(--accent2)';
    const msgs = {
      'auth/user-not-found': 'No existe una cuenta con ese email',
      'auth/invalid-email': 'Email inválido',
    };
    errEl.textContent = msgs[e.code] || 'Error al enviar el email';
    errEl.style.display = 'block';
  }
};

window.authAction = async function() {
  const email = $('auth-email').value.trim();
  const pass  = $('auth-pass').value;
  const pass2 = $('auth-pass2').value;
  const errEl = $('auth-error');
  errEl.style.display = 'none';

  if (!email || !pass) { errEl.textContent = 'Completá email y contraseña'; errEl.style.display = 'block'; return; }

  const msgs = {
    'auth/user-not-found': 'Usuario no encontrado',
    'auth/wrong-password': 'Contraseña incorrecta',
    'auth/invalid-credential': 'Email o contraseña incorrectos',
    'auth/email-already-in-use': 'Ese email ya está registrado',
    'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres',
    'auth/invalid-email': 'Email inválido',
  };

  try {
    if (authMode === 'register') {
      if (pass !== pass2) { errEl.textContent = 'Las contraseñas no coinciden'; errEl.style.display = 'block'; return; }
      if (pass.length < 6) { errEl.textContent = 'La contraseña debe tener al menos 6 caracteres'; errEl.style.display = 'block'; return; }
      // Verificar si el email está habilitado (admin siempre puede)
      if (email !== 'pachadofran@gmail.com') {
        const habilitado = await checkEmailHabilitado(email);
        if (!habilitado) {
          const waMsg = encodeURIComponent('Hola! Quiero solicitar acceso a Mis Finanzas. Mi email es: ' + email);
          errEl.innerHTML = '⚠ Este email no está habilitado para registrarse.<br><br>' +
            '<a href="https://wa.me/542995075494?text=' + waMsg + '" target="_blank" ' +
            'style="display:inline-flex;align-items:center;gap:8px;background:#25D366;color:#fff;' +
            'border-radius:9px;padding:10px 18px;font-weight:700;font-size:0.85rem;text-decoration:none;margin-top:4px">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>' +
            'Pedir acceso por WhatsApp</a>';
          errEl.style.display = 'block';
          return;
        }
      }
      await window._fbCreateUser(window._fbAuth, email, pass);
    } else {
      await window._fbSignIn(window._fbAuth, email, pass);
    }
  } catch(e) {
    errEl.textContent = msgs[e.code] || 'Error: ' + e.message;
    errEl.style.display = 'block';
  }
};

window.doLogout = async function() {
  await window._fbSignOut(window._fbAuth);
  gastos = []; ingresos = []; ahorros = [];
  pendientes = []; tarjetas = []; saldosIniciales = {};
  conceptosGuardados = []; otrosPendientes = []; ajustesCuentas = [];
  localStorage.removeItem('gf_pendientes');
  localStorage.removeItem('gf_tarjetas');
};

// Limpia ingresos/gastos generados por ajustes manuales viejos
window.limpiarAjustesViejos = function() {
  const antesI = ingresos.length;
  const antesG = gastos.length;
  ingresos = ingresos.filter(i => {
    const esAjuste =
      (i.key && i.key.startsWith('ajuste-')) ||
      i.sueldoConcepto === 'Ajuste' ||
      (i.otros||[]).some(o => o.nombre === 'Ajuste manual de saldo') ||
      (i.otros||[]).some(o => o.nombre && o.nombre.toLowerCase().includes('ajuste'));
    return !esAjuste;
  });
  gastos = gastos.filter(g => g.desc !== 'Ajuste manual de saldo' && g.cat !== 'Ajuste');
  const eliminadosI = antesI - ingresos.length;
  const eliminadosG = antesG - gastos.length;
  if (eliminadosI + eliminadosG === 0) { notify('No se encontraron ajustes viejos para eliminar'); return; }
  save();
  notify(`✓ Eliminados ${eliminadosI} ingreso(s) y ${eliminadosG} gasto(s) de ajuste`);
  renderSaldoCuentas();
  renderIngresosTable();
};


// ---- PENDIENTES ----
function savePendientes() {
  localStorage.setItem('gf_pendientes', JSON.stringify(pendientes));
  save(); // sincronizar con Firestore
}

function addPendiente() {
  const desc  = $('p-desc').value.trim();
  const monto = parseFloat($('p-monto').value) || 0;
  const vence = $('p-vence').value;
  const prio  = $('p-prio').value;
  if (!desc) { notify('⚠ Escribí un concepto'); return; }
  pendientes.push({ id: Date.now(), desc, monto, vence, prio, done: false, creadoEn: new Date().toISOString() });
  savePendientes();
  $('p-desc').value = '';
  $('p-monto').value = '';
  $('p-vence').value = '';
  $('p-prio').value = 'normal';
  notify('Pendiente agregado');
  renderPendientesTab();
}

function togglePendiente(id) {
  const idx = pendientes.findIndex(p => p.id === id);
  if (idx < 0) return;
  pendientes[idx].done = !pendientes[idx].done;
  savePendientes();
  renderPendientesTab();
}

function deletePendiente(id) {
  pendientes = pendientes.filter(p => p.id !== id);
  savePendientes();
  renderPendientesTab();
}

function limpiarCompletados() {
  pendientes = pendientes.filter(p => !p.done);
  savePendientes();
  notify('Completados eliminados');
  renderPendientesTab();
}

function setPendienteFiltro(filtro, el) {
  pendienteFiltro = filtro;
  document.querySelectorAll('[id^="pf-"]').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  renderPendientesTab();
}

function renderPendientesTab() {
  const hoy = new Date().toISOString().slice(0, 10);
  const total_pendientes = pendientes.filter(p => !p.done).length;
  const total_done       = pendientes.filter(p => p.done).length;
  const total_monto      = pendientes.filter(p => !p.done).reduce((s, p) => s + p.monto, 0);
  const total_vencidos   = pendientes.filter(p => !p.done && p.vence && p.vence <= hoy).length;

  $('p-count').textContent = total_pendientes;
  $('p-done').textContent  = total_done;
  $('p-total').textContent = '$' + fmt(total_monto);
  $('p-vencidos').textContent = total_vencidos;

  let lista = [...pendientes];
  if (pendienteFiltro === 'pendientes')  lista = lista.filter(p => !p.done);
  if (pendienteFiltro === 'completados') lista = lista.filter(p => p.done);
  if (pendienteFiltro === 'alta')        lista = lista.filter(p => p.prio === 'alta' && !p.done);

  // Ordenar: alta prio primero, luego por vencimiento, luego por creación
  lista.sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const prioVal = { alta: 0, normal: 1, baja: 2 };
    if (prioVal[a.prio] !== prioVal[b.prio]) return prioVal[a.prio] - prioVal[b.prio];
    if (a.vence && b.vence) return a.vence.localeCompare(b.vence);
    if (a.vence) return -1;
    if (b.vence) return 1;
    return b.id - a.id;
  });

  const el = $('pendientes-list');
  if (!lista.length) {
    el.innerHTML = '<div class="empty"><div class="icon">📋</div>No hay items para mostrar</div>';
    return;
  }

  const prioPretty = { alta: '🔴 Alta', normal: '🔵 Normal', baja: '⚪ Baja' };
  const MESES_CORTO = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

  function fmtVence(v) {
    if (!v) return '';
    const [y, m, d] = v.split('-');
    return `${d} ${MESES_CORTO[parseInt(m)-1]} ${y}`;
  }

  el.innerHTML = lista.map(p => {
    const vencido = !p.done && p.vence && p.vence < hoy;
    const venceHoy = !p.done && p.vence && p.vence === hoy;
    let venceLabel = '';
    if (p.vence) {
      if (vencido) venceLabel = `<span class="p-vence vencido">⚠ Vencido: ${fmtVence(p.vence)}</span>`;
      else if (venceHoy) venceLabel = `<span class="p-vence vencido">⏰ Vence hoy</span>`;
      else venceLabel = `<span class="p-vence">📅 ${fmtVence(p.vence)}</span>`;
    }
    return `
    <div class="p-item prio-${p.prio} ${p.done ? 'done' : ''} ${(vencido || venceHoy) ? 'vencido' : ''}">
      <input type="checkbox" class="p-check" ${p.done ? 'checked' : ''} onchange="togglePendiente(${p.id})">
      <div class="p-body">
        <div class="p-desc">${p.desc}</div>
        <div class="p-meta">
          ${p.monto > 0 ? `<span class="p-monto">$${fmt(p.monto)}</span>` : ''}
          ${p.cat ? `<span class="badge badge-cat" style="font-size:0.65rem">${p.cat}</span>` : ''}
          ${venceLabel}
          <span class="prio-badge">${prioPretty[p.prio]}</span>
        </div>
      </div>
      <button class="btn-del" onclick="deletePendiente(${p.id})" title="Eliminar">✕</button>
    </div>`;
  }).join('');
}

// ---- CATEGORÍAS DINÁMICAS ----
const CATS_DEFAULT = {
  gastos:     ['Alimentación','Transporte','Vivienda/Alquiler','Servicios (luz/gas/agua)','Internet/Telefonía','Ropa/Calzado','Salud/Farmacia','Educación','Entretenimiento','Restaurantes/Delivery','Viajes','Cuidado personal','Mascotas','Ahorro/Inversión','Cuota préstamo'],
  ahorro:     ['Efectivo','Caja de ahorro','Plazo fijo','Dólar','Crypto','Fondo común','Acciones'],
  pendientes: ['Alimentación','Transporte','Vivienda/Alquiler','Servicios (luz/gas/agua)','Internet/Telefonía','Ropa/Calzado','Salud/Farmacia','Educación','Entretenimiento','Restaurantes/Delivery','Tarjetas/Cuotas','Impuestos']
};

let cats = {
  gastos:     JSON.parse(localStorage.getItem('gf_cats_gastos')     || 'null') || [...CATS_DEFAULT.gastos],
  ahorro:     JSON.parse(localStorage.getItem('gf_cats_ahorro')     || 'null') || [...CATS_DEFAULT.ahorro],
  pendientes: JSON.parse(localStorage.getItem('gf_cats_pendientes') || 'null') || [...CATS_DEFAULT.pendientes]
};

function saveCats(tipo) {
  localStorage.setItem('gf_cats_' + tipo, JSON.stringify(cats[tipo]));
}

// Poblar un select con las categorías del tipo dado
function populateCatSelect(selectId, tipo, withBlank = true, extraOpts = []) {
  const sel = document.getElementById(selectId);
  if (!sel) return;
  const prev = sel.value;
  const blanks = withBlank ? ['<option value="">Seleccionar...</option>'] : ['<option value="">Sin categoría</option>'];
  sel.innerHTML = blanks.join('') +
    cats[tipo].map(c => `<option${prev === c ? ' selected' : ''}>${c}</option>`).join('') +
    extraOpts.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
}

// Inicializar todos los selects de categorías
function initCatSelects() {
  populateCatSelect('g-cat', 'gastos');
  populateCatSelect('a-tipo', 'ahorro');
}

// Cuando se elige una opción: si es "Nueva categoría..." abre campo texto
function onCatSelect(selectId, inputId, tipo) {
  const sel = document.getElementById(selectId);
  const inp = document.getElementById(inputId);
  if (sel.value === '__nueva__') {
    inp.style.display = 'block';
    inp.value = '';
    inp.focus();
  } else {
    inp.style.display = 'none';
    inp.value = '';
  }
}

// Guardar categoría nueva al salir del input
function saveNewCat(selectId, inputId, tipo) {
  const inp = document.getElementById(inputId);
  const nombre = inp.value.trim();
  if (!nombre || cats[tipo].includes(nombre)) return;
  cats[tipo].push(nombre);
  saveCats(tipo);
  populateCatSelect(selectId, tipo);
  document.getElementById(selectId).value = nombre;
  inp.style.display = 'none';
  inp.value = '';
}

// ---- MODAL CATEGORÍAS ----
let _catModalTipo = '';

function openCatModal(tipo) {
  _catModalTipo = tipo;
  const titles = { gastos: '⚙ Categorías de Gastos', ahorro: '⚙ Categorías de Ahorro', pendientes: '⚙ Categorías de Pendientes' };
  $('cat-modal-title').textContent = titles[tipo] || 'Categorías';
  $('cat-modal-input').value = '';
  renderCatModalList();
  $('cat-modal').classList.add('show');
  setTimeout(() => $('cat-modal-input').focus(), 80);
}

function closeCatModal() {
  $('cat-modal').classList.remove('show');
  // Refrescar todos los selects
  initCatSelects();
}

function addCatFromModal() {
  const inp = $('cat-modal-input');
  const nombre = inp.value.trim();
  if (!nombre) return;
  if (cats[_catModalTipo].includes(nombre)) { notify('Ya existe esa categoría'); return; }
  cats[_catModalTipo].push(nombre);
  saveCats(_catModalTipo);
  inp.value = '';
  renderCatModalList();
  notify('Categoría agregada');
}

function deleteCatFromModal(nombre) {
  if (!confirm(`¿Eliminar "${nombre}"? Los registros que la usen la conservan.`)) return;
  cats[_catModalTipo] = cats[_catModalTipo].filter(c => c !== nombre);
  saveCats(_catModalTipo);
  renderCatModalList();
}

function startEditCat(idx) {
  // Convertir ítem a modo edición
  const item = document.getElementById('cat-item-' + idx);
  const nombre = cats[_catModalTipo][idx];
  item.innerHTML = `
    <input type="text" value="${nombre}" id="cat-edit-inp-${idx}"
      style="flex:1;background:var(--bg);border:1px solid var(--accent);border-radius:6px;color:var(--text);font-family:'Sora',sans-serif;font-size:0.82rem;padding:6px 10px;outline:none"
      onkeydown="if(event.key==='Enter')confirmEditCat(${idx});if(event.key==='Escape')renderCatModalList()">
    <button onclick="confirmEditCat(${idx})" style="background:var(--accent);border:none;border-radius:6px;color:#0d0f14;font-size:0.75rem;font-weight:700;padding:6px 12px;cursor:pointer">✓</button>
    <button onclick="renderCatModalList()" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--text3);font-size:0.75rem;padding:6px 10px;cursor:pointer">✕</button>`;
  document.getElementById('cat-edit-inp-' + idx).focus();
}

function confirmEditCat(idx) {
  const inp = document.getElementById('cat-edit-inp-' + idx);
  const nuevo = inp.value.trim();
  if (!nuevo) return;
  const viejo = cats[_catModalTipo][idx];
  if (nuevo === viejo) { renderCatModalList(); return; }
  if (cats[_catModalTipo].includes(nuevo)) { notify('Ya existe esa categoría'); return; }
  // Actualizar en registros existentes
  if (_catModalTipo === 'gastos')     gastos.forEach(g => { if (g.cat === viejo) g.cat = nuevo; });
  if (_catModalTipo === 'ahorro')     ahorros.forEach(a => { if (a.tipo === viejo) a.tipo = nuevo; });
  if (_catModalTipo === 'pendientes') pendientes.forEach(p => { if (p.cat === viejo) p.cat = nuevo; });
  cats[_catModalTipo][idx] = nuevo;
  saveCats(_catModalTipo);
  save();
  renderCatModalList();
  notify('Categoría renombrada');
}

function renderCatModalList() {
  const el = $('cat-modal-list');
  const lista = cats[_catModalTipo];
  if (!lista.length) { el.innerHTML = '<div style="color:var(--text3);font-size:0.82rem;padding:0.5rem">Sin categorías</div>'; return; }
  el.innerHTML = lista.map((c, i) =>
    '<div id="cat-item-' + i + '" style="display:flex;align-items:center;gap:8px;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:8px 12px">' +
      '<span style="flex:1;font-size:0.85rem;color:var(--text)">' + c + '</span>' +
      '<button onclick="startEditCat(' + i + ')" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--accent4);font-size:0.72rem;padding:4px 9px;cursor:pointer">✏ Editar</button>' +
      '<button data-idx="' + i + '" onclick="deleteCatFromModal(cats[_catModalTipo][this.dataset.idx])" style="background:none;border:1px solid var(--border);border-radius:6px;color:var(--accent2);font-size:0.72rem;padding:4px 9px;cursor:pointer">✕</button>' +
    '</div>'
  ).join('');
}

// ---- ADMIN ----
const ADMIN_EMAIL = 'pachadofran@gmail.com';
const ADMIN_DOC   = 'config/habilitados';

async function checkEmailHabilitado(email) {
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'config', 'habilitados'));
    if (!snap.exists()) return false;
    const lista = snap.data().emails || [];
    return lista.map(e => e.toLowerCase()).includes(email.toLowerCase());
  } catch(e) { return false; }
}

async function addEmailHabilitado() {
  const inp = $('admin-email-input');
  const email = inp.value.trim().toLowerCase();
  if (!email || !email.includes('@')) { notify('⚠ Email inválido'); return; }
  try {
    const ref = window._fbDoc(window._fbDb, 'config', 'habilitados');
    const snap = await window._fbGetDoc(ref);
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    if (lista.map(e => e.toLowerCase()).includes(email)) { notify('Ya está habilitado'); return; }
    lista.push(email);
    await window._fbSetDoc(ref, { emails: lista });
    inp.value = '';
    notify('✓ Email habilitado: ' + email);
    renderAdminPanel();
  } catch(e) { notify('Error: ' + e.message); }
}

async function removeEmailHabilitado(email) {
  if (!confirm('¿Deshabilitar ' + email + '?')) return;
  try {
    const ref = window._fbDoc(window._fbDb, 'config', 'habilitados');
    const snap = await window._fbGetDoc(ref);
    const lista = (snap.data().emails || []).filter(e => e.toLowerCase() !== email.toLowerCase());
    await window._fbSetDoc(ref, { emails: lista });
    notify('Email deshabilitado');
    renderAdminPanel();
  } catch(e) { notify('Error: ' + e.message); }
}

async function renderAdminPanel() {
  const el = $('admin-email-list');
  el.innerHTML = '<div class="panel-empty">Cargando...</div>';
  try {
    const snap = await window._fbGetDoc(window._fbDoc(window._fbDb, 'config', 'habilitados'));
    const lista = snap.exists() ? (snap.data().emails || []) : [];
    $('admin-count').textContent = lista.length;
    if (!lista.length) {
      el.innerHTML = '<div class="panel-empty">Sin emails habilitados aún. Cualquier persona puede intentar registrarse pero será rechazada.</div>';
      return;
    }
    el.innerHTML = '<table class="panel-table"><tbody>' +
      lista.map(email =>
        '<tr>' +
          '<td style="font-size:0.85rem">' + email + '</td>' +
          '<td style="text-align:right">' +
            '<button class="btn-del" onclick="removeEmailHabilitado(\'' + email + '\')">✕ Deshabilitar</button>' +
          '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table>';
  } catch(e) { notify('Error: ' + e.message); }
}
