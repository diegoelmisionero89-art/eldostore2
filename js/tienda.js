/* ==========================================================================
   ELDOSTORE — Tienda pública (js/tienda.js)

   - Lee el catálogo real con la función RPC catalogo_tienda() de Supabase,
     igual que la versión anterior. No escribe nada en la base de datos.
   - Campos que usa de cada producto: nombre, precio, categoria, foto,
     disponible. Si la función también devuelve id o codigo, los usa para
     identificar los productos en el carrito.
   - El carrito se guarda solo en el navegador del cliente (localStorage),
     con el identificador y la cantidad. Los precios se toman siempre del
     catálogo recién cargado.
   - Este archivo lo usa SOLO index.html. El panel administrativo no lo carga.
   - Galería: además de foto, lee las fotos adicionales con fotos_tienda()
     (migración 004). Si esa función no existe todavía, cada producto muestra
     solo su foto principal, como antes.
   - Enlace para compartir una ficha: https://eldostore.com.ar/p/<código>/
     (página con la vista previa del producto, generada por el workflow
     "Fichas para compartir"), que lleva a ?p=<código>. Si el código tiene
     caracteres especiales se usa ?p=<código>, y si se repite, ?p=<id>.
     En una versión de prueba (otro dominio), los enlaces apuntan a esa
     misma versión de prueba y nunca a la tienda oficial.
   ========================================================================== */
(function () {
  "use strict";

  const CFG = Object.assign({
    supabaseUrl: "",
    supabaseKey: "",
    whatsapp: "",
    whatsapp2: "",
    instagram: "",
    envioGratisDesde: 12000,
    sitioOficial: "https://eldostore.com.ar/"
  }, window.ELDOSTORE_CONFIG || {});
  const CANTIDAD_MAX = 99;
  const CLAVE_CARRITO = "eldostore_carrito_v1";

  /* ---------- Utilidades ---------- */
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const fmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  const money = n => fmt.format(n).replace(/ /g, " ");
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const norm = v => String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const limpiar = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const limpiarNumero = v => { const n = String(v || "").replace(/\D/g, ""); return n.length >= 10 && n.length <= 15 ? n : ""; };
  const numeroWhatsApp = () => limpiarNumero(CFG.whatsapp);
  // Números que reciben pedidos del carrito (WhatsApp 1 y, si está configurado, WhatsApp 2)
  const numerosPedido = () => Array.from(new Set([limpiarNumero(CFG.whatsapp), limpiarNumero(CFG.whatsapp2)].filter(Boolean)));
  // 5493757613059 → "3757 613059" (como lo escribe la gente en Argentina)
  const numeroVisible = n => { const l = n.startsWith("549") && n.length === 13 ? n.slice(3) : n; return l.length === 10 ? l.slice(0, 4) + " " + l.slice(4) : l; };
  const WA_SVG = $("#waFab svg") ? $("#waFab svg").outerHTML : "";
  const ICONO_FB = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8v3h2.5V21h3z"/></svg>';
  const ICONO_IG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none"/></svg>';

  /* ---------- Íconos de categorías (se eligen por el nombre real) ---------- */
  const I = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const ICONOS = [
    [/todo/, I('<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>')],
    [/auricular|headset|audifono/, I('<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>')],
    [/celular|telefono|smartphone|movil/, I('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>')],
    [/cargador|carga|bateria|power/, I('<path d="M13 2 5 13h6l-1 9 8-11h-6l1-9z"/>')],
    [/cable/, I('<path d="M7 3v5M17 3v5M5 8h14v3a7 7 0 0 1-14 0V8zM12 18v3"/>')],
    [/tv|televis|smart tv/, I('<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8M12 17v4"/>')],
    [/parlante|audio|sonido/, I('<rect x="6" y="3" width="12" height="18" rx="2"/><circle cx="12" cy="14" r="3"/><circle cx="12" cy="7" r="1"/>')],
    [/comput|notebook|pc|teclado|mouse/, I('<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M2 20h20"/>')],
    [/gam|joystick|consola/, I('<path d="M6 9h12a4 4 0 0 1 4 4v1a3 3 0 0 1-5.4 1.8L15 14H9l-1.6 1.8A3 3 0 0 1 2 14v-1a4 4 0 0 1 4-4z"/><path d="M7 11v3M5.5 12.5h3"/>')],
    [/reloj|smartwatch|watch/, I('<rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6V3h6v3M9 18v3h6v-3M12 10v2l1.5 1"/>')],
    [/electrodom|cocina|freidora|pava/, I('<path d="M6 8h12l-1 12H7L6 8zM9 8V5h6v3M18 11h2v4h-2"/>')],
    [/herramient|taladro/, I('<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6 2.6-2.2z"/>')],
    [/perfum|fragan/, I('<rect x="9" y="2.5" width="6" height="4" rx="1"/><rect x="6" y="8" width="12" height="13" rx="3"/>')],
    [/mascot|perro|gato/, I('<circle cx="7" cy="9" r="2"/><circle cx="12" cy="6.5" r="2"/><circle cx="17" cy="9" r="2"/><path d="M8 17c0-2.5 2-4.5 4-4.5s4 2 4 4.5c0 1.6-1.3 2.5-2.6 2.1L12 18.7l-1.4.4C9.3 19.5 8 18.6 8 17z"/>')],
    [/segurid|camara/, I('<path d="M12 3 4 6v6c0 4.5 3.4 8.1 8 9 4.6-.9 8-4.5 8-9V6l-8-3z"/>')],
    [/hogar|casa|bazar/, I('<path d="M3 11 12 4l9 7M5 10v10h14V10"/>')],
    [/accesorio/, I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>')]
  ];
  const ICONO_GENERICO = I('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>');
  const iconoCategoria = nombre => { const n = norm(nombre); for (const [re, svg] of ICONOS) if (re.test(n)) return svg; return ICONO_GENERICO; };

  /* ---------- Catálogo ---------- */
  let PRODUCTOS = [];
  let porClave = new Map();
  let campoId = null; // "id", "codigo" o null (se usa el nombre)
  const estado = { categoria: null, texto: "", orden: "dest" };
  const cantidadElegida = new Map();

  function fotoValida(v) {
    const s = typeof v === "string" ? v.trim() : "";
    return /^https:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
  }

  function prepararCatalogo(filas) {
    const lista = Array.isArray(filas) ? filas : [];
    const todos = campo => lista.length > 0 && lista.every(r => r && r[campo] != null && String(r[campo]).trim() !== "");
    const unicos = campo => new Set(lista.map(r => String(r[campo]))).size === lista.length;
    campoId = todos("id") && unicos("id") ? "id" : (todos("codigo") && unicos("codigo") ? "codigo" : null);

    const vistos = new Map();
    const productos = lista.map(r => {
      const nombre = limpiar(r && r.nombre, 140) || "Producto";
      const precio = Number(r && r.precio);
      let clave;
      if (campoId) clave = campoId + ":" + String(r[campoId]);
      else {
        const base = "nombre:" + norm(nombre);
        const n = (vistos.get(base) || 0) + 1; vistos.set(base, n);
        clave = n === 1 ? base : base + "#" + n;
      }
      const anterior = Number(r && r.precio_anterior);
      return {
        clave,
        nombre,
        categoria: limpiar(r && r.categoria, 60),
        precio: Number.isFinite(precio) && precio > 0 ? Math.round(precio) : null,
        precioAnterior: Number.isFinite(anterior) && anterior > 0 ? Math.round(anterior) : null,
        disponible: !!(r && r.disponible === true),
        foto: fotoValida(r && r.foto),
        id: r && r.id != null ? String(r.id) : "",
        // Código interno tal como está en products.codigo (texto: conserva los ceros iniciales).
        codigo: r && r.codigo != null ? String(r.codigo).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60) : ""
      };
    });
    for (const p of productos) p.fotos = p.foto ? [p.foto] : [];
    // Códigos repetidos: esos productos se comparten con su id
    const usos = new Map();
    for (const p of productos) if (p.codigo) usos.set(p.codigo, (usos.get(p.codigo) || 0) + 1);
    for (const p of productos) p.codigoUnico = !!p.codigo && usos.get(p.codigo) === 1;

    // Diagnóstico para el dueño (consola del navegador): qué campos devuelve la función.
    try {
      console.info("[ELDOSTORE] catalogo_tienda(): " + lista.length + " productos. Campos: " +
        (lista[0] ? Object.keys(lista[0]).join(", ") : "(sin filas)") +
        ". Identificador del carrito: " + (campoId || "nombre del producto"));
    } catch (e) { /* sin consola */ }
    return productos;
  }

  let clienteSb = null;
  function cliente() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      const err = new Error("No se pudo cargar la librería de Supabase");
      err.tipo = "libreria"; throw err;
    }
    if (!clienteSb) clienteSb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    return clienteSb;
  }
  async function cargarCatalogo() {
    const sb = cliente();
    const { data, error } = await sb.rpc("catalogo_tienda");
    if (error) { const err = new Error(error.message || "Error de catalogo_tienda"); err.tipo = "rpc"; throw err; }
    return data || [];
  }

  /* Fotos adicionales (migración 004). Cualquier problema → solo la foto principal. */
  const MAX_FOTOS = 12;
  async function cargarFotosExtra() {
    try {
      const { data, error } = await cliente().rpc("fotos_tienda");
      if (error) { console.info("[ELDOSTORE] fotos_tienda() no disponible: se muestra solo la foto principal."); return []; }
      return Array.isArray(data) ? data : [];
    } catch (e) { return []; }
  }
  function aplicarFotosExtra(productos, filas) {
    const porId = new Map(productos.filter(p => p.id).map(p => [p.id, p]));
    for (const f of filas) {
      const p = f && porId.get(String(f.producto_id));
      const url = fotoValida(f && f.url);
      if (p && url && !p.fotos.includes(url) && p.fotos.length < MAX_FOTOS) p.fotos.push(url);
    }
    // Sin foto principal pero con adicionales: la primera hace de principal
    for (const p of productos) if (!p.foto && p.fotos.length) p.foto = p.fotos[0];
  }

  /* ---------- Carrito ---------- */
  let carrito = new Map();
  const sePuedeComprar = p => !!(p && p.disponible && p.precio);

  function leerCarrito() {
    try {
      const raw = localStorage.getItem(CLAVE_CARRITO);
      if (!raw) return new Map();
      const obj = JSON.parse(raw);
      if (!obj || obj.v !== 1 || typeof obj.items !== "object" || obj.items === null) return new Map();
      const m = new Map();
      for (const [k, q] of Object.entries(obj.items)) {
        const n = Math.floor(Number(q));
        if (typeof k === "string" && k.length <= 200 && n >= 1) m.set(k, Math.min(n, CANTIDAD_MAX));
      }
      return m;
    } catch (e) { return new Map(); }
  }
  function guardarCarrito() {
    try { localStorage.setItem(CLAVE_CARRITO, JSON.stringify({ v: 1, items: Object.fromEntries(carrito) })); } catch (e) { /* sin almacenamiento */ }
  }
  function conciliarCarrito() {
    const quitados = [];
    for (const k of Array.from(carrito.keys())) {
      const p = porClave.get(k);
      if (!sePuedeComprar(p)) { carrito.delete(k); quitados.push(p ? p.nombre : "un producto que ya no está publicado"); }
    }
    if (quitados.length) {
      guardarCarrito();
      aviso("Actualizamos tu carrito: se quitó " + quitados.map(esc).join(", ") + " porque ya no está disponible o no tiene precio publicado.");
    }
  }
  function lineas() {
    const out = [];
    for (const [k, q] of carrito) { const p = porClave.get(k); if (sePuedeComprar(p)) out.push({ p, q, sub: p.precio * q }); }
    return out;
  }
  const totales = () => lineas().reduce((a, l) => ({ unidades: a.unidades + l.q, total: a.total + l.sub }), { unidades: 0, total: 0 });
  function setCantidad(k, q) {
    const p = porClave.get(k);
    if (!sePuedeComprar(p)) return;
    const n = Math.max(0, Math.min(CANTIDAD_MAX, Math.floor(q)));
    if (n === 0) carrito.delete(k); else carrito.set(k, n);
    guardarCarrito();
    actualizarTodo();
  }

  /* ---------- Dibujo ---------- */
  function fotoHTML(p, chico) {
    if (p.foto) return `<img src="${esc(p.foto)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">`;
    return `<span class="ph">${chico ? "" : "ELDOSTORE"}</span>`;
  }

  const PREFIJO_FICHA = "#producto/";
  const enlaceFicha = p => esc(PREFIJO_FICHA + encodeURIComponent(p.clave));
  // Dirección completa para compartir: abre directamente la ficha de este producto.
  const SITIO_OFICIAL = String(CFG.sitioOficial || "https://eldostore.com.ar/").replace(/\/*$/, "/");
  const esSitioOficial = (() => {
    let h = ""; try { h = new URL(SITIO_OFICIAL).hostname.replace(/^www\./, ""); } catch (e) { /* config inválida */ }
    const actual = location.hostname.replace(/^www\./, "");
    return (!!h && actual === h) || /\.github\.io$/.test(actual); // github.io redirige al dominio oficial
  })();
  // Raíz para los enlaces: el dominio oficial en producción; esta misma versión en una prueba.
  const RAIZ = esSitioOficial ? SITIO_OFICIAL : location.origin + location.pathname.replace(/[^/]*$/, "");
  const PAGINA = esSitioOficial ? "" : "index.html";
  const codigoEnRuta = c => /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(c);
  function enlaceCompartir(p) {
    if (p.codigoUnico && codigoEnRuta(p.codigo)) return RAIZ + "p/" + p.codigo + "/" + PAGINA;
    if (p.codigoUnico) return RAIZ + PAGINA + "?p=" + encodeURIComponent(p.codigo);
    if (p.id) return RAIZ + PAGINA + "?p=" + encodeURIComponent(p.id);
    return RAIZ + PAGINA + PREFIJO_FICHA + encodeURIComponent(p.clave);
  }
  function mensajeProducto(p, inicio, conEnlace) {
    const r = [inicio, "", "Producto: " + p.nombre];
    if (p.codigo) r.push("Código: " + p.codigo);
    r.push("Precio: " + (p.precio ? money(p.precio) : "a consultar"));
    if (conEnlace) r.push("Enlace: " + enlaceCompartir(p));
    return r.join("\n");
  }

  function filtrados() {
    const t = norm(estado.texto);
    let lista = PRODUCTOS.filter(p =>
      (!estado.categoria || p.categoria === estado.categoria) &&
      (!t || norm(p.nombre + " " + p.categoria).includes(t)));
    const cmp = (a, b, dir) => ((a.precio == null) - (b.precio == null)) || dir * ((a.precio || 0) - (b.precio || 0));
    if (estado.orden === "menor") lista = lista.slice().sort((a, b) => cmp(a, b, 1));
    if (estado.orden === "mayor") lista = lista.slice().sort((a, b) => cmp(a, b, -1));
    if (estado.orden === "az") lista = lista.slice().sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    return lista;
  }

  function tarjeta(p) {
    const ok = sePuedeComprar(p);
    const q = cantidadElegida.get(p.clave) || 1;
    const enCarrito = carrito.get(p.clave) || 0;
    const oferta = p.precio && p.precioAnterior && p.precioAnterior > p.precio;
    let tag = "";
    if (!p.disponible) tag = '<span class="tag grey">Sin stock</span>';
    else if (oferta) tag = `<span class="tag red">${Math.round((1 - p.precio / p.precioAnterior) * 100)}% OFF</span>`;
    const precio = p.precio
      ? `<p class="price">${oferta ? `<span class="old">${money(p.precioAnterior)}</span>` : ""}${money(p.precio)}</p>`
      : `<p class="price na">Consultar precio</p>`;
    const stock = !p.disponible ? '<span class="stock no">Sin stock</span>'
      : (!p.precio ? '<span class="stock na">Precio a confirmar</span>' : '<span class="stock ok">Disponible</span>');
    const compra = ok
      ? `<div class="buyrow">
           <div class="qty" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
             <button type="button" data-act="dec" aria-label="Restar uno" ${q <= 1 ? "disabled" : ""}>−</button>
             <output aria-live="polite">${q}</output>
             <button type="button" data-act="inc" aria-label="Sumar uno" ${q >= CANTIDAD_MAX ? "disabled" : ""}>+</button>
           </div>
           <button class="add" type="button" data-act="add">Agregar</button>
         </div>`
      : `<div class="buyrow"><button class="add" type="button" disabled>${!p.disponible ? "Sin stock" : "Consultá por WhatsApp"}</button></div>`;
    return `<article class="card${p.disponible ? "" : " is-off"}" data-k="${esc(p.clave)}">
      <a class="pic" href="${enlaceFicha(p)}" aria-label="Ver ${esc(p.nombre)}">${tag}${fotoHTML(p)}</a>
      ${p.categoria ? `<p class="cat-lbl">${esc(p.categoria)}</p>` : ""}
      <h3 class="name" title="${esc(p.nombre)}"><a href="${enlaceFicha(p)}">${esc(p.nombre)}</a></h3>
      ${precio}
      ${stock}
      ${compra}
      <p class="incart" ${enCarrito ? "" : "hidden"}>En tu carrito: ${enCarrito}</p>
    </article>`;
  }

  function dibujarCatalogo() {
    const grid = $("#catalogo-productos");
    const lista = filtrados();
    grid.setAttribute("aria-busy", "false");
    $("#catTitle").textContent = estado.categoria || (estado.texto ? "Resultados de búsqueda" : "Productos destacados");
    $("#count").textContent = lista.length + " producto" + (lista.length === 1 ? "" : "s");
    if (!PRODUCTOS.length) {
      grid.innerHTML = '<div class="state"><b>Todavía no hay productos publicados.</b>Volvé a visitarnos pronto o consultanos por WhatsApp o Instagram.</div>';
    } else if (!lista.length) {
      grid.innerHTML = `<div class="state"><b>No encontramos productos${estado.texto ? " para “" + esc(estado.texto) + "”" : ""}.</b>Probá con otra palabra o mirá todos los productos.</div>`;
    } else {
      grid.innerHTML = lista.map(tarjeta).join("");
    }
    pedirUbicarWa();
  }

  function categoriasReales() {
    const cuenta = new Map();
    for (const p of PRODUCTOS) if (p.categoria) cuenta.set(p.categoria, (cuenta.get(p.categoria) || 0) + 1);
    return Array.from(cuenta.entries()).sort((a, b) => a[0].localeCompare(b[0], "es"));
  }
  function dibujarCategorias() {
    const cats = categoriasReales();
    const fila = $("#cats");
    fila.hidden = cats.length === 0;
    fila.innerHTML =
      `<button class="cat" type="button" data-cat="" aria-pressed="${!estado.categoria}">${iconoCategoria("todos")}Ver todos</button>` +
      cats.map(([c]) => `<button class="cat" type="button" data-cat="${esc(c)}" aria-pressed="${estado.categoria === c}">${iconoCategoria(c)}${esc(c)}</button>`).join("");
    $("#catList").innerHTML =
      `<li><button type="button" data-cat="" aria-current="${!estado.categoria}">Ver todos los productos <span class="n">${PRODUCTOS.length}</span></button></li>` +
      cats.map(([c, n]) => `<li><button type="button" data-cat="${esc(c)}" aria-current="${estado.categoria === c}">${esc(c)} <span class="n">${n}</span></button></li>`).join("");
  }

  function dibujarEncabezado() {
    const { unidades, total } = totales();
    $("#cartCount").textContent = unidades;
    $("#cartTotal").textContent = money(total);
    $("#cartLabel").textContent = "Abrir carrito: " + unidades + " artículo" + (unidades === 1 ? "" : "s") + ", total " + money(total);
  }

  function mensajePedido() {
    const ls = lineas();
    const { total } = totales();
    const nombre = limpiar($("#fNombre").value, 60);
    const zona = limpiar($("#fZona").value, 80);
    const r = ["Hola ELDOSTORE, quiero hacer este pedido:", ""];
    for (const l of ls) r.push(`• ${l.q} × ${l.p.nombre} — ${money(l.sub)} (${money(l.p.precio)} c/u)`);
    r.push("", `Total estimado: ${money(total)} (sin envío)`);
    if (nombre) r.push(`Nombre: ${nombre}`);
    if (zona) r.push(`Zona o localidad: ${zona}`);
    r.push("", "Quedo a la espera de que me confirmen disponibilidad, precio final y envío.");
    return r.join("\n");
  }
  function actualizarMensaje() {
    if (!lineas().length) return;
    const txt = mensajePedido();
    $("#msgPreview").textContent = txt;
    const n = numeroWhatsApp();
    const btn = $("#btnSend");
    if (n) { btn.href = `https://wa.me/${n}?text=` + encodeURIComponent(txt); btn.removeAttribute("aria-disabled"); }
    else { btn.href = "#"; btn.setAttribute("aria-disabled", "true"); }
    $("#cfgWa").hidden = !!n;
  }

  function dibujarCarrito() {
    const ls = lineas();
    const { unidades, total } = totales();
    const vacio = ls.length === 0;
    $("#cartEmpty").hidden = !vacio;
    $("#cartFull").hidden = vacio;
    $("#cartFt").hidden = vacio;
    $("#cartHdCount").textContent = unidades ? "(" + unidades + ")" : "";
    if (vacio) return;
    $("#items").innerHTML = ls.map(({ p, q, sub }) => `
      <li class="it" data-k="${esc(p.clave)}">
        <div class="it-ph">${fotoHTML(p, true)}</div>
        <div style="min-width:0">
          <div class="it-top">
            <div style="min-width:0"><p class="it-nm">${esc(p.nombre)}</p><p class="it-unit">${money(p.precio)} c/u</p></div>
            <button class="rm" type="button" data-act="rm" aria-label="Quitar ${esc(p.nombre)}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>
            </button>
          </div>
          <div class="it-row">
            <div class="qty" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
              <button type="button" data-act="dec" aria-label="Restar uno">−</button>
              <output>${q}</output>
              <button type="button" data-act="inc" aria-label="Sumar uno" ${q >= CANTIDAD_MAX ? "disabled" : ""}>+</button>
            </div>
            <span class="it-sub">${money(sub)}</span>
          </div>
        </div>
      </li>`).join("");
    const meta = Number(CFG.envioGratisDesde) || 12000;
    const falta = Math.max(0, meta - total);
    $("#ship").classList.toggle("done", falta === 0);
    $("#shipTxt").innerHTML = falta === 0
      ? "<b>Tu pedido llega al envío gratis</b> dentro de Eldorado."
      : `Te faltan <b>${money(falta)}</b> para el envío gratis dentro de Eldorado.`;
    $("#shipBar").style.width = Math.min(100, Math.round(total / meta * 100)) + "%";
    $("#sumTotal").textContent = money(total);
    actualizarMensaje();
  }

  function actualizarTodo() { dibujarEncabezado(); dibujarCatalogo(); dibujarCarrito(); if (typeof refrescarFicha === "function") refrescarFicha(); }
  let refrescarFicha = null;
  let catalogoListo = false;

  /* ---------- Avisos ---------- */
  function aviso(html) { const n = $("#notice"); n.innerHTML = html; n.hidden = false; }
  let tToast;
  function toast(html) {
    const t = $("#toast"); t.innerHTML = html; t.classList.add("on");
    clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove("on"), 2200);
  }
  function mostrarError(err) {
    const grid = $("#catalogo-productos");
    grid.setAttribute("aria-busy", "false");
    const lib = err && err.tipo === "libreria";
    grid.innerHTML = `<div class="state"><b>No pudimos cargar los productos.</b>${lib
      ? "No se pudo conectar con el sistema del catálogo. Revisá tu conexión a internet."
      : "Hubo un problema al consultar el catálogo. Intentá nuevamente en unos minutos."}
      <br><button class="cta" type="button" id="btnRetry">Reintentar</button></div>`;
    $("#count").textContent = "";
    $("#cats").hidden = true;
    $("#btnRetry").addEventListener("click", () => { if (lib) location.reload(); else iniciar(); });
  }

  /* ---------- Paneles ---------- */
  let abierto = null, focoPrevio = null;
  function abrir(panel, boton) {
    if (abierto) cerrar(false);
    focoPrevio = boton || document.activeElement;
    abierto = panel;
    panel.classList.add("on"); panel.removeAttribute("inert"); panel.setAttribute("aria-hidden", "false");
    if (boton) boton.setAttribute("aria-expanded", "true");
    $("#scrim").classList.add("on");
    document.documentElement.classList.add("lock");
    document.body.classList.add("panel-open");
    $("#waAviso").hidden = true;
    const f = panel.querySelector("[data-close]");
    setTimeout(() => f && f.focus(), 60);
  }
  function cerrar(devolverFoco) {
    if (!abierto) return;
    abierto.classList.remove("on"); abierto.setAttribute("inert", ""); abierto.setAttribute("aria-hidden", "true");
    $("#btnMenu").setAttribute("aria-expanded", "false"); $("#btnCart").setAttribute("aria-expanded", "false");
    $("#scrim").classList.remove("on");
    if (!document.body.classList.contains("ficha-open")) document.documentElement.classList.remove("lock");
    document.body.classList.remove("panel-open");
    abierto = null;
    if (devolverFoco !== false && focoPrevio) focoPrevio.focus();
  }

  /* ---------- WhatsApp flotante ---------- */
  let tAviso;
  function configurarWhatsApp() {
    const a = $("#waFab"), n = numeroWhatsApp();
    if (n) {
      a.href = `https://wa.me/${n}?text=` + encodeURIComponent("Hola ELDOSTORE, quiero hacer una consulta.");
      $("#contactLinks").insertAdjacentHTML("afterbegin",
        `<a class="pill wa" href="https://wa.me/${n}" target="_blank" rel="noopener noreferrer">${WA_SVG}WhatsApp</a>`);
    } else {
      a.removeAttribute("target");
      a.setAttribute("aria-label", "WhatsApp de la tienda sin configurar");
      a.addEventListener("click", e => {
        e.preventDefault();
        const av = $("#waAviso");
        av.innerHTML = "<b>Falta configurar el número de WhatsApp.</b><br>Escribilo en <b>whatsapp</b>, dentro de ELDOSTORE_CONFIG, al final de index.html.";
        av.hidden = false;
        clearTimeout(tAviso); tAviso = setTimeout(() => { av.hidden = true; }, 6000);
      });
    }
  }
  /* El botón queda fijo en la esquina y se oculta solo mientras quedaría
     encima del nombre, precio, disponibilidad o botones de un producto. */
  const PROTEGIDO = ".card .name, .card .price, .card .stock, .card .buyrow, .card .incart, .cta, .sort, .cat, .rate, .free-ship, .pill, .site-footer a, .state";
  let pendiente = false;
  function ubicarWa() {
    pendiente = false;
    const z = $("#waZone").getBoundingClientRect();
    const cx = z.left + z.width / 2, cy = z.top + z.height / 2, r = z.width / 2 + 4;
    const puntos = [[cx, cy]];
    for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; puntos.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    let tapa = false;
    for (const [x, y] of puntos) {
      for (const el of document.elementsFromPoint(x, y)) {
        if (el.closest("#waFab, #waZone, #waAviso, #toast")) continue;
        if (el.closest(PROTEGIDO)) tapa = true;
        break;
      }
      if (tapa) break;
    }
    $("#waFab").classList.toggle("away", tapa);
    if (tapa) $("#waAviso").hidden = true;
  }
  function pedirUbicarWa() { if (!pendiente) { pendiente = true; requestAnimationFrame(ubicarWa); } }

  /* ---------- Eventos ---------- */
  const grid = $("#catalogo-productos");
  grid.addEventListener("click", e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const card = b.closest(".card"); const k = card && card.dataset.k; const p = porClave.get(k);
    if (!sePuedeComprar(p)) return;
    const q = cantidadElegida.get(k) || 1;
    if (b.dataset.act === "inc") cantidadElegida.set(k, Math.min(CANTIDAD_MAX, q + 1));
    if (b.dataset.act === "dec") cantidadElegida.set(k, Math.max(1, q - 1));
    if (b.dataset.act === "add") {
      const antes = carrito.get(k) || 0;
      const nuevo = Math.min(CANTIDAD_MAX, antes + q);
      cantidadElegida.set(k, 1);
      if (nuevo === antes) { toast("Llegaste al máximo de " + CANTIDAD_MAX + " unidades de este producto."); return; }
      setCantidad(k, nuevo);
      toast("<b>Agregado:</b> " + (nuevo - antes) + " × " + esc(p.nombre));
    } else dibujarCatalogo();
    const again = grid.querySelector(`.card[data-k="${CSS.escape(k)}"] [data-act="${b.dataset.act}"]`);
    if (again && !again.disabled) again.focus();
  });
  // Foto que no carga: se reemplaza por un fondo neutro
  grid.addEventListener("error", e => {
    if (e.target.tagName !== "IMG") return;
    const s = document.createElement("span"); s.className = "ph"; s.textContent = "ELDOSTORE"; e.target.replaceWith(s);
  }, true);

  /* ---------- Ficha individual del producto ----------
     Se abre al tocar la foto o el nombre. Usa la dirección #producto/…,
     así el botón Atrás del celular o del navegador vuelve al catálogo,
     con los filtros, la búsqueda, el carrito y la posición intactos.
     Todo sale de los datos reales de catalogo_tienda(); no consulta ni
     modifica la base de datos. */
  const ficha = document.createElement("section");
  ficha.className = "ficha"; ficha.id = "ficha"; ficha.hidden = true;
  ficha.setAttribute("aria-label", "Ficha del producto");
  document.body.appendChild(ficha);
  let fichaClave = null, fichaQty = 1, fichaDesdeTienda = false, focoFicha = null;
  const tituloOriginal = document.title;

  function relacionados(p) {
    const otros = PRODUCTOS.filter(x => x.clave !== p.clave && x.disponible);
    // Primero la misma categoría; después precios parecidos. En cada grupo, primero los que tienen foto.
    const dist = x => Math.abs((x.precio || 0) - (p.precio || 0));
    const orden = (a, b) => (!!b.foto - !!a.foto) || dist(a) - dist(b);
    const misma = p.categoria ? otros.filter(x => x.categoria === p.categoria).sort(orden) : [];
    const cerca = otros.filter(x => !misma.includes(x)).sort(orden);
    return misma.concat(cerca).slice(0, 8);
  }

  function dibujarFicha() {
    const p = porClave.get(fichaClave);
    const { unidades, total } = totales();
    const barra = `<div class="f-bar">
        <button type="button" class="f-back" data-f="volver" aria-label="Volver al catálogo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg><span>Volver</span></button>
        <span class="f-brand">ELD<span>⚡</span>STORE</span>
        <button type="button" class="f-cart" data-f="carrito" aria-label="Abrir carrito: ${unidades} artículos, ${money(total)}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L20.5 8H6.1"/><circle cx="9.5" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/></svg>
          <span class="cart-count">${unidades}</span><span>${money(total)}</span></button>
      </div>`;
    if (!p) {
      ficha.innerHTML = barra + `<div class="f-wrap"><div class="state"><b>Este producto ya no está publicado.</b>Puede que se haya agotado o que haya cambiado.<br><button class="cta" type="button" data-f="volver">Ver el catálogo</button></div></div>`;
      document.title = tituloOriginal;
      return;
    }
    const ok = sePuedeComprar(p);
    const enCarrito = carrito.get(p.clave) || 0;
    const oferta = p.precio && p.precioAnterior && p.precioAnterior > p.precio;
    const precio = p.precio
      ? `<p class="f-price">${oferta ? `<span class="old">${money(p.precioAnterior)}</span>` : ""}${money(p.precio)}</p>`
      : `<p class="f-price na">Consultar precio</p>`;
    const stock = !p.disponible ? '<span class="stock no">Sin stock</span>'
      : (!p.precio ? '<span class="stock na">Precio a confirmar</span>' : '<span class="stock ok">Disponible</span>');
    const n = numeroWhatsApp();
    const consulta = n
      ? `<a class="f-wa" href="https://wa.me/${n}?text=${encodeURIComponent(mensajeProducto(p, "Hola, me interesa este producto de ELDOSTORE:", true))}" target="_blank" rel="noopener noreferrer">${WA_SVG}Consultar por WhatsApp</a>` : "";
    const link = enlaceCompartir(p);
    const compartir = `<section class="f-share" aria-labelledby="fShareT">
        <h2 id="fShareT">Compartir este producto</h2>
        <div class="f-share-row">
          <a class="sh sh-wa" href="https://wa.me/?text=${encodeURIComponent(mensajeProducto(p, "Mirá este producto de ELDOSTORE:", true))}" target="_blank" rel="noopener noreferrer">${WA_SVG}<span>WhatsApp</span></a>
          <a class="sh sh-fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}" target="_blank" rel="noopener noreferrer">${ICONO_FB}<span>Facebook</span></a>
          <button type="button" class="sh sh-ig" data-f="copiar">${ICONO_IG}<span>Instagram</span></button>
        </div>
        <p class="f-share-help">Para Instagram, tocá el botón: se copia el enlace del producto y lo pegás en tu historia, mensaje o publicación.</p>
        <input class="f-link" type="text" readonly value="${esc(link)}" aria-label="Enlace del producto">
        ${esSitioOficial ? "" : `<p class="f-share-test">Versión de prueba: estos enlaces abren esta versión de prueba, no la tienda oficial.</p>`}
      </section>`;
    const compra = ok
      ? `<div class="f-buy">
           <div class="qty" role="group" aria-label="Cantidad">
             <button type="button" data-f="dec" aria-label="Restar uno" ${fichaQty <= 1 ? "disabled" : ""}>−</button>
             <output aria-live="polite">${fichaQty}</output>
             <button type="button" data-f="inc" aria-label="Sumar uno" ${fichaQty >= CANTIDAD_MAX ? "disabled" : ""}>+</button>
           </div>
           <button type="button" class="add f-add" data-f="add">Agregar al carrito</button>
         </div>`
      : `<div class="f-buy"><button type="button" class="add f-add" disabled>${!p.disponible ? "Sin stock" : "Precio a confirmar"}</button></div>`;
    const rel = relacionados(p);
    const relHTML = rel.length ? `<section class="f-rel" aria-labelledby="fRelT">
        <h2 id="fRelT">Esta opción también te podría servir</h2>
        <div class="f-rel-list">${rel.map(r => `<a class="f-mini" href="${enlaceFicha(r)}">
            <span class="f-mini-pic">${fotoHTML(r)}</span>
            <span class="f-mini-name">${esc(r.nombre)}</span>
            <span class="f-mini-price${r.precio ? "" : " na"}">${r.precio ? money(r.precio) : "Consultar precio"}</span></a>`).join("")}</div>
      </section>` : "";
    ficha.innerHTML = barra + `<div class="f-wrap">
        <div class="f-main">
          ${galeriaHTML(p, !p.disponible ? '<span class="tag grey">Sin stock</span>' : (oferta ? `<span class="tag red">${Math.round((1 - p.precio / p.precioAnterior) * 100)}% OFF</span>` : ""))}
          <div class="f-info">
            ${p.categoria ? `<p class="cat-lbl">${esc(p.categoria)}</p>` : ""}
            <h1 class="f-name" id="fName" tabindex="-1">${esc(p.nombre)}</h1>
            ${p.codigo ? `<p class="f-code">Código: <span>${esc(p.codigo)}</span></p>` : ""}
            ${precio}
            ${stock}
            ${compra}
            <p class="incart" ${enCarrito ? "" : "hidden"}>En tu carrito: ${enCarrito}</p>
            <ul class="f-notes">
              <li>Envío gratis desde ${money(Number(CFG.envioGratisDesde) || 12000)} dentro de Eldorado.</li>
              <li>Coordinamos disponibilidad, pago y entrega por WhatsApp.</li>
            </ul>
            ${consulta}
            ${compartir}
          </div>
        </div>
        ${relHTML}
      </div>`;
    document.title = p.nombre + " | ELDOSTORE";
    ubicarFoto(false);
  }

  /* ---------- Galería de la ficha ---------- */
  let fotoActual = 0;
  const ICONO_ZOOM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2M11 8v6M8 11h6"/></svg>';
  const FLECHA = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  function galeriaHTML(p, tag) {
    const fotos = p.fotos;
    const varias = fotos.length > 1;
    if (fotoActual >= fotos.length) fotoActual = 0;
    if (!fotos.length) return `<div class="f-gal"><div class="f-photo${p.disponible ? "" : " is-off"}">${tag}<span class="ph">ELDOSTORE</span></div></div>`;
    return `<div class="f-gal">
      <div class="f-photo${p.disponible ? "" : " is-off"}">${tag}
        <div class="f-track" tabindex="0" aria-label="Fotos de ${esc(p.nombre)}${varias ? ": deslizá para ver más" : ""}">
          ${fotos.map((u, i) => `<div class="f-slide"><img src="${esc(u)}" alt="${esc(p.nombre)}${varias ? ", foto " + (i + 1) + " de " + fotos.length : ""}" decoding="async" ${i ? 'loading="lazy"' : ""} data-g="ampliar" data-i="${i}"></div>`).join("")}
        </div>
        ${varias ? `<button type="button" class="f-nav prev" data-g="prev" aria-label="Foto anterior">${FLECHA("M15 5l-7 7 7 7")}</button>
        <button type="button" class="f-nav next" data-g="next" aria-label="Foto siguiente">${FLECHA("M9 5l7 7-7 7")}</button>
        <span class="f-count" aria-hidden="true"><b>${fotoActual + 1}</b> / ${fotos.length}</span>` : ""}
        <button type="button" class="f-zoom" data-g="ampliar" aria-label="Ampliar foto">${ICONO_ZOOM}</button>
      </div>
      ${varias ? `<div class="f-thumbs" aria-label="Elegir foto">${fotos.map((u, i) => `<button type="button" class="f-th" data-g="ver" data-i="${i}" aria-label="Ver foto ${i + 1}" aria-current="${i === fotoActual}"><img src="${esc(u)}" alt="" loading="lazy" decoding="async"></button>`).join("")}</div>` : ""}
    </div>`;
  }
  const pista = () => ficha.querySelector(".f-track");
  function ubicarFoto(suave) {
    const t = pista(); if (!t) return;
    const reducir = matchMedia("(prefers-reduced-motion: reduce)").matches;
    t.scrollTo({ left: fotoActual * t.clientWidth, behavior: suave && !reducir ? "smooth" : "auto" });
    marcarFoto();
  }
  function marcarFoto() {
    const c = ficha.querySelector(".f-count b"); if (c) c.textContent = fotoActual + 1;
    ficha.querySelectorAll(".f-th").forEach((b, i) => {
      b.setAttribute("aria-current", String(i === fotoActual));
      if (i === fotoActual && b.parentElement.scrollWidth > b.parentElement.clientWidth)
        b.parentElement.scrollTo({ left: b.offsetLeft - b.parentElement.clientWidth / 2 + b.clientWidth / 2, behavior: "auto" });
    });
  }
  // Al deslizar con el dedo se actualizan el contador y las miniaturas
  ficha.addEventListener("scroll", e => {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains("f-track")) return;
    const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    if (i !== fotoActual) { fotoActual = i; marcarFoto(); }
  }, true);
  window.addEventListener("resize", () => { if (!ficha.hidden) ubicarFoto(false); });

  /* Vista ampliada: pantalla completa, deslizable; tocar la foto la agranda
     al doble y se recorre arrastrando. Se cierra con ×, Escape o Atrás. */
  const visor = document.createElement("div");
  visor.className = "lbx"; visor.hidden = true;
  visor.setAttribute("role", "dialog"); visor.setAttribute("aria-modal", "true"); visor.setAttribute("aria-label", "Foto ampliada");
  document.body.appendChild(visor);
  let visorFoco = null;
  function abrirVisor() {
    const p = porClave.get(fichaClave); if (!p || !p.fotos.length) return;
    const varias = p.fotos.length > 1;
    visor.innerHTML = `<div class="lbx-track">${p.fotos.map((u, i) => `<div class="lbx-slide"><div class="lbx-zoom"><img src="${esc(u)}" alt="${esc(p.nombre)}${varias ? ", foto " + (i + 1) + " de " + p.fotos.length : ""}" decoding="async"></div></div>`).join("")}</div>
      <button type="button" class="lbx-close" data-v="cerrar" aria-label="Cerrar foto ampliada">×</button>
      ${varias ? `<button type="button" class="lbx-nav prev" data-v="prev" aria-label="Foto anterior">${FLECHA("M15 5l-7 7 7 7")}</button>
      <button type="button" class="lbx-nav next" data-v="next" aria-label="Foto siguiente">${FLECHA("M9 5l7 7-7 7")}</button>
      <span class="lbx-count"><b>${fotoActual + 1}</b> / ${p.fotos.length}</span>` : ""}
      <p class="lbx-help">Tocá la foto para acercar</p>`;
    visorFoco = document.activeElement;
    visor.hidden = false;
    document.body.classList.add("lbx-open");
    const t = visor.querySelector(".lbx-track");
    t.scrollLeft = fotoActual * t.clientWidth;
    history.pushState({ eldoVisor: true }, "", location.href);
    visor.querySelector(".lbx-close").focus({ preventScroll: true });
  }
  function cerrarVisor(desdeHistorial) {
    if (visor.hidden) return;
    visor.hidden = true; visor.innerHTML = "";
    document.body.classList.remove("lbx-open");
    ubicarFoto(false);
    if (!desdeHistorial && history.state && history.state.eldoVisor) history.back();
    if (visorFoco && document.body.contains(visorFoco)) visorFoco.focus({ preventScroll: true });
  }
  window.addEventListener("popstate", () => { if (!visor.hidden) cerrarVisor(true); });
  function moverVisor(d) {
    const t = visor.querySelector(".lbx-track"); if (!t) return;
    const n = t.children.length;
    const i = Math.max(0, Math.min(n - 1, Math.round(t.scrollLeft / t.clientWidth) + d));
    visor.querySelectorAll(".lbx-zoom.on").forEach(z => z.classList.remove("on"));
    t.classList.remove("zoomed");
    t.scrollTo({ left: i * t.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }
  visor.addEventListener("scroll", e => {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains("lbx-track")) return;
    const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    if (i !== fotoActual) { fotoActual = i; const c = visor.querySelector(".lbx-count b"); if (c) c.textContent = i + 1; }
  }, true);
  visor.addEventListener("click", e => {
    const b = e.target.closest("[data-v]");
    if (b) {
      if (b.dataset.v === "cerrar") cerrarVisor(false);
      if (b.dataset.v === "prev") moverVisor(-1);
      if (b.dataset.v === "next") moverVisor(1);
      return;
    }
    const img = e.target.closest(".lbx-zoom img");
    if (!img) return;
    const z = img.parentElement, t = visor.querySelector(".lbx-track");
    const r = img.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
    const on = !z.classList.contains("on");
    z.classList.toggle("on", on);
    t.classList.toggle("zoomed", on);
    visor.querySelector(".lbx-help").textContent = on ? "Arrastrá para recorrer · tocá para alejar" : "Tocá la foto para acercar";
    if (on) requestAnimationFrame(() => {
      z.scrollLeft = fx * z.scrollWidth - z.clientWidth / 2;
      z.scrollTop = fy * z.scrollHeight - z.clientHeight / 2;
    });
  });
  visor.addEventListener("keydown", e => {
    if (e.key === "ArrowLeft") moverVisor(-1);
    if (e.key === "ArrowRight") moverVisor(1);
    if (e.key === "Tab") { // mantener el foco dentro del visor
      const f = Array.from(visor.querySelectorAll("button")); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
    }
  });

  async function copiarEnlace() {
    const inp = ficha.querySelector(".f-link"); if (!inp) return;
    try {
      await navigator.clipboard.writeText(inp.value);
      toast("<b>Enlace copiado.</b> Pegalo en Instagram: historia, mensaje o publicación.");
    } catch (e) {
      inp.classList.add("on"); inp.focus(); inp.select();
      toast("Seleccioné el enlace: copialo con el menú de tu teléfono.");
    }
  }

  function mostrarFicha(clave) {
    const cambio = clave !== fichaClave;
    if (cambio) { fichaQty = 1; fotoActual = 0; }
    if (ficha.hidden) {
      const a = document.activeElement;
      focoFicha = a && a !== document.body ? a : null;
    }
    fichaClave = clave;
    dibujarFicha();
    ficha.hidden = false;
    document.body.classList.add("ficha-open");
    document.documentElement.classList.add("lock");
    if (cambio) ficha.scrollTop = 0;
    const h = ficha.querySelector("#fName") || ficha.querySelector(".f-back");
    if (h) h.focus({ preventScroll: true });
  }
  function ocultarFicha() {
    if (ficha.hidden) return;
    cerrarVisor(true);
    ficha.hidden = true; ficha.innerHTML = ""; fichaClave = null;
    document.body.classList.remove("ficha-open");
    if (!abierto) document.documentElement.classList.remove("lock");
    document.title = tituloOriginal;
    if (focoFicha && document.body.contains(focoFicha)) focoFicha.focus({ preventScroll: true });
    focoFicha = null;
    pedirUbicarWa();
  }
  function claveDesdeDireccion() {
    const h = location.hash;
    if (!h.startsWith(PREFIJO_FICHA)) return null;
    try { return decodeURIComponent(h.slice(PREFIJO_FICHA.length)); } catch (e) { return ""; }
  }
  // Enlace compartido (?p=código o ?p=id): se convierte en la ficha #producto/… sin recargar.
  function resolverEnlaceCompartido() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (e) { return; }
    const v = params.get("p");
    if (v === null) return;
    params.delete("p");
    const p = PRODUCTOS.find(x => x.codigoUnico && x.codigo === v) || PRODUCTOS.find(x => x.id && x.id === v);
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + PREFIJO_FICHA + encodeURIComponent(p ? p.clave : "no-encontrado:" + v));
  }
  function enrutar() {
    if (!catalogoListo) return;
    const k = claveDesdeDireccion();
    if (k === null) ocultarFicha();
    else mostrarFicha(k);
  }
  function volverAlCatalogo() {
    if (fichaDesdeTienda && history.length > 1) history.back();
    else { history.replaceState(null, "", location.pathname + location.search); ocultarFicha(); }
  }
  refrescarFicha = () => { if (!ficha.hidden) dibujarFicha(); };
  window.addEventListener("hashchange", () => { if (claveDesdeDireccion() !== null) fichaDesdeTienda = true; enrutar(); });
  document.addEventListener("click", e => {
    const a = e.target.closest('a[href^="#producto/"]');
    if (a) fichaDesdeTienda = true;
  }, true);

  ficha.addEventListener("click", e => {
    const g = e.target.closest("[data-g]");
    if (g) {
      const p = porClave.get(fichaClave); const n = p ? p.fotos.length : 0;
      if (g.dataset.g === "ver") { fotoActual = Number(g.dataset.i) || 0; ubicarFoto(true); }
      if (g.dataset.g === "prev") { fotoActual = (fotoActual - 1 + n) % n; ubicarFoto(true); }
      if (g.dataset.g === "next") { fotoActual = (fotoActual + 1) % n; ubicarFoto(true); }
      if (g.dataset.g === "ampliar") abrirVisor();
      return;
    }
    const b = e.target.closest("[data-f]"); if (!b) return;
    if (b.dataset.f === "copiar") { copiarEnlace(); return; }
    const p = porClave.get(fichaClave);
    switch (b.dataset.f) {
      case "volver": volverAlCatalogo(); return;
      case "carrito": $("#sendStatus").hidden = true; abrir($("#cart"), b); return;
      case "inc": fichaQty = Math.min(CANTIDAD_MAX, fichaQty + 1); break;
      case "dec": fichaQty = Math.max(1, fichaQty - 1); break;
      case "add": {
        if (!sePuedeComprar(p)) return;
        const antes = carrito.get(p.clave) || 0;
        const nuevo = Math.min(CANTIDAD_MAX, antes + fichaQty);
        if (nuevo === antes) { toast("Llegaste al máximo de " + CANTIDAD_MAX + " unidades de este producto."); return; }
        fichaQty = 1;
        setCantidad(p.clave, nuevo);
        toast("<b>Agregado:</b> " + (nuevo - antes) + " × " + esc(p.nombre));
        break;
      }
    }
    dibujarFicha();
    const again = ficha.querySelector(`[data-f="${b.dataset.f}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  });
  ficha.addEventListener("error", e => {
    if (e.target.tagName !== "IMG") return;
    const s = document.createElement("span"); s.className = "ph"; s.textContent = e.target.closest(".f-mini") ? "" : "ELDOSTORE"; e.target.replaceWith(s);
  }, true);

  visor.addEventListener("error", e => {
    if (e.target.tagName !== "IMG") return;
    const s = document.createElement("span"); s.className = "lbx-err"; s.textContent = "No se pudo cargar la foto"; e.target.replaceWith(s);
  }, true);

  $("#items").addEventListener("error", e => {
    if (e.target.tagName === "IMG") e.target.remove();
  }, true);

  $("#items").addEventListener("click", e => {
    const b = e.target.closest("button[data-act]"); if (!b) return;
    const k = b.closest(".it").dataset.k; const q = carrito.get(k) || 0;
    if (b.dataset.act === "inc") setCantidad(k, q + 1);
    if (b.dataset.act === "dec") setCantidad(k, q - 1);
    if (b.dataset.act === "rm") { const p = porClave.get(k); setCantidad(k, 0); toast("Quitaste " + esc(p ? p.nombre : "el producto")); }
    if (!carrito.size) { const c = $("#cartEmpty [data-close]"); if (c) c.focus(); }
  });

  function elegirCategoria(c) {
    estado.categoria = c || null;
    dibujarCategorias(); dibujarCatalogo();
  }
  $("#cats").addEventListener("click", e => {
    const b = e.target.closest("button[data-cat]"); if (!b) return;
    elegirCategoria(b.dataset.cat);
    b.scrollIntoView && $(`#cats [data-cat="${CSS.escape(b.dataset.cat)}"]`).scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  $("#catList").addEventListener("click", e => {
    const b = e.target.closest("button[data-cat]"); if (!b) return;
    elegirCategoria(b.dataset.cat); cerrar(false);
    $("#productos").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  $$("[data-q]").forEach(inp => inp.addEventListener("input", e => {
    estado.texto = e.target.value.slice(0, 60);
    $$("[data-q]").forEach(o => { if (o !== e.target) o.value = e.target.value; });
    dibujarCatalogo();
  }));
  $("#orden").addEventListener("change", e => { estado.orden = e.target.value; dibujarCatalogo(); });

  $("#btnMenu").addEventListener("click", e => abrir($("#menu"), e.currentTarget));
  $("#btnCart").addEventListener("click", e => { $("#sendStatus").hidden = true; abrir($("#cart"), e.currentTarget); });
  $("#scrim").addEventListener("click", () => cerrar());
  document.addEventListener("click", e => { const c = e.target.closest("[data-close]"); if (c) cerrar(!c.closest("a")); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!elegirWa.hidden) { cerrarElegirWa(true); return; }
    if (!visor.hidden) { cerrarVisor(false); return; }
    if (abierto) { cerrar(); return; }
    if (!ficha.hidden) volverAlCatalogo();
  });
  document.addEventListener("click", e => { if (!e.target.closest("#waFab, #waAviso")) $("#waAviso").hidden = true; });

  $("#orderForm").addEventListener("submit", e => e.preventDefault());
  $("#orderForm").addEventListener("input", actualizarMensaje);
  /* ---------- Elegir a qué WhatsApp enviar el pedido ----------
     Si hay dos números, el botón abre esta ventana. Cada opción es un enlace
     directo a WhatsApp con el pedido completo (mensajePedido()); el carrito
     no se modifica. Con un solo número, el botón funciona como siempre. */
  const elegirWa = document.createElement("div");
  elegirWa.className = "wa-pick"; elegirWa.hidden = true;
  document.body.appendChild(elegirWa);
  let focoElegir = null;
  function abrirElegirWa() {
    const nums = numerosPedido();
    const txt = encodeURIComponent(mensajePedido());
    const { unidades, total } = totales();
    elegirWa.innerHTML = `<div class="wa-pick-box" role="dialog" aria-modal="true" aria-labelledby="waPickT" aria-describedby="waPickD">
        <h2 id="waPickT">¿A qué WhatsApp enviás tu pedido?</h2>
        <p id="waPickD">Se envía el pedido completo: ${unidades} artículo${unidades === 1 ? "" : "s"}, total ${money(total)} (sin envío).</p>
        <div class="wa-pick-ops">${nums.map((n, i) => `
          <a class="wa-op" href="https://wa.me/${n}?text=${txt}" target="_blank" rel="noopener noreferrer" data-wa="${i + 1}">
            ${WA_SVG}<span><b>WhatsApp ${i + 1}</b><small>${numeroVisible(n)}</small></span></a>`).join("")}
        </div>
        <button type="button" class="ghost wa-pick-x" data-wa-cerrar>Cancelar</button>
      </div>`;
    focoElegir = document.activeElement;
    elegirWa.hidden = false;
    document.body.classList.add("wa-pick-open");
    elegirWa.querySelector(".wa-op").focus();
  }
  function cerrarElegirWa(devolverFoco) {
    if (elegirWa.hidden) return;
    elegirWa.hidden = true; elegirWa.innerHTML = "";
    document.body.classList.remove("wa-pick-open");
    if (devolverFoco && focoElegir && document.body.contains(focoElegir)) focoElegir.focus();
  }
  elegirWa.addEventListener("click", e => {
    const op = e.target.closest(".wa-op");
    if (op) {
      // El enlace abre WhatsApp con el pedido; acá solo se cierra la ventana y se avisa.
      const s = $("#sendStatus");
      s.textContent = `Se abrió el WhatsApp ${op.dataset.wa} con tu pedido. Para que lo revisemos, enviá el mensaje desde WhatsApp. El pedido queda pendiente hasta que ELDOSTORE lo confirme.`;
      s.hidden = false;
      setTimeout(() => cerrarElegirWa(true), 0);
      return;
    }
    if (e.target === elegirWa || e.target.closest("[data-wa-cerrar]")) cerrarElegirWa(true);
  });
  elegirWa.addEventListener("keydown", e => {
    if (e.key !== "Tab") return; // el foco queda dentro de la ventana
    const f = Array.from(elegirWa.querySelectorAll("a, button"));
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });

  $("#btnSend").addEventListener("click", e => {
    if (!numeroWhatsApp()) { e.preventDefault(); return; }
    if (numerosPedido().length > 1) { e.preventDefault(); actualizarMensaje(); abrirElegirWa(); return; }
    actualizarMensaje();
    const s = $("#sendStatus");
    s.textContent = "Se abrió WhatsApp con tu pedido. Para que lo revisemos, enviá el mensaje desde WhatsApp. El pedido queda pendiente hasta que ELDOSTORE lo confirme.";
    s.hidden = false;
  });
  $("#btnCopy").addEventListener("click", async () => {
    const txt = mensajePedido();
    try { await navigator.clipboard.writeText(txt); toast("Mensaje copiado."); }
    catch (err) {
      $(".preview").open = true;
      const r = document.createRange(); r.selectNodeContents($("#msgPreview"));
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast("Seleccioné el mensaje: copialo con el menú de tu teléfono.");
    }
  });
  let tVaciar;
  $("#btnClear").addEventListener("click", e => {
    const b = e.currentTarget;
    if (!b.classList.contains("warn")) {
      b.classList.add("warn"); b.textContent = "Tocá otra vez para vaciar";
      clearTimeout(tVaciar); tVaciar = setTimeout(() => { b.classList.remove("warn"); b.textContent = "Vaciar carrito"; }, 3000);
      return;
    }
    clearTimeout(tVaciar); b.classList.remove("warn"); b.textContent = "Vaciar carrito";
    carrito.clear(); guardarCarrito(); actualizarTodo(); toast("Vaciaste el carrito.");
  });

  window.addEventListener("scroll", pedirUbicarWa, { passive: true });
  window.addEventListener("resize", pedirUbicarWa);

  // Foto del banner: si no carga, queda el fondo oscuro con brillo dorado
  const heroImg = $("#heroImg");
  if (heroImg) {
    heroImg.addEventListener("error", () => $(".hero").classList.add("sin-foto"));
    if (heroImg.complete && heroImg.naturalWidth === 0) $(".hero").classList.add("sin-foto");
  }

  /* ---------- Inicio ---------- */
  async function iniciar() {
    const g = $("#catalogo-productos");
    g.setAttribute("aria-busy", "true");
    g.innerHTML = '<div class="skel"></div><div class="skel"></div><div class="skel"></div><div class="skel"></div>';
    try {
      const [filas, extras] = await Promise.all([cargarCatalogo(), cargarFotosExtra()]);
      PRODUCTOS = prepararCatalogo(filas);
      aplicarFotosExtra(PRODUCTOS, extras);
      porClave = new Map(PRODUCTOS.map(p => [p.clave, p]));
      carrito = leerCarrito();
      conciliarCarrito();
      dibujarCategorias();
      actualizarTodo();
      catalogoListo = true;
      resolverEnlaceCompartido();
      enrutar();
    } catch (err) {
      console.error("Error al cargar el catálogo:", err);
      mostrarError(err);
    }
    pedirUbicarWa();
  }

  configurarWhatsApp();
  iniciar();
})();
