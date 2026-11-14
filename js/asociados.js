/* ==========================================================================
   ELDOSTORE CRM — Vendedores asociados V1 (asociados.js) — migración 006

   Todo se administra desde este panel, solo por el administrador (Diego):
   - Vendedores: nombre comercial, logo, descripción, WhatsApp, localidad,
     comisión (10 % inicial) y activo / inactivo.
   - Productos asociados: de qué vendedor son, fotos, precio, descripción,
     stock y aprobación (pendiente → aprobado → pausado / rechazado).
   - Ventas asociadas: cada venta guarda total, % y comisión de ELDOSTORE y lo
     que corresponde al vendedor. Se anulan con motivo; nunca se borran.

   Está separado de la tienda propia: no lee ni escribe products, ventas
   ni promociones. De la caja solo AGREGA (lo hace la base) el ingreso de cada
   comisión cobrada, y su contramovimiento si se deshace. Si la migración 006 no está instalada, MKT.disponible queda
   en false y el panel funciona exactamente como antes (no se ve el menú).
   ========================================================================== */

const MKT = { disponible: false, esAdmin: false, vendedores: [], productos: [], ventas: [] };
const ESTADOS_MKT = { pendiente: 'Pendiente de aprobación', aprobado: 'Publicado', pausado: 'Pausado', rechazado: 'Rechazado' };
const BADGE_MKT = { pendiente: 'badge-pend', aprobado: 'badge-ok', pausado: 'badge-info', rechazado: 'badge-warn' };
const MKT_MAX_FOTOS = 10;

/* ------------------------------- Datos ---------------------------------- */
async function cargarAsociados() {
  try {
    const d = await rpcCuentas('mkt_panel', {});
    MKT.disponible = true;
    MKT.esAdmin = !!d.esAdmin;
    MKT.vendedores = d.vendedores || [];
    MKT.productos = (d.productos || []).map(p => Object.assign(p, { precio: Number(p.precio), stock: Number(p.stock) }));
    MKT.ventas = (d.ventas || []).map(v => Object.assign(v, {
      total: Number(v.total), comision: Number(v.comision), monto_vendedor: Number(v.monto_vendedor),
      precio_unitario: Number(v.precio_unitario), comision_pct: Number(v.comision_pct) }));
  } catch (e) {
    MKT.disponible = false;
    if (!funcionInexistente(e)) console.warn('No se pudieron leer las tiendas asociadas:', e);
  }
  return MKT;
}
async function rpcMkt(nombre, args) {
  const r = await rpcCuentas(nombre, args);
  await cargarAsociados();
  return r;
}
const vendedorMkt = id => MKT.vendedores.find(v => v.id === id);
const productoMkt = id => MKT.productos.find(p => p.id === id);
const mktAdmin = () => MKT.esAdmin ? '' : 'disabled';
/* Comisión: igual que la base (total × % / 100, al peso). */
const comisionMkt = (total, pct) => Math.round(Number(total) * Number(pct) / 100);
const fmtPct = n => Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 }) + ' %';
/* WhatsApp: 5493751112233 → 3751 112233 */
function waVisible(n) {
  const s = String(n || ''); const l = s.startsWith('549') && s.length === 13 ? s.slice(3) : s;
  return l.length === 10 ? l.slice(0, 4) + ' ' + l.slice(4) : s;
}
/* Lo que se escribe a mano («3751 11-2233») → formato internacional (5493751112233). */
function waInternacional(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = '549' + d;                         // número argentino sin código de país
  if (d.length === 12 && d.startsWith('54') && d[2] !== '9') d = '549' + d.slice(2);
  return d;
}
function enlaceTiendaPublica(v) { return 'index.html#tiendas/' + encodeURIComponent(v.slug); }

/* ------------------------------- Vista ---------------------------------- */
let mktTab = 'vendedores';
const mktFiltro = { vendedor: '', estado: '', q: '', ventasVendedor: '', ventasDesde: '', ventasHasta: '', verAnuladas: false };

function renderAsociados() {
  const el = document.getElementById('asociadosContenido'); if (!el) return;
  if (!MKT.disponible) {
    el.innerHTML = `<div class="panel"><h3>Falta instalar la migración 006</h3>
      <p class="muted-sm">Cuando esté instalada, desde acá vas a administrar los vendedores asociados, sus productos y las comisiones.</p></div>`;
    return;
  }
  const pend = MKT.productos.filter(p => p.estado === 'pendiente').length;
  const tabs = [['vendedores', `Vendedores (${MKT.vendedores.length})`], ['productos', `Productos${pend ? ` · ${pend} por aprobar` : ''}`]];
  if (MKT.esAdmin) tabs.push(['ventas', 'Ventas y comisiones']);   // información financiera: solo el administrador
  else if (mktTab === 'ventas') mktTab = 'vendedores';
  const aviso = MKT.esAdmin ? '' : '<div class="notice">Solo el administrador puede hacer cambios. Vos podés ver la información.</div>';
  el.innerHTML = `<div class="tabs" role="tablist">${tabs.map(([k, t]) =>
      `<button type="button" role="tab" class="tab${mktTab === k ? ' on' : ''}" aria-selected="${mktTab === k}" onclick="mktTab='${k}';renderAsociados()">${t}</button>`).join('')}</div>`
    + aviso + ({ vendedores: htmlVendedoresMkt, productos: htmlProductosMkt, ventas: htmlVentasMkt }[mktTab])();
}

/* ----------------------------- Vendedores -------------------------------- */
function htmlVendedoresMkt() {
  const lista = MKT.vendedores;
  return `<div class="panel">
    <div class="toolbar" style="margin-bottom:6px"><h3 style="margin:0">Vendedores asociados</h3><div class="spacer"></div>
      <button class="btn btn-primary btn-sm" ${mktAdmin()} onclick="abrirVendedorMkt()">+ Nuevo vendedor</button></div>
    <p class="muted-sm">Cada vendedor tiene su propia tienda en la sección pública «Tiendas asociadas». Los pedidos llegan a SU WhatsApp; el pago y la entrega los coordina él. Un vendedor nuevo queda inactivo hasta que lo actives.</p>
    <div class="promo-list">${lista.length ? lista.map(v => {
      const prods = MKT.productos.filter(p => p.vendedor_id === v.id);
      const pub = prods.filter(p => p.estado === 'aprobado').length, pend = prods.filter(p => p.estado === 'pendiente').length;
      return `<div class="promo-item${v.activo ? '' : ' off'}">
        ${v.logo_url ? `<img src="${esc(v.logo_url)}" alt="" class="promo-thumb" loading="lazy">` : '<span class="promo-thumb vacio">Sin logo</span>'}
        <div class="promo-meta"><strong>${esc(v.nombre)} ${v.activo ? '<span class="badge badge-ok">Activo</span>' : '<span class="badge badge-pend">Inactivo</span>'}</strong>
          <small>WhatsApp ${esc(waVisible(v.whatsapp))}${v.localidad ? ' · ' + esc(v.localidad) : ''} · comisión ${fmtPct(v.comision_pct)}</small>
          <small>${pub} producto${pub === 1 ? '' : 's'} publicado${pub === 1 ? '' : 's'}${pend ? ` · ${pend} por aprobar` : ''} · ${prods.length} en total</small></div>
        <div class="promo-acc">
          <button class="btn btn-sm" ${mktAdmin()} onclick="abrirVendedorMkt('${v.id}')">Editar</button>
          <button class="btn btn-sm" ${mktAdmin()} onclick="activarVendedorMkt('${v.id}', ${!v.activo})">${v.activo ? 'Desactivar' : 'Activar'}</button>
          <button class="btn btn-sm" onclick="mktFiltro.vendedor='${v.id}';mktTab='productos';renderAsociados()">Ver productos</button>
          <a class="btn btn-sm" href="${enlaceTiendaPublica(v)}" target="_blank" rel="noopener">Ver su tienda</a>
        </div></div>`;
    }).join('') : '<p class="muted-sm">Todavía no hay vendedores. Tocá «+ Nuevo vendedor».</p>'}</div></div>`;
}

function abrirVendedorMkt(id) {
  const v = id ? vendedorMkt(id) : null;
  openModal(`
    <h3>${v ? 'Editar vendedor' : 'Nuevo vendedor asociado'}</h3>
    <div class="field"><label>Nombre comercial</label><input id="mv_nombre" maxlength="80" value="${v ? esc(v.nombre) : ''}"></div>
    <div class="two-col">
      <div class="field"><label>WhatsApp para pedidos</label><input id="mv_wa" inputmode="tel" placeholder="Ej.: 3751 112233" value="${v ? esc(waVisible(v.whatsapp)) : ''}">
        <small>Con código de área, sin 0 ni 15. Ahí le llegan los pedidos.</small></div>
      <div class="field"><label>Localidad</label><input id="mv_loc" maxlength="80" placeholder="Ej.: Eldorado" value="${v ? esc(v.localidad) : ''}"></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Comisión de ELDOSTORE (%)</label><input id="mv_pct" type="number" min="0" max="50" step="0.5" inputmode="decimal" value="${v ? Number(v.comision_pct) : 10}">
        <small>Se copia en cada venta al registrarla; cambiarla no altera las ventas anteriores.</small></div>
      <div class="field"><label>Estado</label><label class="check-row"><input type="checkbox" id="mv_activo" ${v && v.activo ? 'checked' : ''}> Activo (su tienda se ve en la web)</label></div>
    </div>
    <div class="field"><label>Descripción (se ve en su tienda)</label><textarea id="mv_desc" rows="3" maxlength="600">${v ? esc(v.descripcion) : ''}</textarea></div>
    <div class="field">
      <label>${v && v.logo_url ? 'Logo (elegí uno nuevo solo si querés reemplazarlo)' : 'Logo'}</label>
      ${v && v.logo_url ? `<img src="${esc(v.logo_url)}" alt="Logo actual" class="img-actual" loading="lazy">
        <label class="check-row"><input type="checkbox" id="mv_sinlogo"> Quitar el logo</label>` : ''}
      <input type="file" id="mv_logo" accept="image/*">
      <small>Se optimiza solo antes de subir (máx. 400 px).</small>
      <div id="mv_logo_prev" class="img-prev" hidden></div>
    </div>
    <div class="field"><label>Notas internas (no se publican)</label><textarea id="mv_notas" rows="2" maxlength="1000">${v ? esc(v.notas) : ''}</textarea></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mvBtn" onclick="guardarVendedorMkt('${v ? v.id : ''}')">Guardar</button>
    </div>`);
  conectarVistaPrevia('mv_logo', 'logo', 'mv_logo_prev');
}

async function guardarVendedorMkt(id) {
  const v = id ? vendedorMkt(id) : null;
  const nombre = document.getElementById('mv_nombre').value.trim();
  const wa = waInternacional(document.getElementById('mv_wa').value);
  const pct = Number(document.getElementById('mv_pct').value);
  if (nombre.length < 2) { showToast('Escribí el nombre comercial.'); return; }
  if (!/^\d{10,15}$/.test(wa)) { showToast('Revisá el WhatsApp: código de área y número, por ejemplo 3751 112233.'); return; }
  if (!(pct >= 0 && pct <= 50)) { showToast('La comisión tiene que estar entre 0 y 50 %.'); return; }
  const btn = document.getElementById('mvBtn'); btn.disabled = true; btn.textContent = 'Preparando logo...';
  let logo = null;
  try { logo = await imagenElegida('mv_logo', 'logo'); }
  catch (e) { showToast(e.message); btn.disabled = false; btn.textContent = 'Guardar'; return; }
  btn.textContent = 'Guardando...';
  try {
    const quitar = document.getElementById('mv_sinlogo');
    let logoUrl = v ? v.logo_url : '';
    if (quitar && quitar.checked) logoUrl = '';
    if (logo) logoUrl = await subirImagenOptimizada(logo, 'logo');
    await rpcMkt('mkt_guardar_vendedor', { p_id: id || null, p_datos: {
      nombre, whatsapp: wa, comision_pct: pct, localidad: document.getElementById('mv_loc').value.trim(),
      descripcion: document.getElementById('mv_desc').value.trim(), notas: document.getElementById('mv_notas').value.trim(),
      logo_url: logoUrl, activo: document.getElementById('mv_activo').checked } });
    closeModal(); renderAsociados(); showToast('Vendedor guardado.');
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

async function activarVendedorMkt(id, activo) {
  const v = vendedorMkt(id); if (!v) return;
  if (!activo && !confirm(`¿Desactivar a ${v.nombre}? Su tienda y sus productos dejan de verse en la web (no se borra nada).`)) return;
  try { await rpcMkt('mkt_activar_vendedor', { p_id: id, p_activo: activo }); renderAsociados(); showToast(activo ? 'Vendedor activado: su tienda ya se ve.' : 'Vendedor desactivado.'); }
  catch (e) { showError(e); }
}

/* ------------------------------ Productos -------------------------------- */
function productosFiltradosMkt() {
  const t = mktFiltro.q.trim().toLowerCase();
  return MKT.productos.filter(p => (!mktFiltro.vendedor || p.vendedor_id === mktFiltro.vendedor)
    && (!mktFiltro.estado || p.estado === mktFiltro.estado)
    && (!t || (p.codigo + ' ' + p.nombre + ' ' + p.categoria).toLowerCase().includes(t)));
}
function opcionesVendedoresMkt(sel, vacia) {
  return (vacia ? `<option value="">${vacia}</option>` : '') +
    MKT.vendedores.map(v => `<option value="${v.id}" ${v.id === sel ? 'selected' : ''}>${esc(v.nombre)}${v.activo ? '' : ' (inactivo)'}</option>`).join('');
}
function htmlProductosMkt() {
  const lista = productosFiltradosMkt();
  return `<div class="panel">
    <div class="toolbar">
      <select onchange="mktFiltro.vendedor=this.value;renderAsociados()" aria-label="Vendedor">${opcionesVendedoresMkt(mktFiltro.vendedor, 'Todos los vendedores')}</select>
      <select onchange="mktFiltro.estado=this.value;renderAsociados()" aria-label="Estado"><option value="">Todos los estados</option>
        ${Object.entries(ESTADOS_MKT).map(([k, t]) => `<option value="${k}" ${mktFiltro.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input type="text" placeholder="Buscar por código o nombre..." value="${esc(mktFiltro.q)}" oninput="mktFiltro.q=this.value;dibujarListaProductosMkt()">
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" ${mktAdmin()} ${MKT.vendedores.length ? '' : 'disabled title="Primero creá un vendedor"'} onclick="abrirProductoMkt()">+ Nuevo producto asociado</button>
    </div>
    <p class="muted-sm">Un producto nuevo queda <b>pendiente</b>: se publica recién cuando lo aprobás y su vendedor está activo. Nunca aparece en «Todos los productos» de ELDOSTORE.</p>
    <div class="promo-list" id="mktListaProd">${htmlListaProductosMkt(lista)}</div></div>`;
}
function dibujarListaProductosMkt() { const el = document.getElementById('mktListaProd'); if (el) el.innerHTML = htmlListaProductosMkt(productosFiltradosMkt()); }
function htmlListaProductosMkt(lista) {
  if (!lista.length) return '<p class="muted-sm">No hay productos con este filtro.</p>';
  return lista.map(p => {
    const v = vendedorMkt(p.vendedor_id);
    const acc = {
      pendiente: [['aprobado', 'Aprobar y publicar', 'btn-primary'], ['rechazado', 'Rechazar', '']],
      aprobado: [['pausado', 'Pausar', '']],
      pausado: [['aprobado', 'Volver a publicar', 'btn-primary']],
      rechazado: [['aprobado', 'Aprobar y publicar', 'btn-primary']]
    }[p.estado] || [];
    return `<div class="promo-item${p.estado === 'aprobado' ? '' : ' off'}">
      ${p.fotos && p.fotos[0] ? `<img src="${esc(p.fotos[0])}" alt="" class="promo-thumb" loading="lazy">` : '<span class="promo-thumb vacio">Sin foto</span>'}
      <div class="promo-meta"><strong>${esc(p.nombre)} <span class="badge ${BADGE_MKT[p.estado]}">${ESTADOS_MKT[p.estado]}</span></strong>
        <small>${esc(p.codigo)} · <b>${v ? esc(v.nombre) : '—'}</b>${v && !v.activo ? ' (vendedor inactivo: no se ve)' : ''}</small>
        <small>${fmt(p.precio)} · stock ${p.stock}${p.stock === 0 ? ' (se ve «Sin stock»)' : ''}${p.categoria ? ' · ' + esc(p.categoria) : ''} · ${(p.fotos || []).length} foto${(p.fotos || []).length === 1 ? '' : 's'}</small></div>
      <div class="promo-acc">
        ${acc.map(([e, t, c]) => `<button class="btn btn-sm ${c}" ${mktAdmin()} onclick="estadoProductoMkt('${p.id}','${e}')">${t}</button>`).join('')}
        <button class="btn btn-sm" ${mktAdmin()} onclick="abrirProductoMkt('${p.id}')">Editar</button>
        <button class="btn btn-sm btn-danger" ${mktAdmin()} onclick="eliminarProductoMkt('${p.id}')">Eliminar</button>
      </div></div>`;
  }).join('');
}

let mktFotos = [];   // borrador de fotos del producto: [{ url }] ya subidas o [{ archivo, img }] nuevas
function abrirProductoMkt(id) {
  const p = id ? productoMkt(id) : null;
  mktFotos = p ? (p.fotos || []).map(url => ({ url })) : [];
  const cats = Array.from(new Set(MKT.productos.map(x => x.categoria).filter(Boolean).concat(listaCategorias()))).sort();
  openModal(`
    <h3>${p ? 'Editar producto asociado' : 'Nuevo producto asociado'}</h3>
    <div class="field"><label>Vendedor</label><select id="mp_vend">${opcionesVendedoresMkt(p ? p.vendedor_id : (mktFiltro.vendedor || ''), p ? '' : 'Elegí el vendedor')}</select></div>
    <div class="field"><label>Nombre del producto</label><input id="mp_nombre" maxlength="140" value="${p ? esc(p.nombre) : ''}"></div>
    <div class="two-col">
      <div class="field"><label>Código</label><input id="mp_codigo" maxlength="40" placeholder="Automático (TA0001…)" value="${p ? esc(p.codigo) : ''}"></div>
      <div class="field"><label>Categoría</label><input id="mp_cat" maxlength="60" list="mp_cats" value="${p ? esc(p.categoria) : ''}"><datalist id="mp_cats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Precio de venta</label><input id="mp_precio" type="number" min="1" step="1" inputmode="numeric" value="${p ? p.precio : ''}"></div>
      <div class="field"><label>Stock</label><input id="mp_stock" type="number" min="0" step="1" inputmode="numeric" value="${p ? p.stock : 1}"></div>
    </div>
    <div class="field"><label>Descripción</label><textarea id="mp_desc" rows="4" maxlength="2000">${p ? esc(p.descripcion) : ''}</textarea></div>
    <div class="field"><label>Fotos (hasta ${MKT_MAX_FOTOS}; la primera es la principal)</label>
      <div id="mp_fotos" class="mkt-fotos"></div>
      <label class="btn btn-sm file-btn">+ Agregar fotos<input type="file" accept="image/*" multiple onchange="agregarFotosMkt(this)"></label>
      <small>Se optimizan solas antes de subir (máx. 1200 px).</small></div>
    ${p ? '' : '<p class="muted-sm">Queda <b>pendiente de aprobación</b>: no se publica hasta que lo apruebes.</p>'}
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="mpBtn" onclick="guardarProductoMkt('${p ? p.id : ''}')">Guardar</button>
    </div>`, true);
  dibujarFotosMkt();
}
function dibujarFotosMkt() {
  const el = document.getElementById('mp_fotos'); if (!el) return;
  el.innerHTML = mktFotos.map((f, i) => `<div class="mkt-foto">
      ${f.url ? `<img src="${esc(f.url)}" alt="Foto ${i + 1}">` : f.vista ? `<img src="${f.vista}" alt="Foto nueva ${i + 1}">` : '<span class="promo-thumb vacio">Preparando…</span>'}
      ${f.error ? `<small class="mkt-foto-err">${esc(f.error)}</small>` : ''}
      <div class="mkt-foto-acc">
        <button type="button" class="btn btn-sm" ${i === 0 ? 'disabled' : ''} onclick="moverFotoMkt(${i},-1)" aria-label="Mover antes">←</button>
        <button type="button" class="btn btn-sm btn-danger" onclick="quitarFotoMkt(${i})" aria-label="Quitar foto">✕</button>
      </div></div>`).join('') || '<p class="muted-sm">Sin fotos todavía.</p>';
}
function agregarFotosMkt(input) {
  const archivos = Array.from(input.files || []); input.value = '';
  const lugar = MKT_MAX_FOTOS - mktFotos.length;
  if (archivos.length > lugar) showToast(`Se agregan ${Math.max(0, lugar)}: el máximo es ${MKT_MAX_FOTOS} fotos.`);
  for (const archivo of archivos.slice(0, Math.max(0, lugar))) {
    const f = { archivo };
    f.img = optimizarImagen(archivo, 'asociado').then(r => { f.vista = URL.createObjectURL(r.blob); dibujarFotosMkt(); return r; })
      .catch(e => { f.error = e.message; dibujarFotosMkt(); throw e; });
    f.img.catch(() => {});
    mktFotos.push(f);
  }
  dibujarFotosMkt();
}
function moverFotoMkt(i, d) { const j = i + d; if (j < 0 || j >= mktFotos.length) return; [mktFotos[i], mktFotos[j]] = [mktFotos[j], mktFotos[i]]; dibujarFotosMkt(); }
function quitarFotoMkt(i) { mktFotos.splice(i, 1); dibujarFotosMkt(); }

async function guardarProductoMkt(id) {
  const datos = {
    vendedor_id: document.getElementById('mp_vend').value,
    nombre: document.getElementById('mp_nombre').value.trim(),
    codigo: document.getElementById('mp_codigo').value.trim(),
    categoria: document.getElementById('mp_cat').value.trim(),
    precio: Number(document.getElementById('mp_precio').value),
    stock: Number(document.getElementById('mp_stock').value),
    descripcion: document.getElementById('mp_desc').value.trim()
  };
  if (!datos.vendedor_id) { showToast('Elegí a qué vendedor pertenece el producto.'); return; }
  if (datos.nombre.length < 2) { showToast('Escribí el nombre del producto.'); return; }
  if (!(datos.precio > 0)) { showToast('Indicá un precio mayor que 0.'); return; }
  if (!(datos.stock >= 0) || datos.stock !== Math.trunc(datos.stock)) { showToast('El stock tiene que ser un número entero, 0 o más.'); return; }
  if (datos.codigo && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(datos.codigo)) { showToast('El código solo puede tener letras, números, punto, guion y guion bajo.'); return; }
  if (mktFotos.some(f => f.error)) { showToast('Quitá las fotos que no se pudieron preparar (marcadas en rojo).'); return; }
  const btn = document.getElementById('mpBtn'); btn.disabled = true; btn.textContent = 'Subiendo fotos...';
  try {
    const urls = [];
    for (const f of mktFotos) {
      if (f.url) { urls.push(f.url); continue; }
      const r = await f.img;
      f.url = await subirImagenOptimizada(r, 'asociado');   // si se reintenta, no se vuelve a subir
      urls.push(f.url);
    }
    datos.fotos = urls;
    btn.textContent = 'Guardando...';
    const r = await rpcMkt('mkt_guardar_producto', { p_id: id || null, p_datos: datos });
    closeModal(); renderAsociados();
    showToast(id ? 'Producto guardado.' : `Producto ${r.codigo} creado: queda pendiente de aprobación.`);
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Guardar'; }
}

async function estadoProductoMkt(id, estado) {
  const p = productoMkt(id); if (!p) return;
  const v = vendedorMkt(p.vendedor_id);
  if (estado === 'aprobado' && !(p.fotos || []).length && !confirm(`${p.nombre} no tiene fotos. ¿Publicarlo igual?`)) return;
  try {
    await rpcMkt('mkt_estado_producto', { p_id: id, p_estado: estado });
    renderAsociados();
    showToast(estado === 'aprobado' ? (v && v.activo ? 'Producto publicado.' : 'Producto aprobado. Se va a ver cuando actives al vendedor.') : 'Estado actualizado: ' + ESTADOS_MKT[estado] + '.');
  } catch (e) { showError(e); }
}
async function eliminarProductoMkt(id) {
  const p = productoMkt(id); if (!p) return;
  if (!confirm(`¿Eliminar ${p.nombre} (${p.codigo})? Si tiene ventas no se puede: en ese caso pausalo.`)) return;
  try { await rpcMkt('mkt_eliminar_producto', { p_id: id }); renderAsociados(); showToast('Producto eliminado.'); }
  catch (e) { showError(e); }
}

/* ------------------------- Ventas y comisiones --------------------------- */
/* Fecha de Argentina de una venta (igual que la base: America/Argentina/Buenos_Aires). */
const fechaAR = iso => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
function ventasFiltradasMkt(conAnuladas) {
  return MKT.ventas.filter(s => (conAnuladas || !s.anulada)
    && (!mktFiltro.ventasVendedor || s.vendedor_id === mktFiltro.ventasVendedor)
    && (!mktFiltro.ventasDesde || fechaAR(s.fecha) >= mktFiltro.ventasDesde)
    && (!mktFiltro.ventasHasta || fechaAR(s.fecha) <= mktFiltro.ventasHasta));
}
/* Indicadores del Marketplace: los calcula la base (mkt_indicadores, solo administrador). */
async function indicadoresMkt(desde, hasta, vendedor) {
  return await rpcCuentas('mkt_indicadores', { p_desde: desde || null, p_hasta: hasta || null, p_vendedor: vendedor || null });
}
function htmlIndicadoresMkt(d) {
  return `<div class="grid grid-4" style="margin-bottom:12px">
      ${kpiBox('Comisiones generadas', fmt(d.generadas), `${d.ventas} venta${d.ventas === 1 ? '' : 's'} asociada${d.ventas === 1 ? '' : 's'}`, 'gold')}
      ${kpiBox('Comisiones cobradas', fmt(d.cobradas), 'ya ingresaron a la caja de ELDOSTORE', 'green')}
      ${kpiBox('Comisiones pendientes', fmt(d.pendientes), 'ELDOSTORE todavía tiene que cobrarlas', d.pendientes ? 'red' : '')}
      ${kpiBox('Vendido por los asociados', fmt(d.ventas_vendedores), `para los vendedores: ${fmt(d.para_vendedores)} · no es ingreso de ELDOSTORE`, '')}
    </div>
    <p class="muted-sm">Generadas = cobradas + pendientes, por fecha de la venta (sin anuladas). Control de caja: en el período entraron ${fmt(d.caja_neto)} por comisiones (${d.caja_movimientos} movimiento${d.caja_movimientos === 1 ? '' : 's'}, por fecha de cobro).</p>`;
}
async function dibujarIndicadoresVentasMkt() {
  const el = document.getElementById('mktIndicadores'); if (!el) return;
  try { el.innerHTML = htmlIndicadoresMkt(await indicadoresMkt(mktFiltro.ventasDesde, mktFiltro.ventasHasta, mktFiltro.ventasVendedor)); }
  catch (e) { el.innerHTML = `<div class="notice">${esc(e.message || 'No se pudieron calcular los indicadores.')}</div>`; }
}
function htmlVentasMkt() {
  const validas = ventasFiltradasMkt(false);
  const porVendedor = MKT.vendedores.map(v => {
    const vs = validas.filter(s => s.vendedor_id === v.id);
    return { v, n: vs.length, total: vs.reduce((a, s) => a + s.total, 0), com: vs.reduce((a, s) => a + s.comision, 0),
             vend: vs.reduce((a, s) => a + s.monto_vendedor, 0), cob: vs.filter(s => s.comision_cobrada).reduce((a, s) => a + s.comision, 0),
             pend: vs.filter(s => !s.comision_cobrada).reduce((a, s) => a + s.comision, 0) };
  }).filter(x => x.n);
  const lista = ventasFiltradasMkt(mktFiltro.verAnuladas);
  setTimeout(dibujarIndicadoresVentasMkt, 0);
  return `<div class="toolbar">
      <select onchange="mktFiltro.ventasVendedor=this.value;renderAsociados()" aria-label="Vendedor">${opcionesVendedoresMkt(mktFiltro.ventasVendedor, 'Todos los vendedores')}</select>
      <div class="field" style="margin:0"><label>Desde</label><input type="date" value="${mktFiltro.ventasDesde}" onchange="mktFiltro.ventasDesde=this.value;renderAsociados()"></div>
      <div class="field" style="margin:0"><label>Hasta</label><input type="date" value="${mktFiltro.ventasHasta}" onchange="mktFiltro.ventasHasta=this.value;renderAsociados()"></div>
      <label class="check-row" style="margin:0"><input type="checkbox" ${mktFiltro.verAnuladas ? 'checked' : ''} onchange="mktFiltro.verAnuladas=this.checked;renderAsociados()"> Mostrar anuladas</label>
      <div class="spacer"></div>
      <button class="btn btn-primary btn-sm" ${mktAdmin()} ${MKT.productos.length ? '' : 'disabled'} onclick="abrirVentaMkt()">+ Registrar venta asociada</button>
    </div>
    <div id="mktIndicadores"><p class="muted-sm">Calculando indicadores…</p></div>
    ${porVendedor.length ? `<div class="panel"><h3>Por vendedor</h3><div class="table-wrap"><table>
      <thead><tr><th>Vendedor</th><th>Ventas</th><th>Total vendido</th><th>Comisión generada</th><th>Cobrada</th><th>Pendiente</th><th>Para el vendedor</th></tr></thead>
      <tbody>${porVendedor.map(x => `<tr><td>${esc(x.v.nombre)}</td><td>${x.n}</td><td>${fmt(x.total)}</td><td>${fmt(x.com)}</td><td>${fmt(x.cob)}</td><td>${x.pend ? `<b style="color:var(--red)">${fmt(x.pend)}</b>` : fmt(0)}</td><td>${fmt(x.vend)}</td></tr>`).join('')}</tbody>
    </table></div></div>` : ''}
    <div class="table-wrap"><table>
      <thead><tr><th>Fecha</th><th>Vendedor</th><th>Producto</th><th>Cant.</th><th>Total</th><th>Comisión</th><th>Al vendedor</th><th>Comisión</th><th></th></tr></thead>
      <tbody>${lista.length ? lista.map(s => `<tr${s.anulada ? ' style="opacity:.55"' : ''}>
        <td>${fmtDate(s.fecha)}</td><td>${esc(s.vendedor_nombre)}</td>
        <td>${esc(s.producto_nombre)}<br><small style="color:var(--muted)">${esc(s.producto_codigo)} · ${fmt(s.precio_unitario)} c/u${s.cliente ? ' · ' + esc(s.cliente) : ''}</small></td>
        <td>${s.cantidad}</td><td>${fmt(s.total)}</td><td>${fmt(s.comision)}<br><small style="color:var(--muted)">${fmtPct(s.comision_pct)}</small></td><td>${fmt(s.monto_vendedor)}</td>
        <td>${s.anulada ? `<span class="badge badge-anulada" title="${esc(s.motivo_anulacion)}">Anulada</span>` : s.comision_cobrada
          ? `<span class="badge badge-ok">Cobrada</span><br><small style="color:var(--muted)">${s.comision_cobrada_en ? fmtDate(s.comision_cobrada_en) : ''}${s.comision_mov_id ? ' · en caja' : ''}</small>`
          : '<span class="badge badge-pend">Por cobrar</span>'}</td>
        <td style="white-space:nowrap">${s.anulada ? '' : `<button class="btn btn-sm" ${mktAdmin()} onclick="comisionCobradaMkt('${s.id}', ${!s.comision_cobrada})">${s.comision_cobrada ? 'Marcar por cobrar' : 'Marcar cobrada'}</button>
          <button class="btn btn-sm btn-danger" ${mktAdmin()} onclick="anularVentaMkt('${s.id}')">Anular</button>`}</td></tr>`).join('')
        : '<tr><td colspan="9" class="empty-state">No hay ventas asociadas con este filtro.</td></tr>'}</tbody>
    </table></div>
    <p class="muted-sm" style="margin-top:10px">El cliente le paga al vendedor; ELDOSTORE le cobra la comisión al vendedor. Al marcarla <b>cobrada</b>, solo la comisión entra como ingreso en la caja de ELDOSTORE (origen «comision_asociado»). El total de la venta no entra a la caja ni a las ventas propias.</p>`;
}

function abrirVentaMkt() {
  const prods = MKT.productos.filter(p => p.estado === 'aprobado' || p.estado === 'pausado');
  openModal(`
    <h3>Registrar venta asociada</h3>
    <div class="field"><label>Producto vendido</label>
      <select id="ms_prod" onchange="vistaVentaMkt(true)"><option value="">Elegí el producto</option>
        ${MKT.vendedores.map(v => { const ps = prods.filter(p => p.vendedor_id === v.id); return ps.length ? `<optgroup label="${esc(v.nombre)}">${ps.map(p =>
          `<option value="${p.id}">${esc(p.codigo)} · ${esc(p.nombre)} · ${fmt(p.precio)} · stock ${p.stock}</option>`).join('')}</optgroup>` : ''; }).join('')}
      </select></div>
    <div class="two-col">
      <div class="field"><label>Cantidad</label><input id="ms_cant" type="number" min="1" step="1" value="1" inputmode="numeric" oninput="vistaVentaMkt()"></div>
      <div class="field"><label>Precio unitario</label><input id="ms_precio" type="number" min="1" step="1" inputmode="numeric" oninput="vistaVentaMkt()"><small>El del producto; cambialo solo si se vendió a otro precio.</small></div>
    </div>
    <div class="two-col">
      <div class="field"><label>Cliente (opcional)</label><input id="ms_cliente" maxlength="120"></div>
      <div class="field"><label>Fecha</label><input id="ms_fecha" type="datetime-local"></div>
    </div>
    <div class="field"><label>Notas (opcional)</label><input id="ms_notas" maxlength="500"></div>
    <div id="ms_vista" class="notice" hidden></div>
    <div class="modal-actions">
      <button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-primary btn-sm" id="msBtn" onclick="guardarVentaMkt()">Registrar</button>
    </div>`);
  const ahora = new Date(); ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  document.getElementById('ms_fecha').value = ahora.toISOString().slice(0, 16);
}
function vistaVentaMkt(cambioProducto) {
  const p = productoMkt(document.getElementById('ms_prod').value), el = document.getElementById('ms_vista');
  if (!p) { el.hidden = true; return; }
  if (cambioProducto) document.getElementById('ms_precio').value = p.precio;
  const v = vendedorMkt(p.vendedor_id);
  const cant = Number(document.getElementById('ms_cant').value), precio = Number(document.getElementById('ms_precio').value);
  if (!(cant >= 1 && precio > 0)) { el.hidden = true; return; }
  const total = Math.round(cant * precio * 100) / 100, com = comisionMkt(total, v.comision_pct);
  el.hidden = false;
  el.innerHTML = `Total <b>${fmt(total)}</b> · comisión ELDOSTORE (${fmtPct(v.comision_pct)}) <b>${fmt(com)}</b> · para ${esc(v.nombre)} <b>${fmt(total - com)}</b>`
    + (cant > p.stock ? `<br><b style="color:var(--red)">Stock insuficiente (hay ${p.stock}). Actualizá el stock del producto primero.</b>` : '');
}
async function guardarVentaMkt() {
  const id = document.getElementById('ms_prod').value, p = productoMkt(id);
  const cant = Number(document.getElementById('ms_cant').value), precio = Number(document.getElementById('ms_precio').value);
  const fecha = document.getElementById('ms_fecha').value;
  if (!p) { showToast('Elegí el producto vendido.'); return; }
  if (!(cant >= 1) || cant !== Math.trunc(cant)) { showToast('La cantidad tiene que ser un número entero, 1 o más.'); return; }
  if (!(precio > 0)) { showToast('Indicá el precio.'); return; }
  const btn = document.getElementById('msBtn'); btn.disabled = true; btn.textContent = 'Registrando...';
  try {
    const r = await rpcMkt('mkt_registrar_venta', { p_datos: { producto_id: id, cantidad: cant,
      precio_unitario: precio === p.precio ? null : precio, fecha: fecha ? new Date(fecha).toISOString() : null,
      cliente: document.getElementById('ms_cliente').value.trim(), notas: document.getElementById('ms_notas').value.trim() } });
    closeModal(); mktTab = 'ventas'; renderAsociados();
    showToast(`Venta registrada: ${fmt(r.total)} · comisión ${fmt(r.comision)}.`);
  } catch (e) { showError(e); btn.disabled = false; btn.textContent = 'Registrar'; }
}
/* Caja: la comisión cobrada entra como ingreso en la caja de ELDOSTORE (cash_movements, origen
   «comision_asociado», con la referencia de la venta). Lo registra la base; acá se elige quién
   recibió el dinero. Volver a «por cobrar» o anular agrega el contramovimiento (no borra nada). */
function quienSelectMkt(id, etiqueta) {
  return `<div class="field"><label>${etiqueta}</label><select id="${id}">${holderOptions(CUENTAS.miHolderId)}</select></div>`;
}
function anularVentaMkt(id) {
  const s = MKT.ventas.find(x => x.id === id); if (!s) return;
  openModal(`<h3>Anular venta asociada</h3>
    <p class="muted-sm">${s.cantidad} × ${esc(s.producto_nombre)} · ${esc(s.vendedor_nombre)} · ${fmt(s.total)}. La venta queda en el historial como anulada y el stock vuelve al producto.</p>
    ${s.comision_cobrada && s.comision > 0 ? `<div class="notice">La comisión de ${fmt(s.comision)} ya estaba cobrada: se registra un <b>egreso</b> en la caja de ELDOSTORE que la compensa (el ingreso original no se borra).</div>
      ${quienSelectMkt('ma_quien', '¿Quién devuelve el dinero?')}` : ''}
    <div class="field"><label>Motivo</label><input id="ma_motivo" maxlength="200"></div>
    <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
      <button class="btn btn-danger btn-sm" id="maBtn" onclick="confirmarAnularMkt('${id}')">Anular venta</button></div>`);
}
async function confirmarAnularMkt(id) {
  const motivo = document.getElementById('ma_motivo').value.trim();
  if (motivo.length < 3) { showToast('Indicá el motivo de la anulación.'); return; }
  const q = document.getElementById('ma_quien');
  const btn = document.getElementById('maBtn'); btn.disabled = true;
  try {
    const r = await rpcMkt('mkt_anular_venta', { p_id: id, p_motivo: motivo, p_holder_id: q ? q.value : null });
    await refreshCash();
    closeModal(); renderAsociados(); showToast(r && r.comisionDevuelta ? 'Venta anulada. La comisión salió de la caja.' : 'Venta anulada.');
  } catch (e) { showError(e); btn.disabled = false; }
}
function comisionCobradaMkt(id, cobrada) {
  const s = MKT.ventas.find(x => x.id === id); if (!s) return;
  openModal(cobrada ? `<h3>Comisión cobrada</h3>
      <p class="muted-sm">${esc(s.vendedor_nombre)} · ${s.cantidad} × ${esc(s.producto_nombre)} (${esc(s.producto_codigo)}) · venta de ${fmt(s.total)}.</p>
      <div class="notice">${s.comision > 0 ? `Entra a la <b>caja de ELDOSTORE</b> un ingreso de <b>${fmt(s.comision)}</b> (solo la comisión del ${fmtPct(s.comision_pct)}; el resto es del vendedor).`
        : 'La comisión de esta venta es $0: se marca como cobrada sin movimiento de caja.'}</div>
      ${s.comision > 0 ? quienSelectMkt('mc_quien', '¿Quién recibió el dinero?') : ''}
      <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-primary btn-sm" id="mcBtn" onclick="confirmarComisionMkt('${id}', true)">Registrar cobro</button></div>`
    : `<h3>Volver a «por cobrar»</h3>
      <div class="notice">Se registra un <b>egreso de ${fmt(s.comision)}</b> en la caja de ELDOSTORE que compensa el cobro anterior (el ingreso no se borra).</div>
      ${s.comision > 0 ? quienSelectMkt('mc_quien', '¿Quién devuelve o corrige el dinero?') : ''}
      <div class="modal-actions"><button class="btn btn-sm" onclick="closeModal()">Cancelar</button>
        <button class="btn btn-danger btn-sm" id="mcBtn" onclick="confirmarComisionMkt('${id}', false)">Volver a por cobrar</button></div>`);
}
async function confirmarComisionMkt(id, cobrada) {
  const q = document.getElementById('mc_quien');
  const btn = document.getElementById('mcBtn'); btn.disabled = true;   // evita el doble clic
  try {
    const r = await rpcMkt('mkt_comision_cobrada', { p_id: id, p_cobrada: cobrada, p_holder_id: q ? q.value : null });
    await refreshCash();
    closeModal(); renderAsociados();
    showToast(cobrada ? (r && r.monto ? `Comisión cobrada: ingresaron ${fmt(r.monto)} a la caja de ELDOSTORE.` : 'Comisión marcada como cobrada.') : 'Comisión otra vez por cobrar (contramovimiento en caja).');
  } catch (e) { showError(e); btn.disabled = false; }
}

/* ---------------- Reportes: ingresos de ELDOSTORE + Marketplace ----------------
   Se llama al final de renderReportes() con lo que ESE reporte ya calculó para las
   ventas propias (no se recalcula ni se cambia nada de ese cálculo). Las comisiones
   salen de mkt_indicadores (solo administrador). Las ventas completas de los
   asociados nunca se suman como ingreso de ELDOSTORE. */
let repMktVendedor = '';
async function renderIndicadoresMkt({ desde, hasta, cuenta, propias, gastos }) {
  const el = document.getElementById('repMarketplace'); if (!el) return;
  if (!MKT.disponible || !MKT.esAdmin) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const eldo = cuentaEldostoreId();
  if (cuenta && cuenta !== eldo) {
    el.innerHTML = `<h3>Marketplace (tiendas asociadas)</h3><p class="muted-sm">Las comisiones del Marketplace son de la cuenta ELDOSTORE. Elegí «Todas» o ELDOSTORE para verlas junto a las ventas.</p>`;
    return;
  }
  el.innerHTML = '<h3>Ingresos de ELDOSTORE: ventas propias + Marketplace</h3><p class="muted-sm">Calculando…</p>';
  let d;
  try { d = await indicadoresMkt(desde, hasta, repMktVendedor); }
  catch (e) { el.innerHTML = `<h3>Marketplace</h3><div class="notice">${esc(e.message)}</div>`; return; }
  const ventasPropias = propias.todas.total, gananciaPropia = propias.todas.ganancia;
  const fila = (t, v, nota, fuerte) => `<tr${fuerte ? ' style="font-weight:700"' : ''}><td>${t}</td><td>${fmt(v)}</td><td style="color:var(--muted);font-size:.8rem">${nota}</td></tr>`;
  el.innerHTML = `<h3>Ingresos de ELDOSTORE: ventas propias + Marketplace</h3>
    <div class="toolbar" style="margin:6px 0 10px"><select onchange="repMktVendedor=this.value;renderReportes()" aria-label="Vendedor asociado">${opcionesVendedoresMkt(repMktVendedor, 'Todos los vendedores asociados')}</select></div>
    <div class="table-wrap"><table>
      <thead><tr><th>Concepto</th><th>Importe</th><th></th></tr></thead>
      <tbody>
        ${fila('Ingresos por ventas propias', ventasPropias, `${propias.todas.cantidad} ventas de la tienda (propias y por revendedor)${cuenta ? ' · cuenta ELDOSTORE' : ''}`)}
        ${fila('Ingresos por comisiones del Marketplace', d.generadas, `${d.ventas} ventas asociadas${repMktVendedor ? ' · ' + esc((vendedorMkt(repMktVendedor) || {}).nombre || '') : ''} · cobradas ${fmt(d.cobradas)} · pendientes ${fmt(d.pendientes)}`)}
        ${fila('Ingresos totales de ELDOSTORE', ventasPropias + d.generadas, 'ventas propias + comisiones (las ventas de los asociados no se suman)', true)}
      </tbody></table></div>
    <div class="grid grid-4" style="margin-top:14px">
      ${kpiBox('Ganancia por ventas propias', fmt(gananciaPropia), 'el mismo cálculo de siempre (ganancia bruta)', 'gold')}
      ${kpiBox('Comisiones generadas', fmt(d.generadas), 'Marketplace', 'gold')}
      ${kpiBox('Comisiones cobradas', fmt(d.cobradas), 'ingresadas a la caja', 'green')}
      ${kpiBox('Comisiones pendientes', fmt(d.pendientes), 'por cobrar a los vendedores', d.pendientes ? 'red' : '')}
    </div>
    <p class="muted-sm" style="margin-top:8px">Fechas: ventas propias según el reporte de arriba; comisiones por la fecha de la venta asociada (hora de Argentina). Vendido por los asociados en el período: ${fmt(d.ventas_vendedores)} (no es ingreso de ELDOSTORE). Gastos del período: ${fmt(gastos)}.</p>`;
}
