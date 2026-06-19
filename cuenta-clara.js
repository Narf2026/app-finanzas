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
    const snap = await window._fbGetDoc(refInv);
    if (snap.exists()) {
      const grupos = (snap.data().grupos || []).filter(g => g.grupoId !== grupoId);
      await window._fbSetDoc(refInv, { grupos }, { merge: false });
    }
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
