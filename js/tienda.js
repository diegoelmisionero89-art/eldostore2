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
   ========================================================================== */
(function () {
  "use strict";

  const CFG = Object.assign({
    supabaseUrl: "",
    supabaseKey: "",
    whatsapp: "",
    instagram: "",
    envioGratisDesde: 12000
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
  const numeroWhatsApp = () => { const n = String(CFG.whatsapp || "").replace(/\D/g, ""); return n.length >= 10 && n.length <= 15 ? n : ""; };
  const WA_SVG = $("#waFab svg") ? $("#waFab svg").outerHTML : "";

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
        foto: fotoValida(r && r.foto)
      };
    });

    // Diagnóstico para el dueño (consola del navegador): qué campos devuelve la función.
    try {
      console.info("[ELDOSTORE] catalogo_tienda(): " + lista.length + " productos. Campos: " +
        (lista[0] ? Object.keys(lista[0]).join(", ") : "(sin filas)") +
        ". Identificador del carrito: " + (campoId || "nombre del producto"));
    } catch (e) { /* sin consola */ }
    return productos;
  }

  async function cargarCatalogo() {
    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      const err = new Error("No se pudo cargar la librería de Supabase");
      err.tipo = "libreria"; throw err;
    }
    const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
    const { data, error } = await sb.rpc("catalogo_tienda");
    if (error) { const err = new Error(error.message || "Error de catalogo_tienda"); err.tipo = "rpc"; throw err; }
    return data || [];
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
      ? `<a class="f-wa" href="https://wa.me/${n}?text=${encodeURIComponent("Hola ELDOSTORE, quiero consultar por: " + p.nombre + (p.precio ? " (" + money(p.precio) + ")" : ""))}" target="_blank" rel="noopener noreferrer">${WA_SVG}Consultar por WhatsApp</a>` : "";
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
          <div class="f-photo${p.disponible ? "" : " is-off"}">${!p.disponible ? '<span class="tag grey">Sin stock</span>' : (oferta ? `<span class="tag red">${Math.round((1 - p.precio / p.precioAnterior) * 100)}% OFF</span>` : "")}${p.foto ? `<img src="${esc(p.foto)}" alt="${esc(p.nombre)}" decoding="async">` : '<span class="ph">ELDOSTORE</span>'}</div>
          <div class="f-info">
            ${p.categoria ? `<p class="cat-lbl">${esc(p.categoria)}</p>` : ""}
            <h1 class="f-name" id="fName" tabindex="-1">${esc(p.nombre)}</h1>
            ${precio}
            ${stock}
            ${compra}
            <p class="incart" ${enCarrito ? "" : "hidden"}>En tu carrito: ${enCarrito}</p>
            <ul class="f-notes">
              <li>Envío gratis desde ${money(Number(CFG.envioGratisDesde) || 12000)} dentro de Eldorado.</li>
              <li>Coordinamos disponibilidad, pago y entrega por WhatsApp.</li>
            </ul>
            ${consulta}
          </div>
        </div>
        ${relHTML}
      </div>`;
    document.title = p.nombre + " | ELDOSTORE";
  }

  function mostrarFicha(clave) {
    const cambio = clave !== fichaClave;
    if (cambio) fichaQty = 1;
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
    const b = e.target.closest("[data-f]"); if (!b) return;
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
    if (abierto) { cerrar(); return; }
    if (!ficha.hidden) volverAlCatalogo();
  });
  document.addEventListener("click", e => { if (!e.target.closest("#waFab, #waAviso")) $("#waAviso").hidden = true; });

  $("#orderForm").addEventListener("submit", e => e.preventDefault());
  $("#orderForm").addEventListener("input", actualizarMensaje);
  $("#btnSend").addEventListener("click", e => {
    if (!numeroWhatsApp()) { e.preventDefault(); return; }
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
      const filas = await cargarCatalogo();
      PRODUCTOS = prepararCatalogo(filas);
      porClave = new Map(PRODUCTOS.map(p => [p.clave, p]));
      carrito = leerCarrito();
      conciliarCarrito();
      dibujarCategorias();
      actualizarTodo();
      catalogoListo = true;
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
