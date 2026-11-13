/* ==========================================================================
   ELDOSTORE CRM — Interfaz (ui.js) — versión Supabase
   Actualización 002: modalidad de venta (propia / revendedor) con comisión
   por línea, resumen separado por modalidad, y botones Anular / Corregir en
   ventas, compras y gastos.

   Las funciones que solo MUESTRAN datos (render*) leen la caché local DB.*
   y son sincrónicas, igual que antes.

   Las funciones que GUARDAN datos (save*, handle*, register*) ahora usan
   await porque escriben directo en Supabase. Todas están envueltas en
   try/catch para mostrar un error claro si falla la conexión o si Supabase
   rechaza la operación (por ejemplo, stock insuficiente).

   Actualización 003: si la migración de tres cuentas está aplicada, se agregan
   la cuenta (dueño) y quién tiene el dinero en cada operación, el reparto de
   gastos, los movimientos entre cuentas y la pantalla "Cuentas". Los elementos
   del HTML con la clase "solo-cuentas" solo se ven en ese modo.
   ========================================================================== */

const CATEGORIAS = ['Electrónica', 'Celulares', 'Smart TV', 'Electrodomésticos', 'Herramientas', 'Accesorios', 'Hogar', 'Variados'];
/* Categorías para elegir: las de "Tienda online → Categorías" (migración 005);
   si no está instalada, la lista fija de siempre. Incluye la actual del producto. */
function listaCategorias(actual) {
  const base = (typeof PROMOS !== 'undefined' && PROMOS.disponible && PROMOS.categorias.length)
    ? PROMOS.categorias.map(c => c.nombre) : CATEGORIAS.slice();
  if (actual && !base.includes(actual)) base.push(actual);
  return base;
}

function fmt(n) { return '$' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 }); }
/* Escapa texto para mostrarlo dentro de HTML (nombres, motivos, notas). */
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function fmtDate(iso) { return new Date(iso).toLocaleDateString('es-AR') + ' ' + new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); }

function showError(err) {
  console.error(err);
  showToast(typeof err === 'string' ? err : (err.message || 'Ocurrió un error. Revisá tu conexión.'));
}

/* ---------------------------- LOGIN / BOOT ------------------------------ */

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  if (!email || !pass) { errEl.textContent = 'Completá email y contraseña.'; return; }

  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Ingresando...';
  const r = await login(email, pass);
  btn.disabled = false; btn.textContent = 'Ingresar';

  if (!r.ok) { errEl.textContent = r.error; return; }

  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('visible');
  await boot();
}

document.addEventListener('DOMContentLoaded', async () => {
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') handleLogin(); });
  document.getElementById('loginEmail').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('loginPass').focus(); });

  const logueado = await isLoggedIn();
  if (logueado) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').classList.add('visible');
    await boot();
  }
});

async function boot() {
  const titleEl = document.getElementById('viewTitle');
  if (titleEl) titleEl.textContent = 'Cargando datos...';
  try {
    await refreshAll();
    const seed = await seedRealInventoryIfNeeded();
    if (seed && seed.cargados > 0) showToast(`Inventario real cargado: ${seed.cargados} productos.`);
  } catch (e) {
    showError(e);
    document.querySelector('.content').innerHTML = `<div class="panel"><h3 style="color:var(--red)">No se pudo conectar con Supabase</h3>
      <p style="color:var(--muted)">Revisá que la URL y la clave en js/supabase-config.js sean correctas, que hayas corrido el script SQL completo, y tu conexión a internet.</p>
      <p style="color:var(--muted);margin-top:10px">Detalle técnico: ${e.message || e}</p></div>`;
    return;
  }

  if (CUENTAS.activa && !CUENTAS.habilitado) {
    document.querySelector('.content').innerHTML = `<div class="panel"><h3 style="color:var(--red)">Tu usuario no está habilitado</h3>
      <p style="color:var(--muted)">El panel ya trabaja con tres cuentas (ELDOSTORE, Niko y Ayelen) y tu usuario todavía no fue vinculado.
      Pedile al administrador (Diego) que te autorice en <strong>Configuración → Usuarios del panel</strong>.</p></div>`;
    return;
  }
  document.body.classList.toggle('modo-cuentas', modoCuentas());
  document.body.classList.toggle('modo-promos', PROMOS.disponible);
  mostrarAvisosDeLectura();

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });
  populateCategorySelects();
  switchView('dashboard');
}

/* Avisa si alguna tabla no se pudo leer completa (no debería pasar con la lectura paginada). */
function mostrarAvisosDeLectura() {
  const el = document.getElementById('avisoLectura');
  if (!el) return;
  el.innerHTML = LECTURA.incompletas.length
    ? `<div class="notice">Atención: no se pudieron leer todas las filas de ${LECTURA.incompletas.join(', ')}. Los totales de esas secciones pueden estar incompletos. Recargá la página.</div>`
    : '';
}

function switchView(view) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.toggle('active', i.dataset.view === view));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
  document.getElementById('sidebar').classList.remove('open');
  const titles = {
    dashboard: 'Dashboard', productos: 'Productos / Inventario', clientes: 'Clientes', pedidos: 'Pedidos',
    ventas: 'Ventas', compras: 'Compras', gastos: 'Gastos', caja: 'Caja', envios: 'Envíos',
    reportes: 'Reportes', config: 'Configuración', cuentas: 'Cuentas', tienda: 'Tienda online'
  };
  document.getElementById('viewTitle').textContent = titles[view] || '';
  const renderers = {
    dashboard: renderDashboard, productos: renderProducts, clientes: renderClients, pedidos: renderOrders,
    ventas: renderSales, compras: renderPurchases, gastos: renderExpenses, caja: renderCash, envios: renderShipments,
    reportes: renderReportes, cuentas: renderCuentas, config: renderConfig, tienda: renderTienda
  };
  if (renderers[view]) renderers[view]();
}

function populateCategorySelects() {
  const filt = document.getElementById('prodCatFilter');
  filt.innerHTML = '<option value="">Todas las categorías</option>';
  listaCategorias().forEach(c => { const o = document.createElement('option'); o.value = c; o.textContent = c; filt.appendChild(o); });
  const est = document.getElementById('pedEstadoFilter');
  est.innerHTML = '<option value="">Todos los estados</option>';
  ESTADOS_PEDIDO.forEach(e => { const o = document.createElement('option'); o.value = e; o.textContent = e; est.appendChild(o); });
  if (modoCuentas()) {
    document.getElementById('prodOwnerFilter').innerHTML = accountOptions(null, { todas: true });
    document.getElementById('cajaCuentaFilter').innerHTML = accountOptions(null, { todas: true });
    document.getElementById('cajaHolderFilter').innerHTML = holderOptions(null, { todos: true });
    document.getElementById('repCuenta').innerHTML = accountOptions(null, { todas: true });
  }
}

/* ------------------------------- MODAL ----------------------------------- */

function openModal(html, wide = false) {
  document.getElementById('modalBody').classList.toggle('wide', wide);
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('modalBg').classList.add('open');
}
function closeModal() { document.getElementById('modalBg').classList.remove('open'); }
document.getElementById('modalBg')?.addEventListener('click', e => { if (e.target.id === 'modalBg') closeModal(); });

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.style.display = 'none', 3200);
}

function clientOptions(selectedId) {
  return '<option value="">Sin cliente / consumidor final</option>' + DB.clients.map(c =>
    `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>${c.nombre}</option>`).join('');
}
function accountOptions(selectedId, { todas = false, vacia = '' } = {}) {
  return (todas ? '<option value="">Todas las cuentas</option>' : '') + (vacia ? `<option value="">${vacia}</option>` : '') +
    CUENTAS.accounts.filter(a => a.activo).map(a => `<option value="${a.id}" ${a.id === selectedId ? 'selected' : ''}>${esc(a.nombre)}</option>`).join('');
}
function holderOptions(selectedId, { todos = false, vacia = '' } = {}) {
  return (todos ? '<option value="">Todas las personas</option>' : '') + (vacia ? `<option value="">${vacia}</option>` : '') +
    CUENTAS.holders.filter(h => h.activo).map(h => `<option value="${h.id}" ${h.id === selectedId ? 'selected' : ''}>${esc(h.nombre)}</option>`).join('');
}
function cuentaBadge(accountId) {
  const a = CUENTAS.accounts.find(x => x.id === accountId);
  const cls = !a ? '' : a.codigo === 'eldostore' ? 'badge-cta-eldo' : a.codigo === 'niko' ? 'badge-cta-niko' : 'badge-cta-aye';
  return `<span class="badge badge-cta ${cls}">${esc(a ? a.nombre : '—')}</span>`;
}

function productOptions(selectedId) {
  return DB.products.map(p =>
    `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.codigo} — ${p.nombre} (stock: ${p.stock})</option>`).join('');
}

/* ============================== DASHBOARD ================================ */

function renderDashboard() {
  const d = dashboardData();
  const kpis = [
    ['Productos', d.cantidadProductos, ''],
    ['Unidades en stock', d.unidadesStock, ''],
    ['Valor de inventario', fmt(d.valorInventario), 'gold'],
    ['Pedidos pendientes', d.pedidosPendientes, d.pedidosPendientes > 0 ? 'red' : ''],
    ['Ventas de hoy', fmt(d.ventasHoyTotal), 'green'],
    ['Ventas del mes', fmt(d.ventasMesTotal), 'green'],
    ['Ganancia bruta de hoy', fmt(d.gananciaHoy), 'gold'],
    ['Ganancia bruta del mes', fmt(d.gananciaMes), 'gold'],
    ['Comisiones del mes', fmt(d.comisionesMes), d.comisionesMes > 0 ? 'red' : ''],
    ['Gastos del mes', fmt(d.gastosMes), 'red'],
    ['Caja disponible', fmt(d.caja), 'gold'],
    ['Stock bajo', d.productosBajoStock.length, d.productosBajoStock.length > 0 ? 'red' : '']
  ];
  document.getElementById('kpiGrid').innerHTML = kpis.map(([label, val, cls]) =>
    `<div class="kpi ${cls}"><span>${label}</span><strong>${val}</strong></div>`).join('');

  const max = Math.max(1, ...d.ventasPorDia.map(x => x.total));
  document.getElementById('salesChart').innerHTML = d.ventasPorDia.map(x =>
    `<div class="chart-bar" style="height:${Math.max(2, (x.total / max) * 130)}px" title="${fmt(x.total)}"><small>${x.label}</small></div>`).join('');

  const porCuenta = document.getElementById('dashCuentas');
  if (porCuenta) porCuenta.innerHTML = modoCuentas() ? CUENTAS.accounts.map(a =>
    `<div class="kpi gold"><span>Saldo ${esc(a.nombre)}</span><strong>${fmt(cashBalance(m => m.accountId === a.id))}</strong></div>`).join('') : '';

  const tbody = document.querySelector('#lowStockTable tbody');
  tbody.innerHTML = d.productosBajoStock.length
    ? d.productosBajoStock.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td>${p.stock}</td><td>${p.stockMin}</td></tr>`).join('')
    : '<tr><td colspan="4" class="empty-state">No hay productos con stock bajo.</td></tr>';
}

/* ============================== PRODUCTOS ================================= */

function renderProducts() {
  const q = document.getElementById('prodSearch').value;
  const categoria = document.getElementById('prodCatFilter').value;
  const soloBajoStock = document.getElementById('prodLowStock').checked;
  const soloSinStock = document.getElementById('prodNoStock').checked;
  const dueno = modoCuentas() ? document.getElementById('prodOwnerFilter').value : '';
  const list = findProducts({ q, categoria, soloBajoStock, soloSinStock }).filter(p => !dueno || p.ownerAccountId === dueno);

  document.getElementById('prodTableBody').innerHTML = list.length ? list.map(p => `
    <tr>
      <td>${esc(p.codigo)}${p.revisar ? ' <span class="badge badge-warn">revisar</span>' : ''}</td>
      <td>${esc(p.nombre)}</td>
      <td class="solo-cuentas">${modoCuentas() ? cuentaBadge(p.ownerAccountId) : ''}</td>
      <td>${p.categoria ? esc(p.categoria) : '<em style="color:var(--muted)">sin categoría</em>'}</td>
      <td>${fmt(p.costo)}</td>
      <td>${fmt(p.precio)}${precioPromoHTML(p)}</td>
      <td>${fmt(p.gananciaUnit)}</td>
      <td>${p.margenPct}%</td>
      <td>${p.stock}${p.stock <= p.stockMin ? ' <span class="badge badge-warn">bajo</span>' : ''}</td>
      <td>${fmt(p.valorStock)}</td>
      <td class="row-actions">
        <button class="icon-action" onclick="adjustStockPrompt('${p.id}', 1)">+</button>
        <button class="icon-action" onclick="adjustStockPrompt('${p.id}', -1)">−</button>
        <button class="icon-action" onclick="openProductModal('${p.id}')">✎</button>
        ${PROMOS.disponible && PROMOS.esAdmin ? `<button class="icon-action" title="Descuento" onclick="openDescuentoModal('${p.id}')">%</button>` : ''}
        <button class="icon-action" onclick="handleDeleteProduct('${p.id}')">🗑</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="11" class="empty-state">No se encontraron productos.</td></tr>';
}

['prodSearch', 'prodCatFilter', 'prodLowStock', 'prodNoStock', 'prodOwnerFilter'].forEach(id =>
  document.getElementById(id)?.addEventListener('input', renderProducts));

async function adjustStockPrompt(id, sign) {
  const p = DB.products.find(x => x.id === id);
  const cant = prompt(`${sign > 0 ? 'Ingresar' : 'Descontar'} unidades de "${p.nombre}" (stock actual: ${p.stock}):`, '1');
  if (cant === null) return;
  const n = Number(cant);
  if (!n || n <= 0 || n !== Math.trunc(n)) { showToast('Cantidad inválida.'); return; }
  let motivo = '';
  if (modoCuentas()) {
    motivo = prompt('Motivo del ajuste (queda registrado):', sign > 0 ? 'Ingreso manual de stock' : 'Unidad dañada / faltante');
    if (motivo === null) return;
    if (!motivo.trim()) { showToast('Indicá el motivo del ajuste.'); return; }
  }
  try {
    await adjustStock(id, sign * n, motivo.trim());
    renderProducts();
    showToast('Stock actualizado.');
  } catch (e) { showError(e); }
}

async function handleDeleteProduct(id) {
  if (!confirm('¿Eliminar este producto? Esta acción no se puede deshacer.')) return;
  try {
    await deleteProduct(id);
    renderProducts();
    showToast('Producto eliminado.');
  } catch (e) { showError(e); }
}

function openProductModal(id) {
  const p = id ? DB.products.find(x => x.id === id) : null;
  openModal(`
    <h3>${p ? 'Editar producto' : 'Nuevo producto'}</h3>
    <div class="two-col">
      <div class="field"><label>Código</label><input id="f_codigo" value="${p ? esc(p.codigo) : nextSuggestedCode()}"></div>
      <div class="field"><label>Categoría</label>
        <select id="f_categoria">
          <option value="" ${p && !p.categoria ? 'selected' : ''}>Sin categoría</option>
          ${listaCategorias(p && p.categoria).map(c => `<option ${p && p.categoria === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="field"><label>Nombre</label><input id="f_nombre" value="${p ? esc(p.nombre) : ''}"></div>
    ${modoCuentas() ? `<div class="field"><label>Dueño del producto (cuenta)</label>
      <select id="f_owner">${accountOptions(p ? p.ownerAccountId : cuentaEldostoreId())}</select>
      ${p ? '<small>Las ventas anteriores conservan su dueño. El cambio queda registrado con el stock y su valor.</small>' : ''}</div>` : ''}
    
        <div class="field">
          <label>${p && p.foto ? 'Foto del producto (elegí una nueva solo si querés reemplazarla)' : 'Foto del producto'}</label>
          ${p && p.foto ? `<img src="${esc(p.foto)}" alt="Foto actual" class="img-actual" loading="lazy">` : ''}
          <input type="file" id="f_foto" accept="image/jpeg,image/png,image/webp">
          <small>JPG, PNG o WebP de hasta 15 MB. Se optimiza sola antes de subir (máx. 1200 px).</small>
          <div id="f_foto_prev" class="img-prev" hidden></div>
        </div>

    <div class="two-col">
      <div class="field"><label>Costo</label><input type="number" id="f_costo" value="${p ? p.costo : ''}"></div>
      <div class="field"><label>Precio de venta</label><input type="number" id="f_precio" value="${p ? p.precio : ''}"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Stock</label><input type="number" id="f_stock" value="${p ? p.stock : 0}"></div>
      <div class="field"><label>Stock mínimo</label><input type="number" id="f_stockMin" value="${p ? p.stockMin : 0}"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveProductBtn" onclick="saveProduct('${p ? p.id : ''}')">Guardar</button>
    </div>
  `);
  conectarVistaPrevia('f_foto', 'producto', 'f_foto_prev');
}

async function saveProduct(id) {
  const data = {
    codigo: document.getElementById('f_codigo').value.trim(),
    categoria: document.getElementById('f_categoria').value,
    nombre: document.getElementById('f_nombre').value.trim(),
    costo: document.getElementById('f_costo').value,
    precio: document.getElementById('f_precio').value,
    stock: document.getElementById('f_stock').value,
    stockMin: document.getElementById('f_stockMin').value
  };
  const ownerSel = document.getElementById('f_owner');
  let motivoDueno = '';
  if (ownerSel) {
    data.ownerAccountId = ownerSel.value;
    const actual = id ? DB.products.find(x => x.id === id) : null;
    if (actual && actual.ownerAccountId !== data.ownerAccountId) {
      motivoDueno = prompt(`Cambiar el dueño de "${actual.nombre}" a ${accountName(data.ownerAccountId)}.\n` +
        `Stock actual: ${actual.stock} u. (valor a costo ${fmt(actual.valorStock)}).\nMotivo del cambio:`);
      if (motivoDueno === null) return;
      if (!motivoDueno.trim()) { showToast('Indicá el motivo del cambio de dueño.'); return; }
    }
  }
   
  if (!data.nombre) { showToast('El nombre es obligatorio.'); return; }
  const btn = document.getElementById('saveProductBtn');
  btn.disabled = true; btn.textContent = 'Preparando foto...';

  // La foto se optimiza al elegirla; si no se pudo, se avisa y no se guarda nada.
  let fotoLista = null;
  try { fotoLista = await imagenElegida('f_foto', 'producto'); }
  catch (e) { showToast(e.message); btn.disabled = false; btn.textContent = 'Guardar'; return; }

  btn.textContent = 'Guardando...';
  try {
    if (fotoLista) data.foto = await subirImagenOptimizada(fotoLista, 'producto');

    if (id) {
      await updateProduct(id, data);
      if (motivoDueno) await setProductOwner(id, data.ownerAccountId, motivoDueno.trim());
    } else await addProduct(data);
    closeModal();
    renderProducts();
    showToast('Producto guardado.');
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

function openImportModal() {
  openModal(`
    <h3>Importar inventario (CSV)</h3>
    <p style="color:var(--muted);font-size:.85rem;margin-bottom:14px">
      Columnas esperadas (primera fila = encabezados): <code>codigo,nombre,categoria,costo,precio,stock,stockMin</code>.
    </p>
    <div class="field"><input type="file" id="csvFile" accept=".csv,text/csv"></div>
    <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;color:var(--muted);margin-bottom:10px">
      <input type="checkbox" id="csvReplace" style="width:auto"> Reemplazar productos existentes con el mismo código
    </label>
    <div id="csvResult" style="font-size:.85rem;max-height:200px;overflow-y:auto"></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cerrar</button>
      <button class="btn btn-primary btn-sm" id="csvImportBtn" onclick="runCSVImport()">Importar</button>
    </div>
  `);
}

async function runCSVImport() {
  const file = document.getElementById('csvFile').files[0];
  if (!file) { showToast('Seleccioná un archivo CSV.'); return; }
  const replace = document.getElementById('csvReplace').checked;
  const btn = document.getElementById('csvImportBtn');
  btn.disabled = true; btn.textContent = 'Importando...';
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const r = await importProductsCSV(reader.result, { reemplazarExistentes: replace });
      document.getElementById('csvResult').innerHTML =
        `<p style="color:var(--green);margin-bottom:8px">${r.ok} productos importados/actualizados.</p>` +
        (r.errores.length ? '<p style="color:var(--red)">Avisos:</p><ul>' + r.errores.map(e => `<li>${e}</li>`).join('') + '</ul>' : '');
      renderProducts();
    } catch (e) { showError(e); }
    btn.disabled = false; btn.textContent = 'Importar';
  };
  reader.readAsText(file, 'UTF-8');
}

/* ============================== CLIENTES =================================== */

function renderClients() {
  const q = (document.getElementById('cliSearch').value || '').toLowerCase();
  const list = DB.clients.filter(c => !q || c.nombre.toLowerCase().includes(q));
  document.getElementById('cliTableBody').innerHTML = list.length ? list.map(c => {
    const h = clientHistory(c.id);
    return `<tr>
      <td>${c.nombre}</td><td>${c.telefono}</td><td>${c.localidad}</td>
      <td>${fmt(h.totalGastado)}</td>
      <td>${h.ultimaCompra ? fmtDate(h.ultimaCompra) : '—'}</td>
      <td class="row-actions">
        <button class="icon-action" onclick="openClientModal('${c.id}')">✎</button>
        <button class="icon-action" onclick="handleDeleteClient('${c.id}')">🗑</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">Todavía no cargaste clientes.</td></tr>';
}
document.getElementById('cliSearch')?.addEventListener('input', renderClients);

async function handleDeleteClient(id) {
  if (!confirm('¿Eliminar este cliente?')) return;
  try { await deleteClient(id); renderClients(); } catch (e) { showError(e); }
}

function openClientModal(id) {
  const c = id ? DB.clients.find(x => x.id === id) : null;
  openModal(`
    <h3>${c ? 'Editar cliente' : 'Nuevo cliente'}</h3>
    <div class="field"><label>Nombre</label><input id="c_nombre" value="${c ? c.nombre : ''}"></div>
    <div class="two-col">
      <div class="field"><label>Teléfono</label><input id="c_telefono" value="${c ? c.telefono : ''}"></div>
      <div class="field"><label>Localidad</label><input id="c_localidad" value="${c ? c.localidad : ''}"></div>
    </div>
    <div class="field"><label>Dirección</label><input id="c_direccion" value="${c ? c.direccion : ''}"></div>
    <div class="field"><label>Notas</label><textarea id="c_notas">${c ? c.notas : ''}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveClientBtn" onclick="saveClient('${c ? c.id : ''}')">Guardar</button>
    </div>
  `);
}

async function saveClient(id) {
  const data = {
    nombre: document.getElementById('c_nombre').value.trim(),
    telefono: document.getElementById('c_telefono').value.trim(),
    localidad: document.getElementById('c_localidad').value.trim(),
    direccion: document.getElementById('c_direccion').value.trim(),
    notas: document.getElementById('c_notas').value.trim()
  };
  if (!data.nombre) { showToast('El nombre es obligatorio.'); return; }
  const btn = document.getElementById('saveClientBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    if (id) await updateClient(id, data); else await addClient(data);
    closeModal();
    renderClients();
    showToast('Cliente guardado.');
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

/* ================================ PEDIDOS ==================================== */

let orderDraftItems = [];

function renderOrders() {
  const estadoF = document.getElementById('pedEstadoFilter').value;
  const list = DB.orders.filter(o => !estadoF || o.estado === estadoF);
  document.getElementById('pedTableBody').innerHTML = list.length ? list.map(o => {
    const cli = DB.clients.find(c => c.id === o.clienteId);
    return `<tr>
      <td>${fmtDate(o.fecha)}</td>
      <td>${cli ? esc(cli.nombre) : 'Consumidor final'}</td>
      <td>${fmt(o.total)}</td><td>${fmt(o.sena)}</td><td>${fmt(o.saldo)}</td>
      <td><span class="badge ${estadoBadgeClass(o.estado)}">${o.estado}</span></td>
      <td class="row-actions">
        ${!o.ventaId && o.estado !== 'Cancelado' ? `<button class="icon-action" onclick="handleConvertOrder('${o.id}')">→ Venta</button>` : ''}
        <select onchange="handleOrderStatusChange('${o.id}', this.value)" style="background:var(--card);border:1px solid var(--line);border-radius:6px;color:var(--white);font-size:.75rem">
          ${ESTADOS_PEDIDO.map(e => `<option ${e === o.estado ? 'selected' : ''}>${e}</option>`).join('')}
        </select>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="7" class="empty-state">No hay pedidos cargados.</td></tr>';
}
document.getElementById('pedEstadoFilter')?.addEventListener('input', renderOrders);

function estadoBadgeClass(e) {
  if (e === 'Entregado') return 'badge-ok';
  if (e === 'Cancelado') return 'badge-warn';
  if (e === 'Pendiente') return 'badge-pend';
  return 'badge-info';
}

async function handleOrderStatusChange(id, estado) {
  try { await updateOrderStatus(id, estado); renderOrders(); } catch (e) { showError(e); renderOrders(); }
}

async function handleConvertOrder(id) {
  if (modoCuentas()) {
    const o = DB.orders.find(x => x.id === id);
    openModal(`
      <h3>Convertir pedido en venta</h3>
      <p style="color:var(--muted);font-size:.88rem;margin-bottom:12px">Se descuenta el stock y se registra una venta propia por ${fmt(o ? o.total : 0)}.
        Cada producto se asigna a la cuenta de su dueño.</p>
      <div class="field"><label>¿Quién cobró? *</label><select id="cv_holder">${holderOptions(CUENTAS.miHolderId)}</select></div>
      <div class="modal-actions">
        <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="cvBtn" onclick="confirmConvertOrder('${id}')">Convertir</button>
      </div>`);
    return;
  }
  if (!confirm('Esto va a descontar el stock y generar una VENTA PROPIA (sin comisión). ¿Confirmar?')) return;
  const r = await convertOrderToSale(id);
  if (r.error) { showError(r.error); return; }
  showToast('Pedido convertido en venta.');
  renderOrders();
}

async function confirmConvertOrder(id) {
  const btn = document.getElementById('cvBtn');
  btn.disabled = true; btn.textContent = 'Convirtiendo...';
  const r = await convertOrderToSale(id, null, document.getElementById('cv_holder').value);
  if (r.error) { showError(r.error); btn.disabled = false; btn.textContent = 'Convertir'; return; }
  closeModal();
  showToast('Pedido convertido en venta.');
  renderOrders();
}

function openOrderModal() {
  orderDraftItems = [];
  openModal(`
    <h3>Nuevo pedido</h3>
    <div class="field"><label>Cliente</label><select id="o_cliente">${clientOptions()}</select></div>
    <div class="panel" style="padding:14px">
      <div class="two-col">
        <div class="field" style="margin-bottom:8px"><label>Producto</label><select id="o_producto">${productOptions()}</select></div>
        <div class="field" style="margin-bottom:8px"><label>Cantidad</label><input type="number" id="o_cantidad" value="1" min="1"></div>
      </div>
      <button class="btn btn-sm" onclick="addOrderDraftItem()">+ Agregar ítem</button>
      <div id="o_itemsList" style="margin-top:10px;font-size:.85rem"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Seña</label><input type="number" id="o_sena" value="0"></div>
      <div class="field"><label>Método de pago</label><input id="o_metodoPago" placeholder="Efectivo, transferencia..."></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Envío o retiro</label>
        <select id="o_envio"><option>Retiro</option><option>Envío</option></select>
      </div>
      <div class="field"><label>Dirección (si es envío)</label><input id="o_direccion"></div>
    </div>
    <div class="field"><label>Notas</label><textarea id="o_notas"></textarea></div>
    <p><strong>Total: <span id="o_totalPreview">$0</span></strong></p>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveOrderBtn" onclick="saveOrder()">Guardar pedido</button>
    </div>
  `);
  renderOrderDraftItems();
}

function addOrderDraftItem() {
  const productoId = document.getElementById('o_producto').value;
  const cantidad = Number(document.getElementById('o_cantidad').value) || 1;
  const p = DB.products.find(x => x.id === productoId);
  if (!p) { showToast('Cargá al menos un producto antes de agregar ítems.'); return; }
  orderDraftItems.push({ productoId, cantidad, precio: p.precio, nombre: p.nombre });
  renderOrderDraftItems();
}

function renderOrderDraftItems() {
  const el = document.getElementById('o_itemsList');
  el.innerHTML = orderDraftItems.length
    ? orderDraftItems.map((it, i) => `<div>${esc(it.nombre)} × ${it.cantidad} — ${fmt(it.precio * it.cantidad)}
        <button class="icon-action" onclick="removeOrderDraftItem(${i})">✕</button></div>`).join('')
    : '<em style="color:var(--muted)">Sin ítems todavía.</em>';
  const total = orderDraftItems.reduce((a, it) => a + it.cantidad * it.precio, 0);
  const totalEl = document.getElementById('o_totalPreview');
  if (totalEl) totalEl.textContent = fmt(total);
}
function removeOrderDraftItem(i) { orderDraftItems.splice(i, 1); renderOrderDraftItems(); }

async function saveOrder() {
  if (!orderDraftItems.length) { showToast('Agregá al menos un producto al pedido.'); return; }
  const btn = document.getElementById('saveOrderBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    await addOrder({
      clienteId: document.getElementById('o_cliente').value || null,
      items: orderDraftItems,
      sena: document.getElementById('o_sena').value,
      metodoPago: document.getElementById('o_metodoPago').value,
      envioORetiro: document.getElementById('o_envio').value,
      direccion: document.getElementById('o_direccion').value,
      notas: document.getElementById('o_notas').value
    });
    closeModal();
    renderOrders();
    showToast('Pedido creado.');
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar pedido'; }
}

/* ================================= VENTAS ===================================== */
/* Actualización 002:
   - Modalidad obligatoria: venta propia o venta por revendedor.
   - En revendedor, % de comisión por línea (puede variar entre productos).
   - Comisión = precio unitario × cantidad × % / 100. Se guarda en cada
     línea y en el total de la venta (historial fijo aunque el % cambie).
   - Anular y corregir sin borrar: la original queda marcada como anulada. */

let saleDraftItems = [];
let saleDraftModalidad = '';
let saleEditingId = null;   // id de la venta que se está corrigiendo (o null)

function modalidadBadge(m) {
  return m === 'revendedor' ? '<span class="badge badge-rev">Revendedor</span>' : '<span class="badge badge-info">Propia</span>';
}

function migracionPendienteHTML() {
  return MIGRACION_002.detectada || (!DB.sales.length && !DB.purchases.length && !DB.expenses.length) ? '' :
    `<div class="notice">Falta aplicar en Supabase la migración <code>data/migracion-002-revendedores-y-correcciones.sql</code>. Hasta entonces no se pueden registrar, anular ni corregir operaciones desde esta versión del panel.</div>`;
}

function kpiBox(label, valor, sub, cls) {
  return `<div class="kpi ${cls}"><span>${label}</span><strong>${valor}</strong>${sub ? `<div style="color:var(--muted);font-size:.72rem;margin-top:4px">${sub}</div>` : ''}</div>`;
}

function renderSalesSummary() {
  const r = salesSummary(activeSales());
  document.getElementById('ventaResumen').innerHTML = [
    kpiBox('Ventas propias', fmt(r.propia.total), `${r.propia.cantidad} ventas · ganancia ${fmt(r.propia.ganancia)}`, 'green'),
    kpiBox('Ventas por revendedor', fmt(r.revendedor.total), `${r.revendedor.cantidad} ventas · ganancia ${fmt(r.revendedor.ganancia)}`, 'green'),
    kpiBox('Comisiones de revendedores', fmt(r.todas.comision), 'ya descontadas de la ganancia', r.todas.comision > 0 ? 'red' : ''),
    kpiBox('Ganancia bruta total', fmt(r.todas.ganancia), 'después de comisiones, antes de gastos', 'gold')
  ].join('');
}

function renderSales() {
  renderSalesSummary();
  const filtro = document.getElementById('ventaModalidadFilter').value;
  const verAnuladas = document.getElementById('ventaVerAnuladas').checked;
  const list = DB.sales.filter(v => (verAnuladas || !v.anulada) && (!filtro || v.modalidad === filtro));
  document.getElementById('ventaTableBody').innerHTML = list.length ? list.map(v => {
    const cli = DB.clients.find(c => c.id === v.clienteId);
    const productos = v.items.map(i => `${esc(i.nombre)} ×${i.cantidad}` +
      (v.modalidad === 'revendedor' && i.comisionPct !== undefined ? ` <small style="color:var(--muted)">(${i.comisionPct}%)</small>` : '') +
      (modoCuentas() ? ' ' + cuentaBadge(cuentaDeLinea(i)) : '')).join(', ') +
      (modoCuentas() ? `<div class="sub-info">Cobró: ${esc(holderName(v.holderId))}${v.creadoPor ? ' · cargó ' + esc(userName(v.creadoPor)) : ''}` +
        `${v.anulada && v.anuladoPor ? ' · anuló ' + esc(userName(v.anuladoPor)) : ''}</div>` : '');
    const marcas = (v.anulada ? ` <span class="badge badge-anulada" title="${esc(v.motivoAnulacion)}">ANULADA</span>` : '') +
      (v.corrigeA ? ' <span class="badge badge-pend" title="Reemplaza a una venta anulada por corrección">corrección</span>' : '');
    const acciones = v.anulada
      ? `<small style="color:var(--muted)">Motivo: ${esc(v.motivoAnulacion) || '—'}</small>`
      : `<button class="icon-action" onclick="openSaleModal('${v.id}')">✎ Corregir</button>
         <button class="icon-action" onclick="handleVoidSale('${v.id}')">⊘ Anular</button>`;
    return `<tr class="${v.anulada ? 'row-anulada' : ''}">
      <td>${fmtDate(v.fecha)}</td>
      <td class="no-strike">${modalidadBadge(v.modalidad)}${marcas}</td>
      <td>${cli ? esc(cli.nombre) : 'Consumidor final'}</td>
      <td>${productos}</td>
      <td>${fmt(v.total)}</td><td>${fmt(v.costoTotal)}</td>
      <td>${v.comisionTotal ? fmt(v.comisionTotal) : '—'}</td>
      <td style="color:var(--green)">${fmt(v.ganancia)}</td>
      <td>${esc(v.metodoPago) || '—'}</td>
      <td class="row-actions no-strike">${acciones}</td>
    </tr>`;
  }).join('') : '<tr><td colspan="10" class="empty-state">No hay ventas para mostrar.</td></tr>';
}
['ventaModalidadFilter', 'ventaVerAnuladas'].forEach(id =>
  document.getElementById(id)?.addEventListener('input', renderSales));

/* Unidades de un producto en la venta original que se está corrigiendo:
   al corregir, esas unidades vuelven al stock antes de la nueva venta. */
function unidadesEnVentaOriginal(productoId) {
  const original = saleEditingId ? DB.sales.find(v => v.id === saleEditingId) : null;
  return original ? original.items.filter(i => i.productoId === productoId).reduce((a, i) => a + Number(i.cantidad), 0) : 0;
}
/* Costo unitario a usar: en una corrección se conserva el costo histórico
   de la venta original (igual que hace la base de datos). */
function costoParaLinea(productoId) {
  const original = saleEditingId ? DB.sales.find(v => v.id === saleEditingId) : null;
  const linea = original && original.items.find(i => i.productoId === productoId && i.costoUnit !== undefined);
  if (linea) return Number(linea.costoUnit);
  const p = DB.products.find(x => x.id === productoId);
  return p ? p.costo : 0;
}

/* Dueño a usar en una línea: en una corrección se conserva el de la venta original. */
function duenoParaLinea(productoId) {
  const original = saleEditingId ? DB.sales.find(v => v.id === saleEditingId) : null;
  const linea = original && original.items.find(i => i.productoId === productoId);
  if (linea) return cuentaDeLinea(linea);
  const p = DB.products.find(x => x.id === productoId);
  return p ? p.ownerAccountId : null;
}

function openSaleModal(editId) {
  const original = editId ? DB.sales.find(v => v.id === editId) : null;
  saleEditingId = original ? original.id : null;
  saleDescuentos = null; saleFechaPedido = '';
  saleDraftModalidad = original ? original.modalidad : '';
  saleDraftItems = original ? original.items.map(i => ({
    productoId: i.productoId, nombre: i.nombre, cantidad: Number(i.cantidad), precioVenta: Number(i.precioVenta),
    costoUnit: costoParaLinea(i.productoId), ownerAccountId: duenoParaLinea(i.productoId),
    comisionPct: i.comisionPct !== undefined && original.modalidad === 'revendedor' ? Number(i.comisionPct) : ''
  })) : [];

  openModal(`
    <h3>${original ? 'Corregir venta' : 'Registrar venta'}</h3>
    ${migracionPendienteHTML()}
    ${original ? `<div class="notice">Venta original: ${fmtDate(original.fecha)} · ${fmt(original.total)}.<br>
      Al guardar, la original queda <strong>anulada</strong> (devuelve stock y revierte caja) y se registra esta versión, en un solo paso.</div>` : ''}
    <div class="field"><label>Modalidad de venta *</label>
      <div class="seg">
        <label><input type="radio" name="v_modalidad" value="propia" ${saleDraftModalidad === 'propia' ? 'checked' : ''} onchange="setSaleModalidad(this.value)"> Venta propia</label>
        <label><input type="radio" name="v_modalidad" value="revendedor" ${saleDraftModalidad === 'revendedor' ? 'checked' : ''} onchange="setSaleModalidad(this.value)"> Venta por revendedor</label>
      </div>
    </div>
    <div class="field"><label>Cliente</label><select id="v_cliente">${clientOptions(original ? original.clienteId : null)}</select></div>
    ${modoCuentas() ? `<div class="field"><label>¿Quién cobró? *</label><select id="v_holder">${holderOptions(original ? original.holderId : CUENTAS.miHolderId)}</select>
      <small>Cada producto se asigna a la cuenta de su dueño, aunque cobre otra persona.</small></div>` : ''}
    <div class="panel" style="padding:14px">
      <div class="two-col">
        <div class="field" style="margin-bottom:8px"><label>Producto</label><select id="v_producto">${productOptions()}</select></div>
        <div class="field" style="margin-bottom:8px"><label>Cantidad</label><input type="number" id="v_cantidad" value="1" min="1"></div>
      </div>
      <button class="btn btn-sm" onclick="addSaleDraftItem()">+ Agregar ítem</button>
      <div id="v_itemsList" style="margin-top:10px;font-size:.85rem"></div>
    </div>
    <div class="field"><label>Método de pago</label><input id="v_metodoPago" placeholder="Efectivo, transferencia..." value="${original ? esc(original.metodoPago) : ''}"></div>
    ${!original && PROMOS.disponible ? `<div class="field"><label>Fecha del pedido (solo si el cliente pidió antes, con una oferta que ya terminó)</label>
      <input type="datetime-local" id="v_fechaPedido" onchange="cambiarFechaPedido(this.value)">
      <small>Vacío = ahora. Se aceptan pedidos de hasta 7 días atrás; la base controla que el descuento valía en esa fecha.</small></div>` : ''}
    <div id="v_resumen" class="sale-summary"></div>
    ${original ? `<div class="field" style="margin-top:14px"><label>Motivo de la corrección *</label><input id="v_motivo" placeholder="Ej.: cantidad mal cargada, era venta por revendedor..."></div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveSaleBtn" onclick="saveSale()">${original ? 'Guardar corrección' : 'Registrar venta'}</button>
    </div>
  `, true);
  renderSaleDraftItems();
}

function setSaleModalidad(m) {
  saleDraftModalidad = m;
  renderSaleDraftItems();
}

function addSaleDraftItem() {
  const productoId = document.getElementById('v_producto').value;
  const cantidad = Number(document.getElementById('v_cantidad').value) || 0;
  const p = DB.products.find(x => x.id === productoId);
  if (!p) { showToast('Cargá al menos un producto antes.'); return; }
  if (cantidad <= 0) { showToast('Cantidad inválida.'); return; }
  const enBorrador = saleDraftItems.filter(x => x.productoId === productoId).reduce((a, x) => a + x.cantidad, 0);
  const disponible = p.stock + unidadesEnVentaOriginal(productoId) - enBorrador;
  if (cantidad > disponible) { showToast(`Stock insuficiente de "${p.nombre}" (disponible: ${disponible}).`); return; }
  const linea = { productoId, cantidad, precioVenta: p.precio, nombre: p.nombre, costoUnit: costoParaLinea(productoId), comisionPct: '',
                  ownerAccountId: duenoParaLinea(productoId), precioHabitual: p.precio };
  if (!saleEditingId) aplicarDescuentoLinea(linea, true);
  saleDraftItems.push(linea);
  renderSaleDraftItems();
}

function renderSaleDraftItems() {
  const el = document.getElementById('v_itemsList');
  if (!el) return;
  const rev = saleDraftModalidad === 'revendedor';
  el.innerHTML = saleDraftItems.length ? `
    <div class="table-wrap"><table class="draft-table">
      <thead><tr><th>Producto</th>${modoCuentas() ? '<th>Cuenta</th>' : ''}<th>Cant.</th><th>Precio u.</th><th>Importe</th><th>Costo</th>
        ${rev ? '<th>% revendedor</th><th>Comisión</th>' : ''}<th>Ganancia</th><th></th></tr></thead>
      <tbody>${saleDraftItems.map((it, i) => {
        const l = calcSaleLine(it, saleDraftModalidad);
        return `<tr>
          <td class="prod">${esc(it.nombre)}</td>
          ${modoCuentas() ? `<td data-label="Cuenta">${cuentaBadge(it.ownerAccountId)}</td>` : ''}
          <td data-label="Cantidad">${it.cantidad}</td><td data-label="Precio u.">${fmt(it.precioVenta)}${lineaDescuentoHTML(it, i)}</td>
          <td data-label="Importe">${fmt(l.subtotal)}</td><td data-label="Costo">${fmt(l.costoTotal)}</td>
          ${rev ? `<td data-label="% revendedor"><input type="number" inputmode="decimal" min="0" max="100" step="0.1" placeholder="%" value="${it.comisionPct}" oninput="setSaleItemPct(${i}, this.value)"></td>
                   <td data-label="Comisión" id="v_com_${i}">${fmt(l.comision)}</td>` : ''}
          <td data-label="Ganancia" id="v_gan_${i}">${fmt(l.ganancia)}</td>
          <td class="quitar"><button class="icon-action" onclick="removeSaleDraftItem(${i})">✕ Quitar</button></td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>`
    : '<em style="color:var(--muted)">Sin ítems todavía.</em>';
  renderSaleSummary();
}

function setSaleItemPct(i, valor) {
  saleDraftItems[i].comisionPct = valor;
  const l = calcSaleLine(saleDraftItems[i], saleDraftModalidad);
  const com = document.getElementById('v_com_' + i), gan = document.getElementById('v_gan_' + i);
  if (com) com.textContent = fmt(l.comision);
  if (gan) gan.textContent = fmt(l.ganancia);
  renderSaleSummary();
}

function renderSaleSummary() {
  const el = document.getElementById('v_resumen');
  if (!el) return;
  const t = calcSaleTotals(saleDraftItems, saleDraftModalidad);
  const rev = saleDraftModalidad === 'revendedor';
  el.innerHTML = `
    <div><span>Importe de venta</span><strong>${fmt(t.total)}</strong></div>
    <div><span>Costo total</span><strong>${fmt(t.costoTotal)}</strong></div>
    <div><span>Comisión revendedor</span><strong style="color:var(--red)">${rev ? fmt(t.comision) : '—'}</strong></div>
    <div><span>${modoCuentas() ? 'Ganancia bruta total' : 'Ganancia bruta ELDOSTORE'}</span><strong style="color:var(--gold)">${fmt(t.ganancia)}</strong></div>` +
    (modoCuentas() && saleDraftItems.length ? CUENTAS.accounts.map(a => {
      const lineas = saleDraftItems.filter(it => it.ownerAccountId === a.id);
      if (!lineas.length) return '';
      const ta = calcSaleTotals(lineas, saleDraftModalidad);
      return `<div><span>${esc(a.nombre)}: ventas ${fmt(ta.total)}</span><strong>ganancia ${fmt(ta.ganancia)}</strong></div>`;
    }).join('') : '');
}

function removeSaleDraftItem(i) { saleDraftItems.splice(i, 1); renderSaleDraftItems(); }

async function saveSale() {
  if (!saleDraftModalidad) { showToast('Elegí la modalidad: venta propia o por revendedor.'); return; }
  if (!saleDraftItems.length) { showToast('Agregá al menos un producto.'); return; }
  if (saleDraftModalidad === 'revendedor') {
    const mal = saleDraftItems.find(it => it.comisionPct === '' || isNaN(Number(it.comisionPct)) || Number(it.comisionPct) < 0 || Number(it.comisionPct) > 100);
    if (mal) { showToast(`Ingresá el % del revendedor (0 a 100) para "${mal.nombre}".`); return; }
  }
  const datos = {
    clienteId: document.getElementById('v_cliente').value || null,
    items: saleDraftItems,
    metodoPago: document.getElementById('v_metodoPago').value,
    modalidad: saleDraftModalidad,
    holderId: document.getElementById('v_holder') ? document.getElementById('v_holder').value : null
  };
  if (modoCuentas() && !datos.holderId) { showToast('Indicá quién cobró.'); return; }
  const conDescuento = !saleEditingId && saleDraftItems.some(it => it.descuentoPct);
  if (conDescuento) datos.fechaPedido = fechaPedidoISO();
  let motivo = '';
  if (saleEditingId) {
    motivo = document.getElementById('v_motivo').value.trim();
    if (!motivo) { showToast('Indicá el motivo de la corrección.'); return; }
    if (!confirm('Se anulará la venta original y se registrará la versión corregida. ¿Confirmar?')) return;
  }
  const btn = document.getElementById('saveSaleBtn');
  const textoBtn = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    if (saleEditingId) {
      await correctSale(saleEditingId, motivo, datos);
    } else {
      const r = conDescuento ? await registerSalePromocion(datos) : await registerSale(datos);
      if (r.error) throw new Error(r.error);
    }
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = textoBtn; return; }
  const corregida = !!saleEditingId;
  saleEditingId = null;
  closeModal();
  renderSales();
  showToast(corregida ? 'Venta corregida. La original quedó anulada.' : 'Venta registrada. Stock y caja actualizados.');
}

async function handleVoidSale(id) {
  const v = DB.sales.find(x => x.id === id);
  if (!v) return;
  const motivo = prompt(`Anular la venta del ${fmtDate(v.fecha)} por ${fmt(v.total)}.\n` +
    `Se devuelven las unidades al stock y se revierte la caja${v.comisionTotal ? ' (incluida la comisión)' : ''}. ` +
    `La venta no se borra: queda marcada como anulada.\n\nMotivo de la anulación:`);
  if (motivo === null) return;
  if (!motivo.trim()) { showToast('Indicá un motivo.'); return; }
  try {
    const r = await voidSale(id, motivo.trim());
    renderSales();
    const faltan = r && r.productosNoEncontrados ? r.productosNoEncontrados : [];
    showToast('Venta anulada. Stock y caja revertidos.' + (faltan.length ? ` Sin stock para devolver (producto eliminado): ${faltan.join(', ')}.` : ''));
  } catch (e) { showError(e); }
}

/* ================================= COMPRAS ===================================== */

let purchaseEditingId = null;

function renderPurchases() {
  const verAnuladas = document.getElementById('compraVerAnuladas').checked;
  const list = DB.purchases.filter(c => verAnuladas || !c.anulada);
  document.getElementById('compraTableBody').innerHTML = list.length ? list.map(c => {
    const p = DB.products.find(x => x.id === c.productoId);
    const marcas = (c.anulada ? ` <span class="badge badge-anulada">ANULADA</span>` : '') +
      (c.corrigeA ? ' <span class="badge badge-pend">corrección</span>' : '');
    const acciones = c.anulada
      ? `<small style="color:var(--muted)">Motivo: ${esc(c.motivoAnulacion) || '—'}</small>`
      : `<button class="icon-action" onclick="openPurchaseModal('${c.id}')">✎ Corregir</button>
         <button class="icon-action" onclick="handleVoidPurchase('${c.id}')">⊘ Anular</button>`;
    return `<tr class="${c.anulada ? 'row-anulada' : ''}"><td>${fmtDate(c.fecha)}</td><td>${esc(c.proveedor) || '—'}</td>
      <td class="no-strike">${p ? esc(p.nombre) : '—'}${marcas}${modoCuentas() ? `<div class="sub-info">Cuenta: ${esc(accountName(c.accountId))} · pagó ${esc(holderName(c.holderId))}</div>` : ''}</td>
      <td>${c.cantidad}</td><td>${fmt(c.costoUnit)}</td><td>${fmt(c.total)}</td>
      <td class="row-actions no-strike">${acciones}</td></tr>`;
  }).join('') : '<tr><td colspan="7" class="empty-state">No hay compras para mostrar.</td></tr>';
}
document.getElementById('compraVerAnuladas')?.addEventListener('input', renderPurchases);

function openPurchaseModal(editId) {
  const c = editId ? DB.purchases.find(x => x.id === editId) : null;
  purchaseEditingId = c ? c.id : null;
  openModal(`
    <h3>${c ? 'Corregir compra' : 'Registrar compra'}</h3>
    ${migracionPendienteHTML()}
    ${c ? `<div class="notice">Compra original: ${fmtDate(c.fecha)} · ${c.cantidad} u. · ${fmt(c.total)}.<br>
      Al guardar, la original queda <strong>anulada</strong> (se resta su stock y se revierte su pago) y se registra esta versión.</div>` : ''}
    <div class="field"><label>Proveedor</label><input id="cp_proveedor" value="${c ? esc(c.proveedor) : ''}"></div>
    <div class="field"><label>Producto</label><select id="cp_producto">${productOptions(c ? c.productoId : null)}</select>
      ${modoCuentas() ? '<small>La compra se registra en la cuenta del dueño del producto.</small>' : ''}</div>
    ${modoCuentas() ? `<div class="field"><label>¿Quién pagó? *</label><select id="cp_holder">${holderOptions(c ? c.holderId : CUENTAS.miHolderId)}</select></div>` : ''}
    <div class="two-col">
      <div class="field"><label>Cantidad</label><input type="number" id="cp_cantidad" value="${c ? c.cantidad : 1}" min="1"></div>
      <div class="field"><label>Costo unitario</label><input type="number" id="cp_costoUnit" value="${c ? c.costoUnit : ''}"></div>
    </div>
    <div class="field"><label>Método de pago</label><input id="cp_metodoPago" value="${c ? esc(c.metodoPago) : ''}"></div>
    <div class="field"><label>Notas</label><textarea id="cp_notas">${c ? esc(c.notas) : ''}</textarea></div>
    ${c ? `<div class="field"><label>Motivo de la corrección *</label><input id="cp_motivo"></div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="savePurchaseBtn" onclick="savePurchase()">${c ? 'Guardar corrección' : 'Registrar'}</button>
    </div>
  `);
}

async function savePurchase() {
  const productoId = document.getElementById('cp_producto').value;
  if (!productoId) { showToast('Seleccioná un producto.'); return; }
  const datos = {
    proveedor: document.getElementById('cp_proveedor').value,
    productoId,
    cantidad: document.getElementById('cp_cantidad').value,
    costoUnit: document.getElementById('cp_costoUnit').value,
    metodoPago: document.getElementById('cp_metodoPago').value,
    notas: document.getElementById('cp_notas').value,
    holderId: document.getElementById('cp_holder') ? document.getElementById('cp_holder').value : null
  };
  let motivo = '';
  if (purchaseEditingId) {
    motivo = document.getElementById('cp_motivo').value.trim();
    if (!motivo) { showToast('Indicá el motivo de la corrección.'); return; }
    if (!(Number(datos.cantidad) > 0) || datos.costoUnit === '' || Number(datos.costoUnit) < 0) { showToast('Revisá cantidad y costo unitario.'); return; }
    if (!confirm('Se anulará la compra original y se registrará la versión corregida. ¿Confirmar?')) return;
  }
  const btn = document.getElementById('savePurchaseBtn');
  const textoBtn = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    if (purchaseEditingId) await correctPurchase(purchaseEditingId, motivo, datos);
    else await registerPurchase(datos);
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = textoBtn; return; }
  const corregida = !!purchaseEditingId;
  purchaseEditingId = null;
  closeModal();
  renderPurchases();
  showToast(corregida ? 'Compra corregida. La original quedó anulada.' : 'Compra registrada. Stock actualizado.');
}

async function handleVoidPurchase(id) {
  const c = DB.purchases.find(x => x.id === id);
  if (!c) return;
  const p = DB.products.find(x => x.id === c.productoId);
  const motivo = prompt(`Anular la compra de ${c.cantidad} u. de "${p ? p.nombre : 'producto'}" (${fmt(c.total)}).\n` +
    `Se restan esas unidades del stock y se revierte el pago en caja. La compra no se borra: queda marcada como anulada.\n\nMotivo de la anulación:`);
  if (motivo === null) return;
  if (!motivo.trim()) { showToast('Indicá un motivo.'); return; }
  try {
    await voidPurchase(id, motivo.trim());
    renderPurchases();
    showToast('Compra anulada. Stock y caja revertidos.');
  } catch (e) { showError(e); }
}

/* ================================== GASTOS ====================================== */

let expenseEditingId = null;

function renderExpenses() {
  const verAnulados = document.getElementById('gastoVerAnuladas').checked;
  const list = DB.expenses.filter(g => verAnulados || !g.anulada);
  document.getElementById('gastoTableBody').innerHTML = list.length ? list.map(g => {
    const marcas = (g.anulada ? ` <span class="badge badge-anulada">ANULADO</span>` : '') +
      (g.corrigeA ? ' <span class="badge badge-pend">corrección</span>' : '');
    const acciones = g.anulada
      ? `<small style="color:var(--muted)">Motivo: ${esc(g.motivoAnulacion) || '—'}</small>`
      : `<button class="icon-action" onclick="openExpenseModal('${g.id}')">✎ Corregir</button>
         <button class="icon-action" onclick="handleVoidExpense('${g.id}')">⊘ Anular</button>`;
    return `<tr class="${g.anulada ? 'row-anulada' : ''}"><td>${fmtDate(g.fecha)}</td>
      <td class="no-strike">${esc(g.descripcion)}${marcas}${modoCuentas() ? `<div class="sub-info">${partesDeGasto(g.id).map(x => esc(accountName(x.accountId)) + ' ' + fmt(x.importe)).join(' · ')} · pagó ${esc(holderName(g.holderId))}</div>` : ''}</td><td>${esc(g.categoria)}</td><td>${fmt(g.importe)}</td>
      <td>${esc(g.metodoPago) || '—'}</td><td class="row-actions no-strike">${acciones}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">No hay gastos para mostrar.</td></tr>';
}
document.getElementById('gastoVerAnuladas')?.addEventListener('input', renderExpenses);

function openExpenseModal(editId) {
  const g = editId ? DB.expenses.find(x => x.id === editId) : null;
  expenseEditingId = g ? g.id : null;
  openModal(`
    <h3>${g ? 'Corregir gasto' : 'Nuevo gasto'}</h3>
    ${g ? `${migracionPendienteHTML()}<div class="notice">Gasto original: ${fmtDate(g.fecha)} · ${fmt(g.importe)}.<br>
      Al guardar, el original queda <strong>anulado</strong> (se revierte su egreso) y se registra esta versión.</div>` : ''}
    <div class="field"><label>Descripción</label><input id="g_descripcion" value="${g ? esc(g.descripcion) : ''}"></div>
    <div class="two-col">
      <div class="field"><label>Categoría</label><input id="g_categoria" placeholder="Alquiler, insumos, etc." value="${g ? esc(g.categoria) : ''}"></div>
      <div class="field"><label>Importe</label><input type="number" id="g_importe" value="${g ? g.importe : ''}" oninput="actualizarRepartoGasto()"></div>
    </div>
    ${modoCuentas() ? `
    <div class="field"><label>¿Quién pagó? *</label><select id="g_holder">${holderOptions(g ? g.holderId : CUENTAS.miHolderId)}</select></div>
    <div class="panel" style="padding:14px">
      <label style="display:block;font-weight:700;margin-bottom:8px">Reparto entre cuentas *</label>
      ${CUENTAS.accounts.filter(a => a.activo).map(a => {
        const parte = g ? partesDeGasto(g.id).find(x => x.accountId === a.id) : null;
        return `<div class="two-col reparto-fila"><div>${esc(a.nombre)}</div>
          <input type="number" min="0" step="0.01" class="g_parte" data-account="${a.id}" value="${parte ? parte.importe : ''}" oninput="actualizarRepartoGasto()"></div>`;
      }).join('')}
      <div class="toolbar" style="margin:8px 0 0">
        <button class="btn btn-sm" type="button" onclick="repartoGasto('eldostore')">Todo a ELDOSTORE</button>
        <button class="btn btn-sm" type="button" onclick="repartoGasto('iguales')">Partes iguales</button>
      </div>
      <p id="g_repartoEstado" style="font-size:.85rem;margin-top:8px"></p>
    </div>` : ''}
    <div class="field"><label>Método de pago</label><input id="g_metodoPago" value="${g ? esc(g.metodoPago) : ''}"></div>
    <div class="field"><label>Notas</label><textarea id="g_notas">${g ? esc(g.notas) : ''}</textarea></div>
    ${g ? `<div class="field"><label>Motivo de la corrección *</label><input id="g_motivo"></div>` : ''}
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveExpenseBtn" onclick="saveExpense()">${g ? 'Guardar corrección' : 'Guardar'}</button>
    </div>
  `);
  if (modoCuentas() && !g) repartoGasto('eldostore'); else actualizarRepartoGasto();
}

function leerPartesGasto() {
  return [...document.querySelectorAll('.g_parte')]
    .map(el => ({ accountId: el.dataset.account, importe: Number(el.value) || 0 }))
    .filter(x => x.importe > 0);
}
function actualizarRepartoGasto() {
  const el = document.getElementById('g_repartoEstado');
  if (!el) return;
  const total = Number(document.getElementById('g_importe').value) || 0;
  const suma = round2(leerPartesGasto().reduce((a, x) => a + x.importe, 0));
  const ok = total > 0 && suma === round2(total);
  el.style.color = ok ? 'var(--green)' : 'var(--red)';
  el.textContent = ok ? `Reparto completo: ${fmt(suma)}.` : `Las partes suman ${fmt(suma)} y el gasto es de ${fmt(total)}: tienen que coincidir.`;
}
function repartoGasto(modo) {
  const total = Number(document.getElementById('g_importe').value) || 0;
  const campos = [...document.querySelectorAll('.g_parte')];
  if (modo === 'eldostore') {
    campos.forEach(el => { el.value = el.dataset.account === cuentaEldostoreId() ? total : ''; });
  } else {
    const base = Math.floor((total / campos.length) * 100) / 100;
    campos.forEach((el, i) => { el.value = i === 0 ? round2(total - base * (campos.length - 1)) : base; });
  }
  actualizarRepartoGasto();
}

async function saveExpense() {
  const descripcion = document.getElementById('g_descripcion').value.trim();
  if (!descripcion) { showToast('La descripción es obligatoria.'); return; }
  const datos = {
    descripcion,
    categoria: document.getElementById('g_categoria').value,
    importe: document.getElementById('g_importe').value,
    metodoPago: document.getElementById('g_metodoPago').value,
    notas: document.getElementById('g_notas').value
  };
  if (modoCuentas()) {
    datos.holderId = document.getElementById('g_holder').value;
    datos.partes = leerPartesGasto();
    if (!(Number(datos.importe) > 0)) { showToast('Importe inválido.'); return; }
    if (!datos.holderId) { showToast('Indicá quién pagó.'); return; }
    if (!datos.partes.length) { showToast('Indicá a qué cuenta corresponde el gasto.'); return; }
    const suma = round2(datos.partes.reduce((a, x) => a + x.importe, 0));
    if (suma !== round2(Number(datos.importe))) { showToast(`Las partes suman ${fmt(suma)} y el gasto es de ${fmt(datos.importe)}: tienen que coincidir.`); return; }
  }
  let motivo = '';
  if (expenseEditingId) {
    motivo = document.getElementById('g_motivo').value.trim();
    if (!motivo) { showToast('Indicá el motivo de la corrección.'); return; }
    if (!(Number(datos.importe) > 0)) { showToast('Importe inválido.'); return; }
    if (!confirm('Se anulará el gasto original y se registrará la versión corregida. ¿Confirmar?')) return;
  }
  const btn = document.getElementById('saveExpenseBtn');
  const textoBtn = btn.textContent;
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    if (expenseEditingId) await correctExpense(expenseEditingId, motivo, datos);
    else await registerExpense(datos);
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = textoBtn; return; }
  const corregido = !!expenseEditingId;
  expenseEditingId = null;
  closeModal();
  renderExpenses();
  showToast(corregido ? 'Gasto corregido. El original quedó anulado.' : 'Gasto registrado.');
}

async function handleVoidExpense(id) {
  const g = DB.expenses.find(x => x.id === id);
  if (!g) return;
  const motivo = prompt(`Anular el gasto "${g.descripcion}" (${fmt(g.importe)}).\n` +
    `Se revierte su egreso en caja. El gasto no se borra: queda marcado como anulado.\n\nMotivo de la anulación:`);
  if (motivo === null) return;
  if (!motivo.trim()) { showToast('Indicá un motivo.'); return; }
  try {
    await voidExpense(id, motivo.trim());
    renderExpenses();
    showToast('Gasto anulado. Caja revertida.');
  } catch (e) { showError(e); }
}

/* ==================================== CAJA ======================================= */

function renderCash() {
  const cuenta = modoCuentas() ? document.getElementById('cajaCuentaFilter').value : '';
  const persona = modoCuentas() ? document.getElementById('cajaHolderFilter').value : '';
  const filtro = m => (!cuenta || m.accountId === cuenta) && (!persona || m.holderId === persona);
  const list = DB.cashMovements.filter(filtro);
  const ingresos = round2(list.filter(m => m.tipo === 'ingreso').reduce((a, m) => a + m.monto, 0));
  const egresos = round2(list.filter(m => m.tipo === 'egreso').reduce((a, m) => a + m.monto, 0));
  document.getElementById('cajaIngresos').textContent = fmt(ingresos);
  document.getElementById('cajaEgresos').textContent = fmt(egresos);
  document.getElementById('cajaSaldo').textContent = fmt(cashBalance(filtro));

  document.getElementById('cajaTableBody').innerHTML = list.length ? list.map(m =>
    `<tr><td>${fmtDate(m.fecha)}</td>
      <td><span class="badge ${m.tipo === 'ingreso' ? 'badge-ok' : 'badge-warn'}">${esc(m.tipo)}</span></td>
      <td>${esc(m.origen)}${m.anulaA ? ' <span class="badge badge-pend">anulación</span>' : ''}</td>
      <td class="solo-cuentas">${modoCuentas() ? cuentaBadge(m.accountId) : ''}</td>
      <td class="solo-cuentas">${modoCuentas() ? esc(holderName(m.holderId)) : ''}</td>
      <td>${esc(m.descripcion)}</td><td>${fmt(m.monto)}</td></tr>`
  ).join('') : '<tr><td colspan="7" class="empty-state">Sin movimientos de caja todavía.</td></tr>';
}
['cajaCuentaFilter', 'cajaHolderFilter'].forEach(id => document.getElementById(id)?.addEventListener('input', renderCash));

function openCashModal(tipo) {
  openModal(`
    <h3>${tipo === 'ingreso' ? 'Ingreso manual' : 'Egreso manual'}</h3>
    <div class="field"><label>Monto</label><input type="number" id="cm_monto"></div>
    <div class="field"><label>Descripción</label><input id="cm_descripcion"></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveCashBtn" onclick="saveCashMovement('${tipo}')">Guardar</button>
    </div>
  `);
}

async function saveCashMovement(tipo) {
  const monto = Number(document.getElementById('cm_monto').value);
  if (!monto || monto <= 0) { showToast('Ingresá un monto válido.'); return; }
  const btn = document.getElementById('saveCashBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    await addManualCashMovement(tipo, monto, document.getElementById('cm_descripcion').value);
    closeModal();
    renderCash();
    showToast('Movimiento registrado.');
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

/* =================================== ENVÍOS ======================================= */

function calcularEnvio() {
  const km = Number(document.getElementById('calcKm').value);
  const total = Number(document.getElementById('calcTotal').value) || 0;
  const out = document.getElementById('calcResultado');
  if (!km && km !== 0) { out.textContent = 'Ingresá la distancia en km.'; return; }
  if (total >= DB.config.freeShippingFrom) { out.textContent = 'Envío gratis (supera el mínimo de compra).'; return; }
  const costo = shippingCostForKm(km);
  out.textContent = costo !== null ? `Costo de envío: ${fmt(costo)}` : 'Fuera del rango de tarifas cargadas (más de 18 km) — coordinar valor manualmente.';
}

function renderShipments() {
  const list = DB.shipments;
  document.getElementById('envioTableBody').innerHTML = list.length ? list.map(e => {
    const cli = DB.clients.find(c => c.id === e.clienteId);
    return `<tr><td>${fmtDate(e.fecha)}</td><td>${cli ? cli.nombre : '—'}</td><td>${e.direccion}</td>
      <td>${fmt(e.costoEnvio)}</td>
      <td><span class="badge ${e.estado === 'Entregado' ? 'badge-ok' : 'badge-info'}">${e.estado}</span></td>
      <td><select onchange="handleShipmentStatus('${e.id}', this.value)" style="background:var(--card);border:1px solid var(--line);border-radius:6px;color:var(--white);font-size:.75rem">
        ${['Pendiente', 'Preparando', 'En camino', 'Entregado'].map(s => `<option ${s === e.estado ? 'selected' : ''}>${s}</option>`).join('')}
      </select></td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty-state">Sin envíos registrados.</td></tr>';
}
async function handleShipmentStatus(id, estado) {
  try { await updateShipmentStatus(id, estado); renderShipments(); } catch (e) { showError(e); renderShipments(); }
}

function openShipmentModal() {
  openModal(`
    <h3>Nuevo envío</h3>
    <div class="field"><label>Cliente</label><select id="e_cliente">${clientOptions()}</select></div>
    <div class="two-col">
      <div class="field"><label>Dirección</label><input id="e_direccion"></div>
      <div class="field"><label>Localidad</label><input id="e_localidad"></div>
    </div>
    <div class="field"><label>Costo de envío</label><input type="number" id="e_costo"></div>
    <div class="field"><label>Observaciones</label><textarea id="e_obs"></textarea></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveShipmentBtn" onclick="saveShipment()">Guardar</button>
    </div>
  `);
}

async function saveShipment() {
  const btn = document.getElementById('saveShipmentBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';
  try {
    await registerShipment({
      clienteId: document.getElementById('e_cliente').value || null,
      direccion: document.getElementById('e_direccion').value,
      localidad: document.getElementById('e_localidad').value,
      costoEnvio: document.getElementById('e_costo').value,
      observaciones: document.getElementById('e_obs').value
    });
    closeModal();
    renderShipments();
    showToast('Envío registrado.');
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

/* =================================== REPORTES ======================================= */

function renderReportes() {
  const desde = document.getElementById('repDesde').value;
  const hasta = document.getElementById('repHasta').value;
  const inRange = iso => {
    const d = iso.slice(0, 10);
    if (desde && d < desde) return false;
    if (hasta && d > hasta) return false;
    return true;
  };
  // Las operaciones anuladas no cuentan en los reportes.
  const cuenta = modoCuentas() ? document.getElementById('repCuenta').value : '';
  let ventas = activeSales().filter(v => inRange(v.fecha));
  let compras = activePurchases().filter(c => inRange(c.fecha));
  const gastos = activeExpenses().filter(g => inRange(g.fecha));

  // Con una cuenta elegida: cada venta cuenta solo con la parte de esa cuenta.
  if (cuenta) {
    ventas = ventas.map(v => {
      const a = allocationsDeVenta(v.id).find(x => x.accountId === cuenta);
      if (!a) return null;
      return { ...v, total: a.total, costoTotal: a.costo, comisionTotal: a.comision, ganancia: a.ganancia,
               items: v.items.filter(i => cuentaDeLinea(i) === cuenta) };
    }).filter(Boolean);
    compras = compras.filter(c => c.accountId === cuenta);
  }
  const r = salesSummary(ventas);
  const totalCompras = round2(compras.reduce((a, c) => a + c.total, 0));
  const totalGastos = round2(cuenta
    ? gastos.reduce((a, g) => a + partesDeGasto(g.id).filter(x => x.accountId === cuenta).reduce((b, x) => b + x.importe, 0), 0)
    : gastos.reduce((a, g) => a + g.importe, 0));

  document.getElementById('repKpis').innerHTML = [
    kpiBox('Ventas totales', fmt(r.todas.total), `${r.todas.cantidad} ventas`, 'green'),
    kpiBox('Ventas propias', fmt(r.propia.total), `${r.propia.cantidad} ventas`, 'green'),
    kpiBox('Ventas por revendedor', fmt(r.revendedor.total), `${r.revendedor.cantidad} ventas`, 'green'),
    kpiBox('Comisiones de revendedores', fmt(r.todas.comision), '', r.todas.comision > 0 ? 'red' : ''),
    kpiBox('Ganancia bruta', fmt(r.todas.ganancia), 'después de comisiones, antes de gastos', 'gold'),
    kpiBox('Compras', fmt(totalCompras), '', ''),
    kpiBox('Gastos', fmt(totalGastos), cuenta ? 'parte de esta cuenta' : '', 'red'),
    kpiBox('Ganancia neta', fmt(round2(r.todas.ganancia - totalGastos)), 'ganancia bruta − gastos', 'gold')
  ].join('');

  document.getElementById('repModalidades').innerHTML = [['Venta propia', r.propia], ['Venta por revendedor', r.revendedor], ['Total', r.todas]]
    .map(([l, g], i) => `<tr${i === 2 ? ' style="font-weight:700"' : ''}><td>${l}</td><td>${g.cantidad}</td><td>${fmt(g.total)}</td>
      <td>${fmt(g.costo)}</td><td>${g.comision ? fmt(g.comision) : '—'}</td><td style="color:var(--gold)">${fmt(g.ganancia)}</td></tr>`).join('');

  const porProducto = {};
  ventas.forEach(v => v.items.forEach(it => {
    if (!porProducto[it.nombre]) porProducto[it.nombre] = { unidades: 0, total: 0 };
    porProducto[it.nombre].unidades += it.cantidad;
    porProducto[it.nombre].total += it.cantidad * it.precioVenta;
  }));
  const top = Object.entries(porProducto).sort((a, b) => b[1].unidades - a[1].unidades).slice(0, 15);
  document.getElementById('repTopProductos').innerHTML = top.length
    ? top.map(([nombre, d]) => `<tr><td>${esc(nombre)}</td><td>${d.unidades}</td><td>${fmt(round2(d.total))}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-state">No hay ventas en el rango seleccionado.</td></tr>';
}

/* =================================== CONFIGURACIÓN ======================================= */

function downloadBackup() {
  const json = exportBackupJSON();
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `eldostore-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  showToast('Respaldo descargado.');
}

document.getElementById('restoreFile')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Esto va a crear/actualizar productos en Supabase según el respaldo (por código). No toca ventas, compras ni gastos. ¿Continuar?')) { e.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const r = await importBackupJSON(reader.result);
      showToast(`Respaldo restaurado: ${r.productosRestaurados} productos.`);
    } catch (err) {
      showError(err);
    }
    e.target.value = '';
  };
  reader.readAsText(file, 'UTF-8');
});

async function handleMigrateInventory() {
  const btn = document.getElementById('migrateBtn');
  btn.disabled = true; btn.textContent = 'Migrando...';
  try {
    const r = await seedRealInventoryIfNeeded();
    if (r.yaEstaba) showToast('El inventario real ya estaba cargado, no se duplicó nada.');
    else showToast(`Inventario migrado: ${r.cargados} productos.`);
    renderProducts();
  } catch (e) { showError(e); }
  btn.disabled = false; btn.textContent = 'Migrar inventario real a Supabase';
}

async function handleChangePassword() {
  const nueva = document.getElementById('passNueva').value;
  const msgEl = document.getElementById('passMsg');
  if (!nueva || nueva.length < 6) { msgEl.style.color = 'var(--red)'; msgEl.textContent = 'La nueva contraseña debe tener al menos 6 caracteres.'; return; }
  const r = await changePassword(nueva);
  msgEl.style.color = r.ok ? 'var(--green)' : 'var(--red)';
  msgEl.textContent = r.ok ? 'Contraseña actualizada.' : r.error;
  if (r.ok) document.getElementById('passNueva').value = '';
}

/* ================================ CUENTAS (003) ================================== */
/* Solo se usa cuando la migración de tres cuentas está aplicada. */

async function renderCuentas() {
  if (!modoCuentas()) return;
  const desde = document.getElementById('ctaDesde').value;
  const hasta = document.getElementById('ctaHasta').value;
  const cont = document.getElementById('ctaResumen');
  cont.innerHTML = '<p style="color:var(--muted)">Calculando...</p>';
  try {
    const [resumen, posiciones] = await Promise.all([resumenCuentas(desde, hasta), posicionesCaja()]);
    const orden = id => CUENTAS.accounts.findIndex(a => a.id === id);
    resumen.sort((x, y) => orden(x.account_id) - orden(y.account_id));
    cont.innerHTML = resumen.map(r => `
      <div class="panel cuenta-card">
        <h3>${cuentaBadge(r.account_id)}</h3>
        <div class="cuenta-filas">
          <div><span>Ventas (${Number(r.ventas_cantidad)})</span><strong>${fmt(Number(r.ventas))}</strong></div>
          <div><span>Costo de lo vendido</span><strong>${fmt(Number(r.costo))}</strong></div>
          <div><span>Comisiones</span><strong>${fmt(Number(r.comisiones))}</strong></div>
          <div><span>Ganancia bruta</span><strong>${fmt(Number(r.ganancia_bruta))}</strong></div>
          <div><span>Gastos (su parte)</span><strong>${fmt(Number(r.gastos))}</strong></div>
          <div class="destacado"><span>Ganancia neta</span><strong>${fmt(Number(r.ganancia_neta))}</strong></div>
          <div><span>Compras de mercadería</span><strong>${fmt(Number(r.compras))}</strong></div>
          <div><span>Retiros / aportes</span><strong>${fmt(Number(r.retiros))} / ${fmt(Number(r.aportes))}</strong></div>
          <div><span>Repartos recibidos / enviados</span><strong>${fmt(Number(r.repartos_recibidos))} / ${fmt(Number(r.repartos_enviados))}</strong></div>
          <div class="destacado"><span>Saldo de caja (total)</span><strong>${fmt(Number(r.saldo_caja))}</strong></div>
        </div>
      </div>`).join('');

    // Matriz: de qué cuenta es el dinero (filas) y quién lo tiene (columnas)
    const holders = CUENTAS.holders.filter(h => h.activo);
    const saldo = (a, h) => Number((posiciones.find(p => p.account_id === a && p.holder_id === h) || {}).saldo || 0);
    document.getElementById('ctaPosiciones').innerHTML = `
      <thead><tr><th>Cuenta \\ Tiene el dinero</th>${holders.map(h => `<th>${esc(h.nombre)}</th>`).join('')}<th>Total</th></tr></thead>
      <tbody>${CUENTAS.accounts.map(a => `<tr><td>${esc(a.nombre)}</td>
        ${holders.map(h => `<td>${fmt(saldo(a.id, h.id))}</td>`).join('')}
        <td><strong>${fmt(round2(holders.reduce((s, h) => s + saldo(a.id, h.id), 0)))}</strong></td></tr>`).join('')}
        <tr><td><strong>Total</strong></td>${holders.map(h => `<td><strong>${fmt(round2(CUENTAS.accounts.reduce((s, a) => s + saldo(a.id, h.id), 0)))}</strong></td>`).join('')}
        <td><strong>${fmt(round2(posiciones.reduce((s, p) => s + Number(p.saldo), 0)))}</strong></td></tr></tbody>`;
  } catch (e) {
    cont.innerHTML = '';
    showError(e);
  }
  renderTransfers();
}

function lado(accountId, holderId) {
  return accountId || holderId ? `${esc(accountName(accountId))} · ${esc(holderName(holderId))}` : '—';
}

function renderTransfers() {
  const verAnuladas = document.getElementById('ctaVerAnulados').checked;
  const list = DB.transfers.filter(t => verAnuladas || !t.anulada);
  document.getElementById('ctaTransfers').innerHTML = list.length ? list.map(t => `
    <tr class="${t.anulada ? 'row-anulada' : ''}"><td>${fmtDate(t.fecha)}</td>
      <td class="no-strike">${esc(TIPOS_MOVIMIENTO[t.tipo] || t.tipo)}${t.anulada ? ` <span class="badge badge-anulada" title="${esc(t.motivoAnulacion)}">ANULADO</span>` : ''}</td>
      <td>${lado(t.fromAccountId, t.fromHolderId)}</td><td>${lado(t.toAccountId, t.toHolderId)}</td>
      <td>${fmt(t.monto)}</td>
      <td>${esc(t.motivo)}<div class="sub-info">cargó ${esc(userName(t.creadoPor))}${t.anulada ? ' · anuló ' + esc(userName(t.anuladoPor)) + ': ' + esc(t.motivoAnulacion) : ''}</div></td>
      <td class="row-actions no-strike">${t.anulada ? '' : `<button class="btn btn-sm btn-danger" onclick="handleVoidTransfer('${t.id}')">Anular</button>`}</td></tr>`).join('')
    : '<tr><td colspan="7" class="empty-state">Sin movimientos entre cuentas.</td></tr>';
}
document.getElementById('ctaVerAnulados')?.addEventListener('change', renderTransfers);

/* Qué lados usa cada tipo de movimiento (igual a las reglas de la base). */
const LADOS_MOVIMIENTO = {
  liquidacion: { desde: true, hacia: true, ayuda: 'Una persona le entrega a otra dinero de una misma cuenta. La cuenta no cambia; cambia quién lo tiene.' },
  reparto: { desde: true, hacia: true, ayuda: 'Pasa dinero de una cuenta a otra (reparto extraordinario). No es una venta ni un gasto.' },
  retiro: { desde: true, hacia: false, ayuda: 'Sale dinero de una cuenta (retiro personal).' },
  aporte: { desde: false, hacia: true, ayuda: 'Entra dinero a una cuenta (aporte de capital).' },
  apertura: { desde: false, hacia: true, ayuda: 'Saldo inicial de una cuenta. Usar una sola vez al empezar.' }
};

function openTransferModal() {
  openModal(`
    <h3>Movimiento entre cuentas</h3>
    <div class="field"><label>Tipo</label><select id="tr_tipo" onchange="actualizarLadosTransfer()">
      ${Object.entries(TIPOS_MOVIMIENTO).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select>
      <small id="tr_ayuda"></small></div>
    <div class="two-col" id="tr_desde">
      <div class="field"><label>Sale de la cuenta</label><select id="tr_fromAccount">${accountOptions(cuentaEldostoreId())}</select></div>
      <div class="field"><label>Lo entrega</label><select id="tr_fromHolder">${holderOptions(CUENTAS.miHolderId)}</select></div>
    </div>
    <div class="two-col" id="tr_hacia">
      <div class="field"><label>Entra a la cuenta</label><select id="tr_toAccount">${accountOptions(cuentaEldostoreId())}</select></div>
      <div class="field"><label>Lo recibe</label><select id="tr_toHolder">${holderOptions(CUENTAS.miHolderId)}</select></div>
    </div>
    <div class="field"><label>Monto</label><input type="number" min="0" step="0.01" id="tr_monto"></div>
    <div class="field"><label>Motivo *</label><input id="tr_motivo"></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="saveTransferBtn" onclick="saveTransfer()">Registrar</button>
    </div>`);
  actualizarLadosTransfer();
}

function actualizarLadosTransfer() {
  const l = LADOS_MOVIMIENTO[document.getElementById('tr_tipo').value];
  document.getElementById('tr_desde').style.display = l.desde ? '' : 'none';
  document.getElementById('tr_hacia').style.display = l.hacia ? '' : 'none';
  document.getElementById('tr_ayuda').textContent = l.ayuda;
}

async function saveTransfer() {
  const tipo = document.getElementById('tr_tipo').value;
  const l = LADOS_MOVIMIENTO[tipo];
  const v = id => document.getElementById(id).value;
  const datos = {
    tipo, monto: Number(v('tr_monto')), motivo: v('tr_motivo').trim(),
    fromAccountId: l.desde ? v('tr_fromAccount') : null, fromHolderId: l.desde ? v('tr_fromHolder') : null,
    toAccountId: l.hacia ? v('tr_toAccount') : null, toHolderId: l.hacia ? v('tr_toHolder') : null
  };
  if (!(datos.monto > 0)) { showToast('Ingresá un monto válido.'); return; }
  if (!datos.motivo) { showToast('Indicá el motivo.'); return; }
  if (tipo === 'liquidacion' && (datos.fromAccountId !== datos.toAccountId || datos.fromHolderId === datos.toHolderId)) {
    showToast('En una liquidación la cuenta es la misma y cambian las personas.'); return;
  }
  if (tipo === 'reparto' && datos.fromAccountId === datos.toAccountId) { showToast('Un reparto va de una cuenta a otra distinta.'); return; }
  const btn = document.getElementById('saveTransferBtn');
  btn.disabled = true; btn.textContent = 'Registrando...';
  try {
    await registerTransfer(datos);
    closeModal();
    showToast('Movimiento registrado.');
    if (document.getElementById('view-cuentas').classList.contains('active')) renderCuentas(); else renderCash();
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Registrar'; }
}

async function handleVoidTransfer(id) {
  const motivo = prompt('Motivo de la anulación (queda registrado):');
  if (motivo === null) return;
  if (!motivo.trim()) { showToast('Indicá el motivo.'); return; }
  try {
    await voidTransfer(id, motivo.trim());
    showToast('Movimiento anulado.');
    renderCuentas();
  } catch (e) { showError(e); }
}

/* ===================== CONFIGURACIÓN: usuarios del panel (003) ===================== */

function renderConfig() {
  const el = document.getElementById('cfgUsuarios');
  if (!el || !modoCuentas()) return;
  el.innerHTML = CUENTAS.users.length ? CUENTAS.users.map(u => `
    <tr><td>${esc(u.nombre) || '—'}${u.user_id === CUENTAS.miUserId ? ' <span class="badge badge-ok">vos</span>' : ''}</td>
      <td>${esc(holderName(u.holder_id))}</td>
      <td>${u.es_admin ? '<span class="badge badge-pend">administrador</span> ' : ''}${u.activo ? '<span class="badge badge-ok">activo</span>' : '<span class="badge badge-warn">inactivo</span>'}</td></tr>`).join('')
    : '<tr><td colspan="3" class="empty-state">Sin usuarios.</td></tr>';
  // Solo el administrador ve el formulario (la base igual lo exige en vincular_usuario).
  const admin = soyAdministrador();
  document.getElementById('cfgAdminForm').style.display = admin ? '' : 'none';
  document.getElementById('cfgSoloAdmin').style.display = admin ? 'none' : '';
  if (admin) document.getElementById('cfgHolder').innerHTML = holderOptions(null);
}
function soyAdministrador() {
  const yo = CUENTAS.users.find(u => u.user_id === CUENTAS.miUserId);
  return !!(yo && yo.activo && yo.es_admin);
}

async function handleVincularUsuario() {
  const email = document.getElementById('cfgEmail').value.trim();
  const holderId = document.getElementById('cfgHolder').value;
  const activo = document.getElementById('cfgActivo').checked;
  if (!email) { showToast('Ingresá el email con el que la persona entra al panel.'); return; }
  const actual = CUENTAS.users.find(u => (u.nombre || '').toLowerCase() === email.toLowerCase());
  if (!activo && !confirm(`¿Desactivar el acceso de ${email}? No podrá entrar al panel hasta que lo vuelvas a activar.`)) return;
  if (activo && !actual && !confirm(`¿Autorizar a ${email} a usar el panel como ${holderName(holderId)}?`)) return;
  try {
    await vincularUsuario(email, holderId, activo);
    document.getElementById('cfgEmail').value = '';
    showToast('Usuario actualizado.');
    renderConfig();
  } catch (e) { showError(e); }
}

/* ======================= PROMOCIONES (migración 005) =======================
   Descuentos en ventas y productos, y la sección "Tienda online": banners,
   carrusel intermedio, categorías, ofertas flash y descuentos.
   Todo se guarda con funciones de la base que exigen al administrador. */

let saleDescuentos = null;   // descuentos de la fecha del pedido (null = ahora)
let saleFechaPedido = '';
const ORIGEN_DTO = { manual: 'descuento', flash: 'oferta flash' };

function precioPromoHTML(p) {
  if (!PROMOS.disponible) return '';
  const d = descuentoVigente(p.id);
  return d ? `<br><span class="badge badge-dto">−${d.porcentaje}% · ${fmt(precioConDescuento(p.precio, d.porcentaje))}</span>` : '';
}

function fechaPedidoISO() { return saleFechaPedido ? new Date(saleFechaPedido).toISOString() : null; }

function aplicarDescuentoLinea(linea) {
  const momento = saleFechaPedido ? Date.parse(new Date(saleFechaPedido).toISOString()) : null;
  const d = PROMOS.disponible ? descuentoVigente(linea.productoId, saleDescuentos || PROMOS.descuentos, momento) : null;
  linea.descuentoDisponible = d ? { porcentaje: d.porcentaje, origen: d.origen, vence: d.vence } : null;
  if (d && !linea.usarHabitual) {
    linea.precioVenta = precioConDescuento(linea.precioHabitual, d.porcentaje);
    linea.descuentoPct = d.porcentaje; linea.descuentoOrigen = d.origen;
  } else {
    linea.precioVenta = linea.precioHabitual;
    linea.descuentoPct = null; linea.descuentoOrigen = null;
  }
}

function lineaDescuentoHTML(it, i) {
  if (saleEditingId || !it.descuentoDisponible) return '';
  const d = it.descuentoDisponible;
  return it.descuentoPct
    ? `<br><small class="dto-linea">${d.porcentaje}% OFF (${ORIGEN_DTO[d.origen] || d.origen}) · habitual ${fmt(it.precioHabitual)}</small>
       <br><button type="button" class="link-btn" onclick="toggleDescuentoLinea(${i})">Usar precio habitual</button>`
    : `<br><small>Precio habitual</small><br><button type="button" class="link-btn" onclick="toggleDescuentoLinea(${i})">Aplicar ${d.porcentaje}% OFF</button>`;
}
function toggleDescuentoLinea(i) {
  const it = saleDraftItems[i]; if (!it) return;
  it.usarHabitual = !it.usarHabitual;
  aplicarDescuentoLinea(it);
  renderSaleDraftItems();
}
async function cambiarFechaPedido(valor) {
  saleFechaPedido = valor || '';
  try {
    saleDescuentos = saleFechaPedido ? await descuentosEn(fechaPedidoISO()) : null;
  } catch (e) { showError(e); saleFechaPedido = ''; saleDescuentos = null; const f = document.getElementById('v_fechaPedido'); if (f) f.value = ''; }
  saleDraftItems.forEach(aplicarDescuentoLinea);
  renderSaleDraftItems();
}

/* ------------------------- Descuento de un producto ------------------------- */
function openDescuentoModal(productId) {
  if (!PROMOS.esAdmin) { showToast('Solo el administrador puede cambiar descuentos.'); return; }
  const p = DB.products.find(x => x.id === productId); if (!p) return;
  const d = descuentoVigente(p.id);
  const manual = d && d.origen === 'manual';
  openModal(`
    <h3>Descuento: ${esc(p.nombre)}</h3>
    <p class="muted-sm">Código ${esc(p.codigo)} · precio habitual <strong>${fmt(p.precio)}</strong> (no cambia).</p>
    ${d ? `<div class="notice">Ahora tiene <strong>${d.porcentaje}% OFF</strong> (${ORIGEN_DTO[d.origen]})${d.vence ? ' hasta ' + fmtDate(d.vence) : ''}: ${fmt(precioConDescuento(p.precio, d.porcentaje))}.
      ${d.origen === 'flash' ? '<br>Mientras dure la oferta flash vale su porcentaje; al terminar vuelve este descuento manual, si lo ponés.' : ''}</div>` : ''}
    <div class="field"><label>Porcentaje</label>
      <div class="chips">${[10, 15, 20, 25, 30, 35, 40, 50, 60].map(n => `<button type="button" class="chip" onclick="elegirPct(${n})">${n}%</button>`).join('')}</div>
      <input type="number" id="dto_pct" min="1" max="90" step="1" inputmode="numeric" placeholder="Otro (1 a 90)" value="${manual ? d.porcentaje : ''}" oninput="vistaPreviaDto(${p.precio})">
      <p id="dto_vista" class="muted-sm"></p>
    </div>
    <div class="field"><label>Termina (opcional)</label><input type="datetime-local" id="dto_hasta"><small>Vacío = hasta que lo quites.</small></div>
    <div class="modal-actions">
      ${manual ? `<button class="btn btn-sm btn-danger" onclick="quitarDescuentoUI('${p.id}')">Quitar descuento</button>` : ''}
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="dtoBtn" onclick="guardarDescuentoUI('${p.id}')">Guardar</button>
    </div>`);
  vistaPreviaDto(p.precio);
}
function elegirPct(n) { const i = document.getElementById('dto_pct'); i.value = n; i.dispatchEvent(new Event('input')); }
function vistaPreviaDto(precio) {
  const n = Number(document.getElementById('dto_pct').value);
  document.getElementById('dto_vista').innerHTML = n >= 1 && n <= 90
    ? `Precio con descuento: <strong>${fmt(precioConDescuento(precio, n))}</strong> (habitual ${fmt(precio)})` : '';
}
async function guardarDescuentoUI(productId) {
  const n = Number(document.getElementById('dto_pct').value);
  if (!(n >= 1 && n <= 90) || n !== Math.trunc(n)) { showToast('Elegí un porcentaje entero de 1 a 90.'); return; }
  const h = document.getElementById('dto_hasta').value;
  const btn = document.getElementById('dtoBtn'); btn.disabled = true;
  try {
    await ponerDescuento(productId, n, h ? new Date(h).toISOString() : null);
    closeModal(); showToast(`Descuento de ${n}% aplicado.`); refrescarVistaActual();
  } catch (e) { showError(e); btn.disabled = false; }
}
async function quitarDescuentoUI(productId) {
  if (!confirm('¿Quitar el descuento? El producto vuelve a su precio habitual.')) return;
  try { await quitarDescuento(productId); closeModal(); showToast('Descuento quitado.'); refrescarVistaActual(); }
  catch (e) { showError(e); }
}
function refrescarVistaActual() {
  const v = document.querySelector('.view.active');
  if (v && v.id === 'view-productos') renderProducts();
  if (v && v.id === 'view-tienda') renderTienda();
}

/* --------------------------- Vista "Tienda online" -------------------------- */
let tiendaTab = 'banners';
const TABS_TIENDA = [['banners', 'Banners'], ['intermedio', 'Carrusel intermedio'], ['categorias', 'Categorías'], ['flash', 'Ofertas flash'], ['descuentos', 'Descuentos']];

function renderTienda() {
  const el = document.getElementById('tiendaContenido'); if (!el) return;
  if (!PROMOS.disponible) {
    el.innerHTML = `<div class="panel"><h3>Falta instalar la migración 005</h3>
      <p class="muted-sm">Cuando esté instalada, desde acá vas a administrar banners, categorías, ofertas flash y descuentos de la tienda.</p></div>`;
    return;
  }
  const tabs = `<div class="tabs" role="tablist">${TABS_TIENDA.map(([k, t]) =>
    `<button type="button" role="tab" class="tab${tiendaTab === k ? ' on' : ''}" aria-selected="${tiendaTab === k}" onclick="tiendaTab='${k}';renderTienda()">${t}</button>`).join('')}</div>`;
  const aviso = PROMOS.esAdmin ? '' : '<div class="notice">Solo el administrador puede hacer cambios. Vos podés ver la configuración.</div>';
  const cuerpo = { banners: () => htmlBanners('principal'), intermedio: () => htmlBanners('intermedio'),
                   categorias: htmlCategorias, flash: htmlFlash, descuentos: htmlDescuentos }[tiendaTab]();
  el.innerHTML = tabs + aviso + cuerpo;
}
const adminOnly = () => PROMOS.esAdmin ? '' : 'disabled';

/* Banners (principal e intermedio) */
function htmlBanners(ubicacion) {
  const lista = PROMOS.banners.filter(b => b.ubicacion === ubicacion);
  const activos = lista.filter(b => b.activo).length;
  const princ = ubicacion === 'principal';
  return `<div class="panel">
    <h3>${princ ? 'Banners principales' : 'Carrusel entre productos'}</h3>
    <p class="muted-sm">${princ
      ? `Carrusel de arriba de la tienda. Hasta 7 activos (ahora ${activos}). Medida ideal: 1600 × 700 px. Sin banners activos se muestra el banner actual.`
      : `Aparece entre los productos, aproximadamente cada 14. Medida ideal: 1600 × 500 px. Activos: ${activos}.`}</p>
    <label class="btn btn-primary btn-sm file-btn ${adminOnly() ? 'is-disabled' : ''}">+ Agregar imagen
      <input type="file" accept="image/*" ${adminOnly()} onchange="agregarBannerUI('${ubicacion}', this)"></label>
    <div class="promo-list">${lista.length ? lista.map((b, i) => `
      <div class="promo-item${b.activo ? '' : ' off'}">
        <img src="${esc(b.imagen_url)}" alt="${esc(b.texto_alt)}" class="promo-thumb wide" loading="lazy">
        <div class="promo-meta">
          <strong>${b.activo ? '● Activo' : '○ Inactivo'}</strong>
          <small>${enlaceTexto(b)}</small>
        </div>
        <div class="promo-acc">
          <button class="btn btn-sm" ${adminOnly()} ${i === 0 ? 'disabled' : ''} onclick="moverBanner('${ubicacion}', ${i}, -1)" aria-label="Subir">↑</button>
          <button class="btn btn-sm" ${adminOnly()} ${i === lista.length - 1 ? 'disabled' : ''} onclick="moverBanner('${ubicacion}', ${i}, 1)" aria-label="Bajar">↓</button>
          <button class="btn btn-sm" ${adminOnly()} onclick="activarBannerUI('${b.id}', ${!b.activo})">${b.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-sm" ${adminOnly()} onclick="editarBannerUI('${b.id}')">Editar</button>
          <button class="btn btn-sm btn-danger" ${adminOnly()} onclick="eliminarBannerUI('${b.id}')">Eliminar</button>
        </div>
      </div>`).join('') : '<p class="muted-sm">Todavía no hay imágenes.</p>'}</div>
  </div>`;
}
function enlaceTexto(b) {
  if (b.enlace_tipo === 'producto') { const p = DB.products.find(x => x.codigo === b.enlace_valor); return 'Abre el producto ' + esc(b.enlace_valor) + (p ? ' · ' + esc(p.nombre) : ' (no encontrado)'); }
  if (b.enlace_tipo === 'categoria') return 'Abre la categoría ' + esc(b.enlace_valor);
  if (b.enlace_tipo === 'url') return 'Abre ' + esc(b.enlace_valor);
  return 'Sin enlace';
}
/* Al elegir la imagen se muestra la vista previa optimizada; se sube recién al tocar "Agregar". */
async function agregarBannerUI(ubicacion, input) {
  const f = input.files[0]; input.value = ''; if (!f) return;
  openModal(`
    <h3>Agregar imagen</h3>
    <div id="bnNuevoPrev" class="img-prev"></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="bnNuevoBtn" disabled onclick="confirmarBannerUI('${ubicacion}')">Agregar</button>
    </div>`);
  agregarBannerUI._img = null;
  try {
    agregarBannerUI._img = await mostrarVistaPrevia(f, 'banner', document.getElementById('bnNuevoPrev'));
    document.getElementById('bnNuevoBtn').disabled = false;
  } catch (e) { /* el aviso ya está en la vista previa */ }
}
async function confirmarBannerUI(ubicacion) {
  const img = agregarBannerUI._img; if (!img) return;
  const btn = document.getElementById('bnNuevoBtn'); btn.disabled = true; btn.textContent = 'Subiendo…';
  const activos = PROMOS.banners.filter(b => b.ubicacion === ubicacion && b.activo).length;
  try {
    const url = await subirImagenPromo(img, 'banners');
    await guardarBanner({ ubicacion, imagen_url: url, activo: !(ubicacion === 'principal' && activos >= 7) });
    agregarBannerUI._img = null;
    closeModal();
    showToast(ubicacion === 'principal' && activos >= 7 ? 'Imagen agregada como inactiva (ya hay 7 activas).' : 'Imagen agregada.');
    renderTienda();
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Agregar'; }
}
async function moverBanner(ubicacion, i, dir) {
  const ids = PROMOS.banners.filter(b => b.ubicacion === ubicacion).map(b => b.id);
  [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
  try { await ordenarBanners(ubicacion, ids); renderTienda(); } catch (e) { showError(e); }
}
async function activarBannerUI(id, activo) {
  const b = PROMOS.banners.find(x => x.id === id); if (!b) return;
  try { await guardarBanner(Object.assign({}, b, { activo })); renderTienda(); } catch (e) { showError(e); }
}
async function eliminarBannerUI(id) {
  if (!confirm('¿Eliminar esta imagen del carrusel?')) return;
  try { await eliminarBanner(id); showToast('Imagen eliminada.'); renderTienda(); } catch (e) { showError(e); }
}
function editarBannerUI(id) {
  const b = PROMOS.banners.find(x => x.id === id); if (!b) return;
  openModal(`
    <h3>Editar imagen</h3>
    <img src="${esc(b.imagen_url)}" alt="" id="bn_prev" class="promo-thumb wide" style="margin-bottom:10px">
    <div class="field"><label>Reemplazar imagen</label><input type="file" accept="image/*" id="bn_file">
      <div id="bn_file_prev" class="img-prev" hidden></div></div>
    <div class="field"><label>Texto alternativo (para lectores de pantalla)</label><input id="bn_alt" maxlength="160" value="${esc(b.texto_alt)}"></div>
    <div class="field"><label>Al tocar la imagen</label>
      <select id="bn_tipo" onchange="camposEnlace()">
        ${[['ninguno', 'No hace nada'], ['producto', 'Abre un producto'], ['categoria', 'Abre una categoría'], ['url', 'Abre una página web']]
          .map(([v, t]) => `<option value="${v}" ${b.enlace_tipo === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select></div>
    <div class="field" id="bn_valorBox"></div>
    <label class="check-row"><input type="checkbox" id="bn_activo" ${b.activo ? 'checked' : ''}> Activo</label>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="bnBtn" onclick="guardarBannerUI('${b.id}')">Guardar</button>
    </div>`);
  camposEnlace(b.enlace_valor);
  conectarVistaPrevia('bn_file', 'banner', 'bn_file_prev');
}
function camposEnlace(valor) {
  const tipo = document.getElementById('bn_tipo').value, box = document.getElementById('bn_valorBox');
  const v = valor !== undefined ? valor : '';
  box.innerHTML = tipo === 'producto' ? `<label>Código del producto</label><input id="bn_valor" value="${esc(v)}" placeholder="Ej.: 009" list="bn_codigos">
      <datalist id="bn_codigos">${DB.products.map(p => `<option value="${esc(p.codigo)}">${esc(p.nombre)}</option>`).join('')}</datalist>`
    : tipo === 'categoria' ? `<label>Categoría</label><select id="bn_valor">${PROMOS.categorias.map(c => `<option ${c.nombre === v ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>`
    : tipo === 'url' ? `<label>Dirección (https://…)</label><input id="bn_valor" type="url" value="${esc(v)}" placeholder="https://">` : '';
}
async function guardarBannerUI(id) {
  const b = PROMOS.banners.find(x => x.id === id); if (!b) return;
  const tipo = document.getElementById('bn_tipo').value;
  const valorEl = document.getElementById('bn_valor');
  const valor = valorEl ? valorEl.value.trim() : '';
  if (tipo === 'producto' && !DB.products.some(p => p.codigo === valor)) { showToast('No existe un producto con ese código.'); return; }
  if (tipo === 'url' && !/^https:\/\/\S+$/.test(valor)) { showToast('La dirección tiene que empezar con https://'); return; }
  const btn = document.getElementById('bnBtn'); btn.disabled = true;
  let img = null;
  try { img = await imagenElegida('bn_file', 'banner'); }
  catch (e) { showToast(e.message); btn.disabled = false; return; }
  try {
    const url = img ? await subirImagenPromo(img, 'banners') : b.imagen_url;
    await guardarBanner(Object.assign({}, b, { imagen_url: url, texto_alt: document.getElementById('bn_alt').value,
      enlace_tipo: tipo, enlace_valor: tipo === 'ninguno' ? '' : valor, activo: document.getElementById('bn_activo').checked }));
    closeModal(); showToast('Imagen guardada.'); renderTienda();
  } catch (e) { showError(e); btn.disabled = false; }
}

/* Categorías */
function htmlCategorias() {
  const lista = PROMOS.categorias;
  return `<div class="panel">
    <h3>Categorías</h3>
    <p class="muted-sm">El orden de esta lista es el de la tienda. Imagen ideal: cuadrada, 400 × 400 px. Una categoría oculta no se muestra como botón, pero sus productos siguen a la venta.</p>
    <button class="btn btn-primary btn-sm" ${adminOnly()} onclick="editarCategoriaUI('')">+ Nueva categoría</button>
    <div class="promo-list">${lista.map((c, i) => `
      <div class="promo-item${c.visible ? '' : ' off'}">
        ${c.imagen_url ? `<img src="${esc(c.imagen_url)}" alt="" class="promo-thumb" loading="lazy">` : '<span class="promo-thumb vacio">Sin imagen</span>'}
        <div class="promo-meta"><strong>${esc(c.nombre)}</strong><small>${c.productos} producto${c.productos === 1 ? '' : 's'} · ${c.visible ? 'visible' : 'oculta'}</small></div>
        <div class="promo-acc">
          <button class="btn btn-sm" ${adminOnly()} ${i === 0 ? 'disabled' : ''} onclick="moverCategoria(${i}, -1)" aria-label="Subir">↑</button>
          <button class="btn btn-sm" ${adminOnly()} ${i === lista.length - 1 ? 'disabled' : ''} onclick="moverCategoria(${i}, 1)" aria-label="Bajar">↓</button>
          <button class="btn btn-sm" ${adminOnly()} onclick="visibleCategoriaUI('${c.id}', ${!c.visible})">${c.visible ? 'Ocultar' : 'Mostrar'}</button>
          <button class="btn btn-sm" ${adminOnly()} onclick="editarCategoriaUI('${c.id}')">Editar</button>
          ${c.productos ? `<button class="btn btn-sm" ${adminOnly()} onclick="reasignarCategoriaUI('${c.id}')">Mover productos</button>`
                        : `<button class="btn btn-sm btn-danger" ${adminOnly()} onclick="eliminarCategoriaUI('${c.id}')">Eliminar</button>`}
        </div>
      </div>`).join('')}</div>
  </div>`;
}
async function moverCategoria(i, dir) {
  const ids = PROMOS.categorias.map(c => c.id);
  [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
  try { await ordenarCategorias(ids); renderTienda(); } catch (e) { showError(e); }
}
async function visibleCategoriaUI(id, visible) {
  const c = PROMOS.categorias.find(x => x.id === id); if (!c) return;
  try { await guardarCategoria(Object.assign({}, c, { visible })); renderTienda(); } catch (e) { showError(e); }
}
function editarCategoriaUI(id) {
  const c = id ? PROMOS.categorias.find(x => x.id === id) : null;
  openModal(`
    <h3>${c ? 'Editar categoría' : 'Nueva categoría'}</h3>
    <div class="field"><label>Nombre</label><input id="ct_nombre" maxlength="60" value="${c ? esc(c.nombre) : ''}">
      ${c && c.productos ? `<small>Si cambiás el nombre, se actualiza en sus ${c.productos} producto(s). No cambian precios ni stock.</small>` : ''}</div>
    ${c && c.imagen_url ? `<img src="${esc(c.imagen_url)}" alt="" class="promo-thumb" style="margin-bottom:8px">
      <label class="check-row"><input type="checkbox" id="ct_sinImagen"> Quitar la imagen</label>` : ''}
    <div class="field"><label>${c && c.imagen_url ? 'Reemplazar imagen' : 'Imagen (opcional)'}</label><input type="file" accept="image/*" id="ct_file">
      <div id="ct_file_prev" class="img-prev" hidden></div></div>
    <label class="check-row"><input type="checkbox" id="ct_visible" ${!c || c.visible ? 'checked' : ''}> Visible en la tienda</label>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="ctBtn" onclick="guardarCategoriaUI('${c ? c.id : ''}')">Guardar</button>
    </div>`);
  conectarVistaPrevia('ct_file', 'categoria', 'ct_file_prev');
}
async function guardarCategoriaUI(id) {
  const c = id ? PROMOS.categorias.find(x => x.id === id) : null;
  const nombre = document.getElementById('ct_nombre').value.trim();
  if (!nombre) { showToast('Escribí el nombre.'); return; }
  if (c && c.productos && nombre !== c.nombre && !confirm(`Se va a cambiar "${c.nombre}" por "${nombre}" en ${c.productos} producto(s). ¿Continuar?`)) return;
  const btn = document.getElementById('ctBtn'); btn.disabled = true;
  let img = null;
  try { img = await imagenElegida('ct_file', 'categoria'); }
  catch (e) { showToast(e.message); btn.disabled = false; return; }
  try {
    const quitar = document.getElementById('ct_sinImagen') && document.getElementById('ct_sinImagen').checked;
    const url = img ? await subirImagenPromo(img, 'categorias') : (quitar ? '' : (c ? c.imagen_url : ''));
    const r = await guardarCategoria({ id: id || null, nombre, imagen_url: url, visible: document.getElementById('ct_visible').checked });
    closeModal(); populateCategorySelects();
    showToast(r && r.productos_actualizados ? `Categoría guardada. ${r.productos_actualizados} producto(s) actualizados.` : 'Categoría guardada.');
    renderTienda();
  } catch (e) { showError(e); btn.disabled = false; }
}
function reasignarCategoriaUI(id) {
  const c = PROMOS.categorias.find(x => x.id === id); if (!c) return;
  openModal(`
    <h3>Mover productos de "${esc(c.nombre)}"</h3>
    <p class="muted-sm">Los ${c.productos} producto(s) pasan a la categoría que elijas. No cambian precios ni stock. Después vas a poder eliminar "${esc(c.nombre)}".</p>
    <div class="field"><label>Nueva categoría</label><select id="ct_destino">${PROMOS.categorias.filter(x => x.id !== id)
      .map(x => `<option value="${x.id}">${esc(x.nombre)}</option>`).join('')}</select></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" onclick="confirmarReasignar('${id}')">Mover</button>
    </div>`);
}
async function confirmarReasignar(id) {
  try {
    const r = await reasignarCategoria(id, document.getElementById('ct_destino').value);
    closeModal(); showToast(`${r.productos_movidos} producto(s) movidos.`); renderTienda();
  } catch (e) { showError(e); }
}
async function eliminarCategoriaUI(id) {
  const c = PROMOS.categorias.find(x => x.id === id); if (!c) return;
  if (!confirm(`¿Eliminar la categoría "${c.nombre}"? No tiene productos.`)) return;
  try { await eliminarCategoria(id); populateCategorySelects(); showToast('Categoría eliminada.'); renderTienda(); } catch (e) { showError(e); }
}

/* Ofertas flash: UNA campaña con varios productos, cada uno con su %, y una sola fecha de inicio y fin */
function htmlFlash() {
  const f = PROMOS.flash;
  const prod = id => DB.products.find(p => p.id === id);
  const lista = f ? f.productos.map(x => ({ x, p: prod(x.productId) })).filter(o => o.p) : [];
  return `<div class="panel">
    <h3>Oferta flash</h3>
    <p class="muted-sm">Una campaña a la vez, con varios productos y un temporizador. Cada producto tiene su propio %. Al terminar, todos vuelven solos a su precio anterior.</p>
    ${f ? `<div class="notice"><strong>${esc(f.titulo)}</strong> · ${lista.length} producto${lista.length === 1 ? '' : 's'}<br>
        ${Date.parse(f.inicia) > ahoraServidor() ? 'Empieza ' + fmtDate(f.inicia) + ' · ' : 'En curso · '}termina ${fmtDate(f.termina)}</div>
      <div class="promo-list">${lista.map(({ x, p }) => `
        <div class="promo-item"><div class="promo-meta"><strong>${esc(p.nombre)}</strong>
          <small>Código ${esc(p.codigo)} · <b>${x.porcentaje}% OFF</b> · <s>${fmt(p.precio)}</s> → ${fmt(precioConDescuento(p.precio, x.porcentaje))}</small></div></div>`).join('')}</div>
      <div class="toolbar"><button class="btn btn-primary btn-sm" ${adminOnly()} onclick="editarFlashUI()">Agregar o quitar productos</button>
        <button class="btn btn-sm btn-danger" ${adminOnly()} onclick="terminarFlashUI()">Terminar ahora</button></div>`
    : `<p>No hay una oferta flash vigente.</p><button class="btn btn-primary btn-sm" ${adminOnly()} onclick="editarFlashUI()">+ Crear oferta flash</button>`}
  </div>`;
}
let flashBorrador = [];
let flashFechasOriginales = null;
// Si no se tocó la fecha, se manda la original exacta (el campo del formulario no tiene segundos)
function fechaFlash(valor, original) { return original && valor === aLocal(original) ? original : new Date(valor).toISOString(); }
const aLocal = iso => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function editarFlashUI() {
  const f = PROMOS.flash;
  flashBorrador = f ? f.productos.filter(x => DB.products.some(p => p.id === x.productId))
                                 .map(x => ({ productId: x.productId, porcentaje: x.porcentaje })) : [];
  const ahora = new Date(ahoraServidor());
  flashFechasOriginales = f ? { inicia: f.inicia, termina: f.termina } : null;
  openModal(`
    <h3>${f ? 'Editar la oferta flash' : 'Nueva oferta flash'}</h3>
    ${f ? '<div class="notice">Se mantienen el título y las fechas de la campaña (podés cambiarlos). Al guardar, la tienda se actualiza con la lista nueva.</div>' : ''}
    <div class="field"><label>Título</label><input id="fl_titulo" maxlength="80" value="${f ? esc(f.titulo) : 'Ofertas flash'}"></div>
    <div class="two-col">
      <div class="field"><label>Empieza</label><input type="datetime-local" id="fl_inicia" value="${aLocal(f ? f.inicia : ahora)}"></div>
      <div class="field"><label>Termina</label><input type="datetime-local" id="fl_termina" value="${aLocal(f ? f.termina : new Date(ahora.getTime() + 24 * 3600e3))}"></div>
    </div>
    <div class="field"><label>Agregar productos a la campaña</label>
      <input id="fl_buscar" placeholder="Buscar por código o nombre" oninput="buscarFlash(this.value)" autocomplete="off" enterkeyhint="search">
      <small>Podés agregar todos los productos que quieras, de a uno.</small>
      <div id="fl_resultados" class="busca-res"></div></div>
    <div class="flash-sel">
      <div class="flash-sel-hd"><strong id="fl_cant">Productos de la campaña (0)</strong>
        <span class="flash-todos">Mismo % para todos <input type="number" id="fl_todos" min="1" max="90" inputmode="numeric" class="pct-in" aria-label="Porcentaje para todos">
          <button type="button" class="btn btn-sm" onclick="pctTodosFlash()">Aplicar</button></span></div>
      <div id="fl_lista"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="flBtn" onclick="guardarFlashUI()">Guardar oferta</button>
    </div>`, true);
  dibujarFlashBorrador();
}
function buscarFlash(q) {
  const t = q.trim().toLowerCase(), el = document.getElementById('fl_resultados');
  if (!t) { el.innerHTML = ''; return; }
  const res = DB.products.filter(p => (p.codigo + ' ' + p.nombre).toLowerCase().includes(t)).slice(0, 8);
  el.innerHTML = res.map(p => flashBorrador.some(x => x.productId === p.id)
      ? `<div class="busca-item ya">${esc(p.codigo)} · ${esc(p.nombre)} <span>✓ En la campaña</span></div>`
      : `<button type="button" class="busca-item" onclick="agregarFlash('${p.id}')">${esc(p.codigo)} · ${esc(p.nombre)} <span>${fmt(p.precio)} · + Agregar</span></button>`).join('')
    || '<small>Sin resultados.</small>';
}
function agregarFlash(id) {
  if (flashBorrador.some(x => x.productId === id)) return;
  const todos = Number(document.getElementById('fl_todos').value);
  flashBorrador.push({ productId: id, porcentaje: todos >= 1 && todos <= 90 ? Math.trunc(todos) : 20 });
  const b = document.getElementById('fl_buscar'); b.value = ''; document.getElementById('fl_resultados').innerHTML = '';
  dibujarFlashBorrador();
  const p = DB.products.find(x => x.id === id);
  showToast(`Agregado: ${p ? p.nombre : 'producto'}. Podés buscar otro.`);
  b.focus();
}
function quitarFlash(i) { flashBorrador.splice(i, 1); dibujarFlashBorrador(); }
function moverFlash(i, dir) {
  const j = i + dir; if (j < 0 || j >= flashBorrador.length) return;
  [flashBorrador[i], flashBorrador[j]] = [flashBorrador[j], flashBorrador[i]]; dibujarFlashBorrador();
}
function pctFlash(i, valor) {
  const n = Number(valor); flashBorrador[i].porcentaje = n;
  const p = DB.products.find(q => q.id === flashBorrador[i].productId);
  const el = document.getElementById('fl_p' + i);
  if (p && el) el.textContent = n >= 1 && n <= 90 ? fmt(precioConDescuento(p.precio, n)) : '—';
}
function pctTodosFlash() {
  const n = Number(document.getElementById('fl_todos').value);
  if (!(n >= 1 && n <= 90) || n !== Math.trunc(n)) { showToast('Elegí un porcentaje entero de 1 a 90.'); return; }
  flashBorrador.forEach(x => { x.porcentaje = n; }); dibujarFlashBorrador();
}
function dibujarFlashBorrador() {
  const el = document.getElementById('fl_lista'); if (!el) return;
  document.getElementById('fl_cant').textContent = `Productos de la campaña (${flashBorrador.length})`;
  el.innerHTML = flashBorrador.length ? flashBorrador.map((x, i) => {
    const p = DB.products.find(q => q.id === x.productId); if (!p) return '';
    return `<div class="promo-item flash-it"><div class="promo-meta"><strong>${i + 1}. ${esc(p.nombre)}</strong>
        <small>${esc(p.codigo)} · <s>${fmt(p.precio)}</s> → <b id="fl_p${i}">${fmt(precioConDescuento(p.precio, x.porcentaje))}</b></small></div>
      <div class="promo-acc"><label class="pct-lbl"><input type="number" min="1" max="90" step="1" inputmode="numeric" class="pct-in" value="${x.porcentaje}"
          aria-label="Porcentaje de ${esc(p.nombre)}" oninput="pctFlash(${i}, this.value)"> % OFF</label>
        <button type="button" class="btn btn-sm" ${i === 0 ? 'disabled' : ''} onclick="moverFlash(${i}, -1)" aria-label="Subir">↑</button>
        <button type="button" class="btn btn-sm" ${i === flashBorrador.length - 1 ? 'disabled' : ''} onclick="moverFlash(${i}, 1)" aria-label="Bajar">↓</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="quitarFlash(${i})">Quitar</button></div></div>`;
  }).join('') : '<p class="muted-sm">Todavía no elegiste productos. Buscalos arriba y tocá "+ Agregar".</p>';
}
async function guardarFlashUI() {
  const inicia = document.getElementById('fl_inicia').value, termina = document.getElementById('fl_termina').value;
  if (!inicia || !termina || new Date(termina) <= new Date(inicia)) { showToast('Revisá las fechas: el fin tiene que ser posterior al inicio.'); return; }
  if (new Date(termina).getTime() <= ahoraServidor()) { showToast('La fecha de fin ya pasó.'); return; }
  if (!flashBorrador.length) { showToast('Agregá al menos un producto.'); return; }
  if (flashBorrador.some(x => !(x.porcentaje >= 1 && x.porcentaje <= 90) || x.porcentaje !== Math.trunc(x.porcentaje))) { showToast('Cada producto necesita un porcentaje entero de 1 a 90.'); return; }
  const btn = document.getElementById('flBtn'); btn.disabled = true;
  try {
    const o = flashFechasOriginales || {};
    await guardarOfertaFlash({ titulo: document.getElementById('fl_titulo').value.trim(), inicia: fechaFlash(inicia, o.inicia),
      termina: fechaFlash(termina, o.termina), productos: flashBorrador });
    closeModal(); showToast(`Oferta flash guardada con ${flashBorrador.length} producto${flashBorrador.length === 1 ? '' : 's'}.`); renderTienda();
  } catch (e) { showError(e); btn.disabled = false; }
}
async function terminarFlashUI() {
  if (!confirm('¿Terminar la oferta flash ahora? Todos sus productos vuelven a su precio anterior.')) return;
  try { await terminarOfertaFlash(); showToast('Oferta terminada.'); renderTienda(); } catch (e) { showError(e); }
}

/* Descuentos vigentes */
function htmlDescuentos() {
  const lista = PROMOS.descuentos.map(d => ({ d, p: DB.products.find(x => x.id === d.productoId) })).filter(x => x.p && descuentoVigente(x.p.id));
  return `<div class="panel">
    <h3>Descuentos vigentes</h3>
    <p class="muted-sm">El precio habitual no cambia; la tienda, el carrito, WhatsApp y las ventas usan el precio con descuento mientras esté vigente.</p>
    <div class="field"><label>Poner un descuento</label>
      <input placeholder="Buscar producto por código o nombre" oninput="buscarDto(this.value)" autocomplete="off" ${adminOnly()}>
      <div id="dto_resultados" class="busca-res"></div></div>
    <div class="promo-list">${lista.length ? lista.map(({ d, p }) => `
      <div class="promo-item"><div class="promo-meta"><strong>${esc(p.nombre)}</strong>
        <small>${esc(p.codigo)} · <b>${d.porcentaje}% OFF</b> (${ORIGEN_DTO[d.origen]}) · ${fmt(p.precio)} → ${fmt(precioConDescuento(p.precio, d.porcentaje))}${d.vence ? ' · hasta ' + fmtDate(d.vence) : ''}</small></div>
        <div class="promo-acc">${d.origen === 'manual'
          ? `<button class="btn btn-sm" ${adminOnly()} onclick="openDescuentoModal('${p.id}')">Cambiar</button>
             <button class="btn btn-sm btn-danger" ${adminOnly()} onclick="quitarDescuentoUI('${p.id}')">Quitar</button>`
          : '<small>Se administra en Ofertas flash</small>'}</div></div>`).join('') : '<p class="muted-sm">No hay descuentos vigentes.</p>'}</div>
  </div>`;
}
function buscarDto(q) {
  const t = q.trim().toLowerCase(), el = document.getElementById('dto_resultados');
  if (!t) { el.innerHTML = ''; return; }
  el.innerHTML = DB.products.filter(p => (p.codigo + ' ' + p.nombre).toLowerCase().includes(t)).slice(0, 8)
    .map(p => `<button type="button" class="busca-item" onclick="openDescuentoModal('${p.id}')">${esc(p.codigo)} · ${esc(p.nombre)} <span>${fmt(p.precio)}</span></button>`).join('')
    || '<small>Sin resultados.</small>';
}
