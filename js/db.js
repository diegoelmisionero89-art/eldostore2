/* ==========================================================================
   ELDOSTORE CRM — Capa de datos (db.js) — versión Supabase
   Actualización 002: ventas propias / por revendedor con comisión por línea,
   y anulación/corrección de ventas, compras y gastos (requiere la migración
   data/migracion-002-revendedores-y-correcciones.sql).

   Fuente de verdad: Supabase (Postgres online). Este archivo mantiene un
   objeto DB en memoria como CACHÉ LOCAL: se llena al iniciar sesión
   (refreshAll) y se actualiza después de cada operación exitosa contra
   Supabase, para que el resto de la interfaz (ui.js) pueda seguir leyendo
   DB.products, DB.clients, etc. de forma sincrónica, igual que antes.

   Las operaciones que ESCRIBEN datos ahora son todas async: hay que usar
   await al llamarlas (así están usadas en ui.js).

   Ventas, compras y conversión de pedido→venta se ejecutan como funciones
   de base de datos (RPC) definidas en data/schema-supabase.sql, en una
   sola transacción atómica — así se evita que una venta descuente stock
   dos veces, incluso si dos dispositivos actúan al mismo tiempo.
   ========================================================================== */

const DB = {
  products: [],
  clients: [],
  orders: [],
  sales: [],
  purchases: [],
  expenses: [],
  cashMovements: [],
  shipments: [],
  config: {
    shippingRates: [
      { min: 1, max: 5, costo: 1500 },
      { min: 6, max: 11, costo: 2000 },
      { min: 12, max: 18, costo: 3000 }
    ],
    freeShippingFrom: 50000,
    nextCodeNumber: 118,
    inventarioRealCargado: false
  }
};

/* Estado de la migración 002 en Supabase: se detecta al cargar los datos
   (si las filas traen la columna "anulada") o al llamar a una función nueva. */
const MIGRACION_002 = { detectada: false };

/* Traduce errores de las funciones de la migración 002 a un mensaje claro. */
function rpcErrorMessage(error) {
  const msg = error && error.message ? error.message : String(error);
  if (/could not find the function|function .* does not exist|PGRST202/i.test(msg)) {
    return 'Falta aplicar en Supabase la migración data/migracion-002-revendedores-y-correcciones.sql.';
  }
  return msg;
}

function uid() { return crypto.randomUUID(); } // no se usa para insertar (Supabase genera el id), queda por compatibilidad
function nowISO() { return new Date().toISOString(); }
function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }

function throwIfError(error, contexto) {
  if (error) {
    console.error(contexto, error);
    throw new Error(error.message || ('Error en ' + contexto));
  }
}

/* ---------------------------- MAPEO DE FILAS ----------------------------
   Supabase devuelve columnas en snake_case (stock_min, producto_id...).
   Se mapean a los mismos nombres camelCase que ya usaba ui.js, para no
   tener que reescribir toda la interfaz. */

function computeProductFields(p) {
  const costo = Number(p.costo) || 0;
  const precio = Number(p.precio) || 0;
  const stock = Number(p.stock) || 0;
  p.gananciaUnit = round2(precio - costo);
  p.margenPct = precio > 0 ? round2((p.gananciaUnit / precio) * 100) : 0;
  p.valorStock = round2(costo * stock);
  return p;
}

function rowToProduct(r) {
  const p = {
    id: r.id, codigo: r.codigo, nombre: r.nombre, categoria: r.categoria,
    costo: Number(r.costo), precio: Number(r.precio), stock: Number(r.stock),
    stockMin: Number(r.stock_min), foto: r.foto, activo: r.activo,
    revisar: r.revisar, creado: r.creado
  };
  return computeProductFields(p);
}
function rowToClient(r) {
  return { id: r.id, nombre: r.nombre, telefono: r.telefono, localidad: r.localidad, direccion: r.direccion, notas: r.notas, fechaAlta: r.fecha_alta };
}
function rowToOrder(r) {
  return {
    id: r.id, clienteId: r.cliente_id, items: r.items, total: Number(r.total),
    sena: Number(r.sena), saldo: Number(r.saldo), metodoPago: r.metodo_pago,
    envioORetiro: r.envio_o_retiro, direccion: r.direccion, notas: r.notas,
    fecha: r.fecha, estado: r.estado, ventaId: r.venta_id
  };
}
/* Campos de la migración 002 (modalidad, comisión, anulación). Si la
   migración todavía no se aplicó, las columnas no existen: se usan valores
   por defecto equivalentes a "venta propia, sin comisión, no anulada". */
function anulacionFields(r) {
  if (r.anulada !== undefined) MIGRACION_002.detectada = true;
  return { anulada: !!r.anulada, anuladaEl: r.anulada_el || null, motivoAnulacion: r.motivo_anulacion || '', corrigeA: r.corrige_a || null };
}
function rowToSale(r) {
  return {
    id: r.id, fecha: r.fecha, clienteId: r.cliente_id, items: r.items,
    total: Number(r.total), costoTotal: Number(r.costo_total), ganancia: Number(r.ganancia),
    metodoPago: r.metodo_pago, pedidoId: r.pedido_id,
    modalidad: r.modalidad || 'propia', comisionTotal: Number(r.comision_total) || 0,
    ...anulacionFields(r)
  };
}
function rowToPurchase(r) {
  return {
    id: r.id, fecha: r.fecha, proveedor: r.proveedor, productoId: r.producto_id,
    cantidad: Number(r.cantidad), costoUnit: Number(r.costo_unit), total: Number(r.total),
    metodoPago: r.metodo_pago, notas: r.notas,
    ...anulacionFields(r)
  };
}
function rowToExpense(r) {
  return { id: r.id, fecha: r.fecha, descripcion: r.descripcion, categoria: r.categoria, importe: Number(r.importe), metodoPago: r.metodo_pago, notas: r.notas, ...anulacionFields(r) };
}
function rowToCash(r) {
  return { id: r.id, fecha: r.fecha, tipo: r.tipo, origen: r.origen, monto: Number(r.monto), descripcion: r.descripcion, refId: r.ref_id };
}
function rowToShipment(r) {
  return { id: r.id, clienteId: r.cliente_id, direccion: r.direccion, localidad: r.localidad, pedidoId: r.pedido_id, costoEnvio: Number(r.costo_envio), estado: r.estado, fecha: r.fecha, observaciones: r.observaciones };
}
function rowToConfig(r) {
  return { shippingRates: r.shipping_rates, freeShippingFrom: Number(r.free_shipping_from), nextCodeNumber: r.next_code_number, inventarioRealCargado: r.inventario_real_cargado };
}

/* ------------------------------- CARGA INICIAL --------------------------- */

async function refreshAll() {
  const [prod, cli, ord, ven, com, gas, caja, env, cfg] = await Promise.all([
    sb.from('products').select('*').order('codigo'),
    sb.from('clients').select('*').order('nombre'),
    sb.from('orders').select('*').order('fecha', { ascending: false }),
    sb.from('sales').select('*').order('fecha', { ascending: false }),
    sb.from('purchases').select('*').order('fecha', { ascending: false }),
    sb.from('expenses').select('*').order('fecha', { ascending: false }),
    sb.from('cash_movements').select('*').order('fecha', { ascending: false }),
    sb.from('shipments').select('*').order('fecha', { ascending: false }),
    sb.from('app_config').select('*').eq('id', 1).maybeSingle()
  ]);
  throwIfError(prod.error, 'cargar productos');
  throwIfError(cli.error, 'cargar clientes');
  throwIfError(ord.error, 'cargar pedidos');
  throwIfError(ven.error, 'cargar ventas');
  throwIfError(com.error, 'cargar compras');
  throwIfError(gas.error, 'cargar gastos');
  throwIfError(caja.error, 'cargar caja');
  throwIfError(env.error, 'cargar envíos');
  throwIfError(cfg.error, 'cargar configuración');

  DB.products = prod.data.map(rowToProduct);
  DB.clients = cli.data.map(rowToClient);
  DB.orders = ord.data.map(rowToOrder);
  DB.sales = ven.data.map(rowToSale);
  DB.purchases = com.data.map(rowToPurchase);
  DB.expenses = gas.data.map(rowToExpense);
  DB.cashMovements = caja.data.map(rowToCash);
  DB.shipments = env.data.map(rowToShipment);
  if (cfg.data) DB.config = rowToConfig(cfg.data);
}

async function refreshProducts() {
  const { data, error } = await sb.from('products').select('*').order('codigo');
  throwIfError(error, 'actualizar productos');
  DB.products = data.map(rowToProduct);
}
async function refreshSales() {
  const { data, error } = await sb.from('sales').select('*').order('fecha', { ascending: false });
  throwIfError(error, 'actualizar ventas');
  DB.sales = data.map(rowToSale);
}
async function refreshPurchases() {
  const { data, error } = await sb.from('purchases').select('*').order('fecha', { ascending: false });
  throwIfError(error, 'actualizar compras');
  DB.purchases = data.map(rowToPurchase);
}
async function refreshExpenses() {
  const { data, error } = await sb.from('expenses').select('*').order('fecha', { ascending: false });
  throwIfError(error, 'actualizar gastos');
  DB.expenses = data.map(rowToExpense);
}
async function refreshCash() {
  const { data, error } = await sb.from('cash_movements').select('*').order('fecha', { ascending: false });
  throwIfError(error, 'actualizar caja');
  DB.cashMovements = data.map(rowToCash);
}
async function refreshOrders() {
  const { data, error } = await sb.from('orders').select('*').order('fecha', { ascending: false });
  throwIfError(error, 'actualizar pedidos');
  DB.orders = data.map(rowToOrder);
}
async function refreshConfig() {
  const { data, error } = await sb.from('app_config').select('*').eq('id', 1).maybeSingle();
  throwIfError(error, 'actualizar configuración');
  if (data) DB.config = rowToConfig(data);
}

/* ---------------------------- PRODUCTOS -------------------------------- */

function nextSuggestedCode() {
  return String(DB.config.nextCodeNumber).padStart(3, '0');
}

async function bumpNextCodeIfNeeded(codigo) {
  const n = parseInt(codigo, 10);
  if (!isNaN(n) && n >= DB.config.nextCodeNumber) {
    const nuevo = n + 1;
    const { error } = await sb.from('app_config').update({ next_code_number: nuevo, updated_at: nowISO() }).eq('id', 1);
    if (!error) DB.config.nextCodeNumber = nuevo;
  }
}

async function addProduct(data) {
  const payload = {
    codigo: (data.codigo || nextSuggestedCode()).trim(),
    nombre: data.nombre.trim(),
    categoria: data.categoria !== undefined ? data.categoria : 'Variados',
    foto: data.foto || '',
    costo: Number(data.costo) || 0,
    precio: Number(data.precio) || 0,
    stock: Number(data.stock) || 0,
    stock_min: Number(data.stockMin) || 0,
    revisar: !!data.revisar
  };
  const { data: row, error } = await sb.from('products').insert(payload).select().single();
  throwIfError(error, 'crear producto');
  const p = rowToProduct(row);
  DB.products.push(p);
  DB.products.sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
  await bumpNextCodeIfNeeded(p.codigo);
  return p;
}

async function updateProduct(id, data) {
  const payload = {};
  if (data.codigo !== undefined) payload.codigo = data.codigo;
  if (data.nombre !== undefined) payload.nombre = data.nombre;
  if (data.categoria !== undefined) payload.categoria = data.categoria;
  if (data.costo !== undefined) payload.costo = Number(data.costo) || 0;
  if (data.precio !== undefined) payload.precio = Number(data.precio) || 0;
  if (data.stock !== undefined) payload.stock = Number(data.stock) || 0;
  if (data.stockMin !== undefined) payload.stock_min = Number(data.stockMin) || 0;
  if (data.revisar !== undefined) payload.revisar = !!data.revisar;
   
if (data.foto !== undefined) payload.foto = data.foto;


  const { data: row, error } = await sb.from('products').update(payload).eq('id', id).select().single();
  throwIfError(error, 'editar producto');
  const p = rowToProduct(row);
  const idx = DB.products.findIndex(x => x.id === id);
  if (idx > -1) DB.products[idx] = p; else DB.products.push(p);
  return p;
}

async function deleteProduct(id) {
  const { error } = await sb.from('products').delete().eq('id', id);
  throwIfError(error, 'eliminar producto');
  DB.products = DB.products.filter(x => x.id !== id);
}

/* Ajuste manual de stock (+/-). No es atómico a nivel de base de datos como
   las ventas/compras (esas usan RPC transaccional); para el uso normal de
   un solo administrador ajustando stock a mano, este método es suficiente.
   Antes de escribir, relee el valor actual desde Supabase para minimizar
   el riesgo de pisar un cambio hecho desde otro dispositivo. */
async function adjustStock(productId, delta) {
  const { data: actual, error: errLectura } = await sb.from('products').select('stock').eq('id', productId).single();
  throwIfError(errLectura, 'leer stock actual');
  const nuevoStock = Number(actual.stock) + Number(delta);
  const { data: row, error } = await sb.from('products').update({ stock: nuevoStock }).eq('id', productId).select().single();
  throwIfError(error, 'ajustar stock');
  const p = rowToProduct(row);
  const idx = DB.products.findIndex(x => x.id === productId);
  if (idx > -1) DB.products[idx] = p;
  return p;
}

function findProducts({ q = '', categoria = '', soloBajoStock = false, soloSinStock = false } = {}) {
  return DB.products.filter(p => {
    if (q) {
      const s = q.toLowerCase();
      if (!p.nombre.toLowerCase().includes(s) && !p.codigo.toLowerCase().includes(s)) return false;
    }
    if (categoria && p.categoria !== categoria) return false;
    if (soloSinStock && p.stock > 0) return false;
    if (soloBajoStock && !(p.stock > 0 && p.stock <= p.stockMin)) return false;
    return true;
  }).sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }));
}

/* Importación CSV: codigo,nombre,categoria,costo,precio,stock,stockMin.
   Fila por fila, secuencial (no en paralelo) para no pisar el contador de
   próximo código y para poder reportar errores fila por fila. */
async function importProductsCSV(text, { reemplazarExistentes = false } = {}) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length);
  if (!lines.length) return { ok: 0, errores: ['El archivo está vacío.'] };
  const header = lines[0].split(',').map(h => h.trim().toLowerCase());
  const idx = {
    codigo: header.indexOf('codigo'), nombre: header.indexOf('nombre'), categoria: header.indexOf('categoria'),
    costo: header.indexOf('costo'), precio: header.indexOf('precio'), stock: header.indexOf('stock'), stockMin: header.indexOf('stockmin')
  };
  if (idx.nombre === -1) {
    return { ok: 0, errores: ['El CSV necesita al menos una columna "nombre". Columnas esperadas: codigo,nombre,categoria,costo,precio,stock,stockMin'] };
  }
  const errores = [];
  let ok = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    const raw = {
      codigo: idx.codigo > -1 ? cols[idx.codigo]?.trim() : '',
      nombre: idx.nombre > -1 ? cols[idx.nombre]?.trim() : '',
      categoria: idx.categoria > -1 ? cols[idx.categoria]?.trim() : '',
      costo: idx.costo > -1 ? cols[idx.costo]?.trim() : '',
      precio: idx.precio > -1 ? cols[idx.precio]?.trim() : '',
      stock: idx.stock > -1 ? cols[idx.stock]?.trim() : '',
      stockMin: idx.stockMin > -1 ? cols[idx.stockMin]?.trim() : ''
    };
    if (!raw.nombre) { errores.push(`Fila ${i + 1}: falta el nombre, se omitió.`); continue; }

    const tieneError = ['costo', 'precio', 'stock'].some(k => raw[k] && /#REF!|error/i.test(raw[k]));
    const sinCategoria = idx.categoria > -1 && !raw.categoria;
    const flagged = tieneError || (!raw.costo || !raw.precio) || sinCategoria;

    const existente = raw.codigo ? DB.products.find(p => p.codigo === raw.codigo) : null;
    const payload = {
      codigo: raw.codigo || nextSuggestedCode(),
      nombre: raw.nombre,
      categoria: idx.categoria > -1 ? raw.categoria : undefined,
      costo: /^\-?\d+(\.\d+)?$/.test(raw.costo) ? Number(raw.costo) : 0,
      precio: /^\-?\d+(\.\d+)?$/.test(raw.precio) ? Number(raw.precio) : 0,
      stock: /^\-?\d+(\.\d+)?$/.test(raw.stock) ? Number(raw.stock) : 0,
      stockMin: /^\-?\d+(\.\d+)?$/.test(raw.stockMin) ? Number(raw.stockMin) : 0,
      revisar: flagged
    };

    try {
      if (existente && reemplazarExistentes) {
        await updateProduct(existente.id, payload);
      } else if (existente && !reemplazarExistentes) {
        errores.push(`Fila ${i + 1}: el código ${raw.codigo} ya existe, no se importó (activá "reemplazar existentes" si querés actualizarlo).`);
        continue;
      } else {
        await addProduct(payload);
      }
      if (flagged) errores.push(`Fila ${i + 1} (${raw.nombre}): revisar categoría/costo/precio/stock, quedó marcado para corregir.`);
      ok++;
    } catch (e) {
      errores.push(`Fila ${i + 1} (${raw.nombre}): error al guardar — ${e.message}`);
    }
  }
  return { ok, errores };
}

/* -------- Migración inicial del inventario real (117 productos) --------
   Usa el array INVENTARIO_REAL_ELDOSTORE (data/inventario-real.js), tal
   cual vino del archivo real del dueño del negocio. Hace upsert por
   "codigo" (clave única), así que se puede ejecutar más de una vez sin
   duplicar nada. */
async function seedRealInventoryIfNeeded() {
  if (DB.config.inventarioRealCargado) return { cargados: 0, saltados: DB.products.length, yaEstaba: true };
  if (typeof INVENTARIO_REAL_ELDOSTORE === 'undefined' || !Array.isArray(INVENTARIO_REAL_ELDOSTORE)) {
    return { cargados: 0, saltados: 0, error: 'No se encontró data/inventario-real.js' };
  }

  const payload = INVENTARIO_REAL_ELDOSTORE.map(item => ({
    codigo: item.codigo,
    nombre: item.nombre,
    categoria: item.categoria,
    costo: item.costo,
    precio: item.precio,
    stock: item.stock,
    stock_min: item.stockMin,
    revisar: !item.categoria
  }));

  const { error } = await sb.from('products').upsert(payload, { onConflict: 'codigo', ignoreDuplicates: true });
  throwIfError(error, 'migrar inventario real');

  await refreshProducts();
  await sb.from('app_config').update({ next_code_number: 118, inventario_real_cargado: true, updated_at: nowISO() }).eq('id', 1);
  DB.config.inventarioRealCargado = true;
  DB.config.nextCodeNumber = Math.max(DB.config.nextCodeNumber, 118);
  return { cargados: payload.length, saltados: 0, yaEstaba: false };
}

/* ----------------------------- CLIENTES -------------------------------- */

async function addClient(data) {
  const payload = { nombre: data.nombre.trim(), telefono: data.telefono || '', localidad: data.localidad || '', direccion: data.direccion || '', notas: data.notas || '' };
  const { data: row, error } = await sb.from('clients').insert(payload).select().single();
  throwIfError(error, 'crear cliente');
  const c = rowToClient(row);
  DB.clients.push(c);
  return c;
}
async function updateClient(id, data) {
  const payload = {};
  ['nombre', 'telefono', 'localidad', 'direccion', 'notas'].forEach(k => { if (data[k] !== undefined) payload[k] = data[k]; });
  const { data: row, error } = await sb.from('clients').update(payload).eq('id', id).select().single();
  throwIfError(error, 'editar cliente');
  const c = rowToClient(row);
  const idx = DB.clients.findIndex(x => x.id === id);
  if (idx > -1) DB.clients[idx] = c;
  return c;
}
async function deleteClient(id) {
  const { error } = await sb.from('clients').delete().eq('id', id);
  throwIfError(error, 'eliminar cliente');
  DB.clients = DB.clients.filter(x => x.id !== id);
}
function clientHistory(clientId) {
  const pedidos = DB.orders.filter(o => o.clienteId === clientId);
  const ventas = activeSales().filter(v => v.clienteId === clientId);
  const totalGastado = round2(ventas.reduce((a, v) => a + v.total, 0));
  const ultimaCompra = ventas.length ? ventas.map(v => v.fecha).sort().slice(-1)[0] : null;
  return { pedidos, ventas, totalGastado, ultimaCompra };
}

/* ------------------------------ PEDIDOS -------------------------------- */

const ESTADOS_PEDIDO = ['Pendiente', 'Confirmado', 'Preparando', 'Listo', 'Enviado', 'Entregado', 'Cancelado'];

async function addOrder(data) {
  const items = data.items.map(it => ({ productoId: it.productoId, cantidad: Number(it.cantidad), precio: Number(it.precio) }));
  const total = round2(items.reduce((a, it) => a + it.cantidad * it.precio, 0));
  const sena = Number(data.sena) || 0;
  const payload = {
    cliente_id: data.clienteId || null, items, total, sena, saldo: round2(total - sena),
    metodo_pago: data.metodoPago || '', envio_o_retiro: data.envioORetiro || 'Retiro',
    direccion: data.direccion || '', notas: data.notas || '', estado: 'Pendiente'
  };
  const { data: row, error } = await sb.from('orders').insert(payload).select().single();
  throwIfError(error, 'crear pedido');
  const o = rowToOrder(row);
  DB.orders.unshift(o);
  return o;
}

async function updateOrderStatus(id, estado) {
  const { data: row, error } = await sb.from('orders').update({ estado }).eq('id', id).select().single();
  throwIfError(error, 'cambiar estado de pedido');
  const o = rowToOrder(row);
  const idx = DB.orders.findIndex(x => x.id === id);
  if (idx > -1) DB.orders[idx] = o;
  return o;
}

/* Convierte un pedido en venta llamando al RPC transaccional (evita doble
   descuento de stock incluso con dos dispositivos actuando a la vez). */
async function convertOrderToSale(orderId, metodoPago) {
  const { data, error } = await sb.rpc('convert_order_to_sale', { p_order_id: orderId, p_metodo_pago: metodoPago || null });
  if (error) return { error: error.message };
  await Promise.all([refreshProducts(), refreshSales(), refreshOrders(), refreshCash()]);
  return { venta: data };
}

/* ------------------------------- VENTAS -------------------------------- */

const MODALIDADES_VENTA = { propia: 'Venta propia', revendedor: 'Venta por revendedor' };

/* Cálculo de una línea de venta, igual al que hace la base de datos
   (_eldo_register_sale). Se usa para la vista previa del formulario; el
   valor que se guarda lo calcula Supabase.
   Comisión = precio unitario × cantidad × % / 100 (solo en revendedor). */
function calcSaleLine(it, modalidad) {
  const cantidad = Number(it.cantidad) || 0;
  const precio = Number(it.precioVenta) || 0;
  const costoUnit = Number(it.costoUnit) || 0;
  const pct = modalidad === 'revendedor' ? (Number(it.comisionPct) || 0) : 0;
  const subtotal = round2(cantidad * precio);
  const costoTotal = round2(cantidad * costoUnit);
  const comision = round2(subtotal * pct / 100);
  return { subtotal, costoTotal, pct, comision, ganancia: round2(subtotal - costoTotal - comision) };
}

function calcSaleTotals(items, modalidad) {
  return items.reduce((a, it) => {
    const l = calcSaleLine(it, modalidad);
    a.total = round2(a.total + l.subtotal);
    a.costoTotal = round2(a.costoTotal + l.costoTotal);
    a.comision = round2(a.comision + l.comision);
    a.ganancia = round2(a.ganancia + l.ganancia);
    return a;
  }, { total: 0, costoTotal: 0, comision: 0, ganancia: 0 });
}

function saleItemsPayload(items, modalidad) {
  return items.map(it => {
    const linea = { productoId: it.productoId, cantidad: Number(it.cantidad), precioVenta: Number(it.precioVenta) };
    if (modalidad === 'revendedor') linea.comisionPct = Number(it.comisionPct);
    return linea;
  });
}

/* Registra una venta (propia o por revendedor) con el RPC transaccional
   register_sale_v2: valida stock, descuenta, calcula costo, comisión y
   ganancia, y registra el ingreso (y el egreso de comisión) en caja, todo
   en una sola transacción. */
async function registerSale({ clienteId, items, metodoPago, modalidad }) {
  const { data, error } = await sb.rpc('register_sale_v2', {
    p_cliente_id: clienteId || null, p_items: saleItemsPayload(items, modalidad),
    p_metodo_pago: metodoPago || '', p_modalidad: modalidad
  });
  if (error) return { error: rpcErrorMessage(error) };
  MIGRACION_002.detectada = true;
  await Promise.all([refreshProducts(), refreshSales(), refreshCash()]);
  return { venta: data };
}

/* ---------------------- ANULACIONES Y CORRECCIONES -----------------------
   Nunca se borra nada: anular marca la operación como anulada y revierte
   sus efectos (stock y caja). Corregir = anular + registrar la versión
   correcta, en una sola transacción; la nueva queda vinculada a la
   original (corrige_a). */

async function voidSale(id, motivo) {
  const { data, error } = await sb.rpc('void_sale', { p_sale_id: id, p_motivo: motivo });
  if (error) throw new Error(rpcErrorMessage(error));
  await Promise.all([refreshProducts(), refreshSales(), refreshCash(), refreshOrders()]);
  return data;
}

async function correctSale(id, motivo, { clienteId, items, metodoPago, modalidad }) {
  const { data, error } = await sb.rpc('correct_sale', {
    p_sale_id: id, p_motivo: motivo, p_cliente_id: clienteId || null,
    p_items: saleItemsPayload(items, modalidad), p_metodo_pago: metodoPago || '', p_modalidad: modalidad
  });
  if (error) throw new Error(rpcErrorMessage(error));
  await Promise.all([refreshProducts(), refreshSales(), refreshCash(), refreshOrders()]);
  return data;
}

async function voidPurchase(id, motivo) {
  const { data, error } = await sb.rpc('void_purchase', { p_purchase_id: id, p_motivo: motivo });
  if (error) throw new Error(rpcErrorMessage(error));
  await Promise.all([refreshProducts(), refreshPurchases(), refreshCash()]);
  return data;
}

async function correctPurchase(id, motivo, data) {
  const { data: r, error } = await sb.rpc('correct_purchase', {
    p_purchase_id: id, p_motivo: motivo, p_proveedor: data.proveedor || '', p_producto_id: data.productoId,
    p_cantidad: Number(data.cantidad), p_costo_unit: Number(data.costoUnit),
    p_metodo_pago: data.metodoPago || '', p_notas: data.notas || ''
  });
  if (error) throw new Error(rpcErrorMessage(error));
  await Promise.all([refreshProducts(), refreshPurchases(), refreshCash()]);
  return r;
}

async function voidExpense(id, motivo) {
  const { data, error } = await sb.rpc('void_expense', { p_expense_id: id, p_motivo: motivo });
  if (error) throw new Error(rpcErrorMessage(error));
  await Promise.all([refreshExpenses(), refreshCash()]);
  return data;
}

async function correctExpense(id, motivo, data) {
  const { data: r, error } = await sb.rpc('correct_expense', {
    p_expense_id: id, p_motivo: motivo, p_descripcion: data.descripcion, p_categoria: data.categoria || '',
    p_importe: Number(data.importe), p_metodo_pago: data.metodoPago || '', p_notas: data.notas || ''
  });
  if (error) throw new Error(rpcErrorMessage(error));
  await Promise.all([refreshExpenses(), refreshCash()]);
  return r;
}

/* Operaciones vigentes (las anuladas no cuentan en dashboard ni reportes). */
function activeSales() { return DB.sales.filter(v => !v.anulada); }
function activePurchases() { return DB.purchases.filter(c => !c.anulada); }
function activeExpenses() { return DB.expenses.filter(g => !g.anulada); }

/* Resumen de ventas separado por modalidad. "ganancia" ya viene neta de
   comisión (total - costo - comisión). */
function salesSummary(ventas) {
  const vacio = () => ({ cantidad: 0, total: 0, costo: 0, comision: 0, ganancia: 0 });
  const r = { propia: vacio(), revendedor: vacio(), todas: vacio() };
  ventas.forEach(v => {
    [r[v.modalidad === 'revendedor' ? 'revendedor' : 'propia'], r.todas].forEach(g => {
      g.cantidad++;
      g.total = round2(g.total + v.total);
      g.costo = round2(g.costo + v.costoTotal);
      g.comision = round2(g.comision + v.comisionTotal);
      g.ganancia = round2(g.ganancia + v.ganancia);
    });
  });
  return r;
}

/* ------------------------------ COMPRAS -------------------------------- */

async function registerPurchase(data) {
  const { data: resultado, error } = await sb.rpc('register_purchase', {
    p_proveedor: data.proveedor || '', p_producto_id: data.productoId,
    p_cantidad: Number(data.cantidad), p_costo_unit: Number(data.costoUnit),
    p_metodo_pago: data.metodoPago || '', p_notas: data.notas || ''
  });
  if (error) throw new Error(error.message);
  await Promise.all([refreshProducts(), refreshPurchases(), refreshCash()]);
  return resultado;
}

/* ------------------------------- GASTOS -------------------------------- */

async function registerExpense(data) {
  const payload = { descripcion: data.descripcion, categoria: data.categoria || 'General', importe: Number(data.importe) || 0, metodo_pago: data.metodoPago || '', notas: data.notas || '' };
  const { data: row, error } = await sb.from('expenses').insert(payload).select().single();
  throwIfError(error, 'registrar gasto');
  const gasto = rowToExpense(row);
  DB.expenses.unshift(gasto);

  const { data: cajaRow, error: errCaja } = await sb.from('cash_movements')
    .insert({ tipo: 'egreso', origen: 'gasto', monto: gasto.importe, descripcion: gasto.descripcion, ref_id: gasto.id })
    .select().single();
  throwIfError(errCaja, 'registrar movimiento de caja del gasto');
  DB.cashMovements.unshift(rowToCash(cajaRow));

  return gasto;
}

/* -------------------------------- CAJA ---------------------------------- */

async function addManualCashMovement(tipo, monto, descripcion) {
  const payload = { tipo, origen: 'otro', monto: Number(monto), descripcion: descripcion || '' };
  const { data: row, error } = await sb.from('cash_movements').insert(payload).select().single();
  throwIfError(error, 'registrar movimiento de caja');
  const mov = rowToCash(row);
  DB.cashMovements.unshift(mov);
  return mov;
}

function cashBalance() {
  return round2(DB.cashMovements.reduce((a, m) => a + (m.tipo === 'ingreso' ? m.monto : -m.monto), 0));
}

/* ------------------------------- ENVÍOS ---------------------------------- */

function shippingCostForKm(km) {
  const r = DB.config.shippingRates.find(r => km >= r.min && km <= r.max);
  return r ? r.costo : null;
}

async function registerShipment(data) {
  const payload = {
    cliente_id: data.clienteId || null, direccion: data.direccion || '', localidad: data.localidad || '',
    pedido_id: data.pedidoId || null, costo_envio: Number(data.costoEnvio) || 0,
    estado: data.estado || 'Pendiente', observaciones: data.observaciones || ''
  };
  const { data: row, error } = await sb.from('shipments').insert(payload).select().single();
  throwIfError(error, 'registrar envío');
  const env = rowToShipment(row);
  DB.shipments.unshift(env);
  return env;
}

async function updateShipmentStatus(id, estado) {
  const { data: row, error } = await sb.from('shipments').update({ estado }).eq('id', id).select().single();
  throwIfError(error, 'actualizar estado de envío');
  const env = rowToShipment(row);
  const idx = DB.shipments.findIndex(x => x.id === id);
  if (idx > -1) DB.shipments[idx] = env;
  return env;
}

/* ----------------------------- DASHBOARD --------------------------------- */

function isSameDay(iso, ref) { const d = new Date(iso); return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth() && d.getDate() === ref.getDate(); }
function isSameMonth(iso, ref) { const d = new Date(iso); return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth(); }

function dashboardData() {
  const hoy = new Date();
  const ventasHoy = activeSales().filter(v => isSameDay(v.fecha, hoy));
  const ventasMes = activeSales().filter(v => isSameMonth(v.fecha, hoy));
  const gastosMes = activeExpenses().filter(g => isSameMonth(g.fecha, hoy));
  return {
    cantidadProductos: DB.products.length,
    unidadesStock: DB.products.reduce((a, p) => a + p.stock, 0),
    valorInventario: round2(DB.products.reduce((a, p) => a + p.valorStock, 0)),
    ventasHoyTotal: round2(ventasHoy.reduce((a, v) => a + v.total, 0)),
    ventasMesTotal: round2(ventasMes.reduce((a, v) => a + v.total, 0)),
    gananciaHoy: round2(ventasHoy.reduce((a, v) => a + v.ganancia, 0)),
    gananciaMes: round2(ventasMes.reduce((a, v) => a + v.ganancia, 0)),
    comisionesMes: round2(ventasMes.reduce((a, v) => a + v.comisionTotal, 0)),
    gastosMes: round2(gastosMes.reduce((a, g) => a + g.importe, 0)),
    caja: cashBalance(),
    pedidosPendientes: DB.orders.filter(o => !['Entregado', 'Cancelado'].includes(o.estado)).length,
    productosBajoStock: findProducts({ soloBajoStock: true }),
    ventasPorDia: last7DaysSeries()
  };
}

function last7DaysSeries() {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const delDia = activeSales().filter(v => isSameDay(v.fecha, d));
    const total = round2(delDia.reduce((a, v) => a + v.total, 0));
    const ganancia = round2(delDia.reduce((a, v) => a + v.ganancia, 0));
    days.push({ label: d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' }), total, ganancia });
  }
  return days;
}

/* ------------------------------ RESPALDO --------------------------------- */

/* Exporta una foto actual de lo que hay en Supabase (copia de seguridad
   local adicional; la fuente de verdad sigue siendo Supabase). */
function exportBackupJSON() {
  return JSON.stringify({ ...DB, exportadoEl: nowISO() }, null, 2);
}

/* Restaura un respaldo SOLO para productos (por código, upsert) — no
   vuelve a insertar ventas/compras/gastos/caja para no duplicar
   movimientos contables reales. Si necesitás restaurar todo el historial,
   hacelo desde el propio panel de Supabase (Table Editor / backups). */
async function importBackupJSON(jsonText) {
  const parsed = JSON.parse(jsonText);
  if (!parsed.products || !Array.isArray(parsed.products)) {
    throw new Error('El respaldo no tiene una lista de productos válida.');
  }
  const payload = parsed.products.map(p => ({
    codigo: p.codigo, nombre: p.nombre, categoria: p.categoria || '',
    costo: p.costo, precio: p.precio, stock: p.stock, stock_min: p.stockMin || 0, revisar: !!p.revisar
  }));
  const { error } = await sb.from('products').upsert(payload, { onConflict: 'codigo' });
  throwIfError(error, 'restaurar respaldo de productos');
  await refreshProducts();
  return { productosRestaurados: payload.length };
}
