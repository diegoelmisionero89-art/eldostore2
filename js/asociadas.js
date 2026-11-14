/* ==========================================================================
   ELDOSTORE — Tiendas asociadas en la tienda pública (js/asociadas.js)
   Vendedores asociados V1 · migración 006

   - Lee todo con la función pública tiendas_asociadas() (solo lectura).
     Si la función no existe todavía, no se muestra nada y la tienda queda
     exactamente como antes.
   - Los productos de vendedores NO se mezclan con los de ELDOSTORE: no están
     en catalogo_tienda() («Todos los productos»), ni en el buscador, ni en el
     carrito de ELDOSTORE. Cada tienda tiene su propio pedido, que se envía al
     WhatsApp de ESE vendedor (pago y entrega los coordina él).
   - Direcciones (el botón Atrás funciona):
       #tiendas                     todas las tiendas asociadas
       #tiendas/<tienda>            catálogo de una tienda
       #tiendas/<tienda>/<código>   ficha de un producto
   - El pedido de cada tienda se guarda solo en el navegador del cliente.
   ========================================================================== */
(function () {
  "use strict";
  const CFG = window.ELDOSTORE_CONFIG || {};
  const CLAVE = "eldostore_asociadas_v1";
  const MAX = 99;

  const $ = s => document.querySelector(s);
  const fmt = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
  const money = n => fmt.format(n).replace(/ /g, " ");
  const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const limpiar = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  const norm = v => String(v == null ? "" : v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const url = v => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/i.test(v.trim())) ? v.trim() : "";
  const wa = v => { const n = String(v || "").replace(/\D/g, ""); return n.length >= 10 && n.length <= 15 ? n : ""; };
  const WA_SVG = $("#waFab svg") ? $("#waFab svg").outerHTML : "";
  const ATRAS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const TIENDA_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9l1.5-5h13L20 9M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11V9zM5 13.5V20h14v-6.5M10 20v-4h4v4"/></svg>';

  /* ---------- Datos ---------- */
  const D = { vendedores: [], productos: [], porSlug: new Map(), listo: false };
  async function cargar() {
    if (!window.supabase || !CFG.supabaseUrl) return false;
    try {
      const sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await sb.rpc("tiendas_asociadas");
      if (error || !data) { if (error) console.info("[ELDOSTORE] tiendas_asociadas() no disponible: no se muestran tiendas asociadas."); return false; }
      D.vendedores = (data.vendedores || []).map(v => ({
        id: String(v.id), slug: String(v.slug || ""), nombre: limpiar(v.nombre, 80), descripcion: String(v.descripcion || "").slice(0, 600),
        logo: url(v.logo), whatsapp: wa(v.whatsapp), localidad: limpiar(v.localidad, 80)
      })).filter(v => /^[a-z0-9-]{1,60}$/.test(v.slug) && v.whatsapp);
      const ids = new Map(D.vendedores.map(v => [v.id, v]));
      D.productos = (data.productos || []).map(p => ({
        id: String(p.id), vendedor: ids.get(String(p.vendedorId)), codigo: limpiar(p.codigo, 40), nombre: limpiar(p.nombre, 140) || "Producto",
        descripcion: String(p.descripcion || "").slice(0, 2000), categoria: limpiar(p.categoria, 60),
        precio: Number(p.precio) > 0 ? Math.round(Number(p.precio)) : null, disponible: p.disponible === true,
        fotos: (Array.isArray(p.fotos) ? p.fotos : []).map(url).filter(Boolean).slice(0, 10)
      })).filter(p => p.vendedor);
      for (const v of D.vendedores) v.productos = D.productos.filter(p => p.vendedor === v);
      D.porSlug = new Map(D.vendedores.map(v => [v.slug, v]));
      D.listo = true;
      return true;
    } catch (e) { return false; }
  }

  /* ---------- Pedido por tienda (en el navegador) ---------- */
  let pedidos = {};
  function leer() {
    try {
      const o = JSON.parse(localStorage.getItem(CLAVE) || "{}");
      if (!o || o.v !== 1 || typeof o.p !== "object") return {};
      const r = {};
      for (const [slug, items] of Object.entries(o.p)) {
        if (!items || typeof items !== "object") continue;
        for (const [id, q] of Object.entries(items)) { const n = Math.floor(Number(q)); if (n >= 1) (r[slug] = r[slug] || {})[id] = Math.min(n, MAX); }
      }
      return r;
    } catch (e) { return {}; }
  }
  function guardar() { try { localStorage.setItem(CLAVE, JSON.stringify({ v: 1, p: pedidos })); } catch (e) { /* sin almacenamiento */ } }
  const comprable = p => !!(p && p.disponible && p.precio);
  function lineas(v) {
    const items = pedidos[v.slug] || {};
    return Object.entries(items).map(([id, q]) => ({ p: v.productos.find(x => x.id === id), q })).filter(l => comprable(l.p))
      .map(l => Object.assign(l, { sub: l.p.precio * l.q }));
  }
  function conciliar() {
    for (const slug of Object.keys(pedidos)) {
      const v = D.porSlug.get(slug);
      if (!v) { delete pedidos[slug]; continue; }
      for (const id of Object.keys(pedidos[slug])) if (!comprable(v.productos.find(p => p.id === id))) delete pedidos[slug][id];
      if (!Object.keys(pedidos[slug]).length) delete pedidos[slug];
    }
    guardar();
  }
  function setQ(v, id, q) {
    const n = Math.max(0, Math.min(MAX, Math.floor(q)));
    pedidos[v.slug] = pedidos[v.slug] || {};
    if (n) pedidos[v.slug][id] = n; else delete pedidos[v.slug][id];
    if (!Object.keys(pedidos[v.slug]).length) delete pedidos[v.slug];
    guardar();
  }
  function mensaje(v) {
    const ls = lineas(v), total = ls.reduce((a, l) => a + l.sub, 0);
    const nombre = limpiar(($("#asNombre") || {}).value, 60), zona = limpiar(($("#asZona") || {}).value, 80);
    const r = [`Hola ${v.nombre}, quiero hacer este pedido (lo vi en Tiendas asociadas de ELDOSTORE):`, "", `Vendedor: ${v.nombre}`, ""];
    ls.forEach((l, i) => {
      if (i) r.push("");
      r.push(`${l.q} × ${l.p.nombre}`);
      if (l.p.codigo) r.push(`Código: ${l.p.codigo}`);
      r.push(`— ${money(l.sub)} (${money(l.p.precio)} c/u)`);
    });
    r.push("", `Total estimado: ${money(total)} (sin envío)`);
    if (nombre) r.push(`Nombre: ${nombre}`);
    if (zona) r.push(`Zona o localidad: ${zona}`);
    r.push("", "Quedo a la espera de que me confirmes disponibilidad, forma de pago y entrega.");
    return r.join("\n");
  }
  function consulta(v, p) {
    const r = [`Hola ${v.nombre}, me interesa este producto (lo vi en Tiendas asociadas de ELDOSTORE):`, "", `Producto: ${p.nombre}`];
    if (p.codigo) r.push(`Código: ${p.codigo}`);
    r.push(`Precio: ${p.precio ? money(p.precio) : "a consultar"}`);
    return r.join("\n");
  }

  /* ---------- Sección en la página principal ---------- */
  function iniciales(n) { return esc(n.split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase() || "T"); }
  function logoHTML(v, cls) {
    return v.logo ? `<span class="${cls}"><img src="${esc(v.logo)}" alt="" loading="lazy" decoding="async"></span>` : `<span class="${cls} sin-logo" aria-hidden="true">${iniciales(v.nombre)}</span>`;
  }
  function tarjetaTienda(v) {
    const n = v.productos.length;
    return `<a class="as-tienda" href="#tiendas/${esc(v.slug)}">
      ${logoHTML(v, "as-logo")}
      <span class="as-tienda-txt"><b>${esc(v.nombre)}</b>
        <small>${v.localidad ? esc(v.localidad) + " · " : ""}${n} producto${n === 1 ? "" : "s"}</small></span>
      <span class="as-ir" aria-hidden="true">›</span></a>`;
  }
  // En la portada y en la lista solo se muestran las tiendas que tienen productos publicados.
  const conProductos = () => D.vendedores.filter(v => v.productos.length);
  function dibujarSeccion() {
    const sec = $("#asociadas"); if (!sec) return;
    const vs = conProductos();
    sec.hidden = !vs.length;
    const link = $("#asLinkMenu"); if (link) link.hidden = !vs.length;
    if (!vs.length) return;
    $("#asLista").innerHTML = vs.slice(0, 8).map(tarjetaTienda).join("") +
      (vs.length > 8 ? `<a class="as-tienda as-todas" href="#tiendas"><span class="as-tienda-txt"><b>Ver las ${vs.length} tiendas</b></span><span class="as-ir" aria-hidden="true">›</span></a>` : "");
  }

  /* ---------- Página propia (superpuesta) ---------- */
  const pag = document.createElement("section");
  pag.className = "asp"; pag.id = "asPagina"; pag.hidden = true;
  pag.setAttribute("aria-label", "Tiendas asociadas");
  document.body.appendChild(pag);
  const titulo0 = document.title;
  let ruta = null, foco = null, qFicha = 1, qCard = new Map(), desdeTienda = false, fotoI = 0;

  function leerRuta() {
    const h = location.hash;
    if (h !== "#tiendas" && !h.startsWith("#tiendas/")) return null;
    const partes = h.slice(1).split("/").map(x => { try { return decodeURIComponent(x); } catch (e) { return ""; } });
    return { slug: partes[1] || "", codigo: partes.slice(2).join("/") || "" };
  }
  function barra(titulo, v) {
    const ls = v ? lineas(v) : [], u = ls.reduce((a, l) => a + l.q, 0), t = ls.reduce((a, l) => a + l.sub, 0);
    return `<div class="f-bar as-bar">
      <button type="button" class="f-back" data-as="volver" aria-label="Volver">${ATRAS}<span>Volver</span></button>
      <span class="as-bar-t">${esc(titulo)}</span>
      ${v ? `<button type="button" class="f-cart" data-as="pedido" aria-label="Ver pedido a ${esc(v.nombre)}: ${u} artículos, ${money(t)}">${TIENDA_SVG}<span class="cart-count">${u}</span><span>${money(t)}</span></button>` : "<span></span>"}
    </div>`;
  }
  function cardHTML(v, p) {
    const ok = comprable(p), q = qCard.get(p.id) || 1, en = (pedidos[v.slug] || {})[p.id] || 0;
    const href = `#tiendas/${esc(v.slug)}/${encodeURIComponent(p.codigo)}`;
    return `<article class="card${p.disponible ? "" : " is-off"}" data-id="${esc(p.id)}">
      <a class="pic" href="${href}" aria-label="Ver ${esc(p.nombre)}">${p.disponible ? "" : '<span class="tag grey">Sin stock</span>'}${p.fotos[0] ? `<img src="${esc(p.fotos[0])}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">` : '<span class="ph">' + esc(v.nombre) + "</span>"}</a>
      ${p.categoria ? `<p class="cat-lbl">${esc(p.categoria)}</p>` : ""}
      <h3 class="name" title="${esc(p.nombre)}"><a href="${href}">${esc(p.nombre)}</a></h3>
      ${p.precio ? `<p class="price">${money(p.precio)}</p>` : '<p class="price na">Consultar precio</p>'}
      ${!p.disponible ? '<span class="stock no">Sin stock</span>' : '<span class="stock ok">Disponible</span>'}
      ${ok ? `<div class="buyrow"><div class="qty" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
          <button type="button" data-as="dec" aria-label="Restar uno" ${q <= 1 ? "disabled" : ""}>−</button><output>${q}</output>
          <button type="button" data-as="inc" aria-label="Sumar uno" ${q >= MAX ? "disabled" : ""}>+</button></div>
          <button class="add" type="button" data-as="add">Agregar</button></div>`
        : `<div class="buyrow"><button class="add" type="button" disabled>${p.disponible ? "Consultá por WhatsApp" : "Sin stock"}</button></div>`}
      <p class="incart" ${en ? "" : "hidden"}>En tu pedido: ${en}</p>
    </article>`;
  }
  const filtroTienda = { texto: "" };
  function dibujarTodas() {
    pag.innerHTML = barra("Tiendas asociadas") + `<div class="f-wrap">
      <h1 class="as-h1">Tiendas asociadas</h1>
      <p class="as-intro">Comercios de la zona que venden a través de ELDOSTORE. Cada tienda recibe su pedido por WhatsApp y coordina con vos el pago y la entrega.</p>
      <div class="as-grid">${conProductos().map(tarjetaTienda).join("") || '<div class="state"><b>Todavía no hay tiendas asociadas.</b></div>'}</div></div>`;
    document.title = "Tiendas asociadas | ELDOSTORE";
  }
  function dibujarTienda(v) {
    const t = norm(filtroTienda.texto);
    const lista = v.productos.filter(p => !t || norm(p.nombre + " " + p.categoria + " " + p.codigo).includes(t));
    const ls = lineas(v);
    pag.innerHTML = barra(v.nombre, v) + `<div class="f-wrap">
      <header class="as-cab">
        ${logoHTML(v, "as-logo grande")}
        <div class="as-cab-txt"><p class="as-sello">Tienda asociada a ELDOSTORE</p>
          <h1 class="as-h1" id="asTitulo" tabindex="-1">${esc(v.nombre)}</h1>
          ${v.localidad ? `<p class="as-loc">${esc(v.localidad)}</p>` : ""}
          ${v.descripcion ? `<p class="as-desc">${esc(v.descripcion)}</p>` : ""}
          <a class="f-wa as-wa" href="https://wa.me/${v.whatsapp}?text=${encodeURIComponent("Hola " + v.nombre + ", te escribo desde Tiendas asociadas de ELDOSTORE.")}" target="_blank" rel="noopener noreferrer">${WA_SVG}Escribir a ${esc(v.nombre)}</a>
        </div>
      </header>
      <p class="as-aviso">Los productos de esta tienda los vende y entrega <b>${esc(v.nombre)}</b>. El pedido se envía a su WhatsApp y el pago se coordina con el vendedor. No se suman a tu carrito de ELDOSTORE.</p>
      ${v.productos.length > 8 ? `<label class="search as-buscar"><span class="sr">Buscar en ${esc(v.nombre)}</span><input type="search" id="asBuscar" placeholder="Buscar en ${esc(v.nombre)}…" value="${esc(filtroTienda.texto)}" autocomplete="off"></label>` : ""}
      <div class="products as-prods" id="asProds">${lista.length ? lista.map(p => cardHTML(v, p)).join("")
        : `<div class="state"><b>${v.productos.length ? "No encontramos productos con esa búsqueda." : "Esta tienda todavía no tiene productos publicados."}</b></div>`}</div>
      ${ls.length ? `<button type="button" class="as-flota" data-as="pedido">${TIENDA_SVG}<span>Ver pedido a ${esc(v.nombre)} · <b>${money(ls.reduce((a, l) => a + l.sub, 0))}</b></span></button>` : ""}
    </div>`;
    document.title = v.nombre + " | Tiendas asociadas | ELDOSTORE";
  }
  function dibujarFicha(v, p) {
    const ok = comprable(p), en = (pedidos[v.slug] || {})[p.id] || 0;
    if (fotoI >= p.fotos.length) fotoI = 0;
    pag.innerHTML = barra(v.nombre, v) + `<div class="f-wrap"><div class="f-main">
      <div class="f-gal"><div class="f-photo${p.disponible ? "" : " is-off"}">${p.disponible ? "" : '<span class="tag grey">Sin stock</span>'}
        ${p.fotos.length ? `<div class="f-track as-track" tabindex="0" aria-label="Fotos de ${esc(p.nombre)}">${p.fotos.map((u, i) => `<div class="f-slide"><img src="${esc(u)}" alt="${esc(p.nombre)}${p.fotos.length > 1 ? ", foto " + (i + 1) + " de " + p.fotos.length : ""}" decoding="async" ${i ? 'loading="lazy"' : ""}></div>`).join("")}</div>
          ${p.fotos.length > 1 ? `<span class="f-count" aria-hidden="true"><b>${fotoI + 1}</b> / ${p.fotos.length}</span>` : ""}` : '<span class="ph">' + esc(v.nombre) + "</span>"}
        </div>
        ${p.fotos.length > 1 ? `<div class="f-thumbs">${p.fotos.map((u, i) => `<button type="button" class="f-th" data-as="foto" data-i="${i}" aria-label="Ver foto ${i + 1}" aria-current="${i === fotoI}"><img src="${esc(u)}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
      </div>
      <div class="f-info">
        <a class="as-de" href="#tiendas/${esc(v.slug)}">${logoHTML(v, "as-logo mini")}<span>Vendido por <b>${esc(v.nombre)}</b></span></a>
        ${p.categoria ? `<p class="cat-lbl">${esc(p.categoria)}</p>` : ""}
        <h1 class="f-name" id="asTitulo" tabindex="-1">${esc(p.nombre)}</h1>
        ${p.codigo ? `<p class="f-code">Código: <span>${esc(p.codigo)}</span></p>` : ""}
        ${p.precio ? `<p class="f-price">${money(p.precio)}</p>` : '<p class="f-price na">Consultar precio</p>'}
        ${!p.disponible ? '<span class="stock no">Sin stock</span>' : '<span class="stock ok">Disponible</span>'}
        ${ok ? `<div class="f-buy"><div class="qty" role="group" aria-label="Cantidad">
            <button type="button" data-as="fdec" aria-label="Restar uno" ${qFicha <= 1 ? "disabled" : ""}>−</button><output>${qFicha}</output>
            <button type="button" data-as="finc" aria-label="Sumar uno" ${qFicha >= MAX ? "disabled" : ""}>+</button></div>
            <button type="button" class="add f-add" data-as="fadd">Agregar al pedido</button></div>`
          : `<div class="f-buy"><button type="button" class="add f-add" disabled>${p.disponible ? "Precio a confirmar" : "Sin stock"}</button></div>`}
        <p class="incart" ${en ? "" : "hidden"}>En tu pedido a ${esc(v.nombre)}: ${en}</p>
        ${p.descripcion ? `<div class="as-pdesc">${esc(p.descripcion).replace(/\n/g, "<br>")}</div>` : ""}
        <ul class="f-notes"><li>Lo vende y entrega ${esc(v.nombre)}${v.localidad ? " (" + esc(v.localidad) + ")" : ""}.</li><li>El pago y la entrega se coordinan con el vendedor por WhatsApp.</li></ul>
        <a class="f-wa" href="https://wa.me/${v.whatsapp}?text=${encodeURIComponent(consulta(v, p))}" target="_blank" rel="noopener noreferrer">${WA_SVG}Consultar a ${esc(v.nombre)}</a>
      </div></div></div>`;
    document.title = p.nombre + " | " + v.nombre + " | ELDOSTORE";
  }

  /* Hoja con el pedido de la tienda */
  const hoja = document.createElement("div");
  hoja.className = "as-hoja"; hoja.hidden = true;
  document.body.appendChild(hoja);
  let hojaV = null, focoHoja = null;
  function abrirPedido(v) {
    hojaV = v; focoHoja = document.activeElement;
    dibujarPedido(); hoja.hidden = false;
    const b = hoja.querySelector("[data-as=cerrar]"); if (b) b.focus();
  }
  function cerrarPedido() { if (hoja.hidden) return; hoja.hidden = true; hoja.innerHTML = ""; hojaV = null; if (focoHoja && document.body.contains(focoHoja)) focoHoja.focus(); }
  function dibujarPedido() {
    const v = hojaV; if (!v) return;
    const ls = lineas(v), total = ls.reduce((a, l) => a + l.sub, 0), u = ls.reduce((a, l) => a + l.q, 0);
    const nom = ($("#asNombre") || {}).value || "", zona = ($("#asZona") || {}).value || "";
    hoja.innerHTML = `<div class="as-hoja-box" role="dialog" aria-modal="true" aria-labelledby="asPedT">
      <div class="pan-hd"><h2 id="asPedT">Pedido a ${esc(v.nombre)} ${u ? "(" + u + ")" : ""}</h2>
        <button class="x-btn" type="button" data-as="cerrar" aria-label="Cerrar pedido">✕</button></div>
      <div class="as-hoja-cuerpo">${ls.length ? `
        <ul class="items">${ls.map(({ p, q, sub }) => `<li class="it" data-id="${esc(p.id)}">
          <div class="it-ph">${p.fotos[0] ? `<img src="${esc(p.fotos[0])}" alt="">` : ""}</div>
          <div style="min-width:0"><div class="it-top"><div style="min-width:0"><p class="it-nm">${esc(p.nombre)}</p><p class="it-unit">${esc(p.codigo)} · ${money(p.precio)} c/u</p></div>
            <button class="rm" type="button" data-as="rm" aria-label="Quitar ${esc(p.nombre)}">✕</button></div>
            <div class="it-row"><div class="qty" role="group" aria-label="Cantidad de ${esc(p.nombre)}">
              <button type="button" data-as="pdec" aria-label="Restar uno">−</button><output>${q}</output>
              <button type="button" data-as="pinc" aria-label="Sumar uno" ${q >= MAX ? "disabled" : ""}>+</button></div>
              <span class="it-sub">${money(sub)}</span></div></div></li>`).join("")}</ul>
        <form class="fields" onsubmit="return false">
          <label for="asNombre">Nombre (opcional)<input id="asNombre" maxlength="60" autocomplete="name" value="${esc(nom)}"></label>
          <label for="asZona">Zona o localidad (opcional)<input id="asZona" maxlength="80" value="${esc(zona)}"></label>
        </form>
        <details class="preview"><summary>Ver el mensaje que se va a enviar</summary><pre id="asMsg">${esc(mensaje(v))}</pre></details>`
        : '<div class="cart-empty"><p>Todavía no agregaste productos de esta tienda.</p></div>'}
      </div>
      ${ls.length ? `<div class="cart-ft"><div class="tot"><span>Total estimado (sin envío)</span><strong>${money(total)}</strong></div>
        <a class="send" id="asEnviar" href="https://wa.me/${v.whatsapp}?text=${encodeURIComponent(mensaje(v))}" target="_blank" rel="noopener noreferrer">${WA_SVG}Enviar pedido a ${esc(v.nombre)}</a>
        <p class="status" id="asEstado" role="status" hidden></p>
        <p class="legal">El pedido llega al WhatsApp de ${esc(v.nombre)}, que te confirma disponibilidad, precio final, forma de pago y entrega. ELDOSTORE no cobra este pedido.</p></div>` : ""}
    </div>`;
  }
  hoja.addEventListener("input", () => {
    if (!hojaV) return;
    const t = mensaje(hojaV), pre = $("#asMsg"), a = $("#asEnviar");
    if (pre) pre.textContent = t;
    if (a) a.href = `https://wa.me/${hojaV.whatsapp}?text=` + encodeURIComponent(t);
  });
  hoja.addEventListener("click", e => {
    if (e.target === hoja) { cerrarPedido(); return; }
    const b = e.target.closest("[data-as]"); if (!b) return;
    const v = hojaV; if (!v) return;
    if (b.dataset.as === "cerrar") { cerrarPedido(); return; }
    if (b.id === "asEnviar") return;
    const id = b.closest(".it") && b.closest(".it").dataset.id, q = id ? (pedidos[v.slug] || {})[id] || 0 : 0;
    if (b.dataset.as === "pinc") setQ(v, id, q + 1);
    if (b.dataset.as === "pdec") setQ(v, id, q - 1);
    if (b.dataset.as === "rm") setQ(v, id, 0);
    dibujarPedido(); redibujar();
    const again = id && hoja.querySelector(`.it[data-id="${CSS.escape(id)}"] [data-as="${b.dataset.as}"]`);
    (again && !again.disabled ? again : hoja.querySelector("[data-as=cerrar]")).focus();
  });
  hoja.addEventListener("click", e => {
    if (!e.target.closest("#asEnviar")) return;
    const s = $("#asEstado");
    if (s) { s.textContent = `Se abrió WhatsApp con tu pedido para ${hojaV.nombre}. Enviá el mensaje desde WhatsApp para que te responda.`; s.hidden = false; }
  });

  /* ---------- Navegación ---------- */
  let tToast;
  function toast(h) { const t = $("#toast"); if (!t) return; t.innerHTML = h; t.classList.add("on"); clearTimeout(tToast); tToast = setTimeout(() => t.classList.remove("on"), 2200); }
  function redibujar() {
    if (pag.hidden || !ruta) return;
    const y = pag.scrollTop;
    mostrar(ruta, false);
    pag.scrollTop = y;
  }
  function mostrar(r, nuevo) {
    const v = r.slug ? D.porSlug.get(r.slug) : null;
    if (!r.slug) dibujarTodas();
    else if (!v) pag.innerHTML = barra("Tiendas asociadas") + `<div class="f-wrap"><div class="state"><b>Esta tienda no está disponible.</b>Puede que ya no esté publicada.<br><a class="cta" href="#tiendas">Ver las tiendas asociadas</a></div></div>`;
    else if (r.codigo) {
      const p = v.productos.find(x => x.codigo === r.codigo);
      if (p) dibujarFicha(v, p);
      else pag.innerHTML = barra(v.nombre, v) + `<div class="f-wrap"><div class="state"><b>Este producto ya no está publicado.</b><br><a class="cta" href="#tiendas/${esc(v.slug)}">Ver ${esc(v.nombre)}</a></div></div>`;
    } else dibujarTienda(v);
    if (nuevo) {
      pag.scrollTop = 0;
      const h = pag.querySelector("#asTitulo") || pag.querySelector(".f-back");
      if (h) h.focus({ preventScroll: true });
    }
  }
  function enrutar() {
    const r = leerRuta();
    if (!r) { ocultar(); return; }
    if (!D.listo) return;   // se muestra al terminar de cargar
    const nuevo = !ruta || ruta.slug !== r.slug || ruta.codigo !== r.codigo;
    if (nuevo) { qFicha = 1; fotoI = 0; if (!ruta || ruta.slug !== r.slug) filtroTienda.texto = ""; }
    if (pag.hidden) { const a = document.activeElement; foco = a && a !== document.body ? a : null; }
    ruta = r;
    cerrarPedido();
    mostrar(r, nuevo);
    pag.hidden = false;
    document.body.classList.add("asp-open");
    document.documentElement.classList.add("lock");
  }
  function ocultar() {
    if (pag.hidden) return;
    cerrarPedido();
    pag.hidden = true; pag.innerHTML = ""; ruta = null;
    document.body.classList.remove("asp-open");
    if (!document.body.classList.contains("ficha-open") && !document.body.classList.contains("panel-open")) document.documentElement.classList.remove("lock");
    document.title = titulo0;
    if (foco && document.body.contains(foco)) foco.focus({ preventScroll: true });
    foco = null;
  }
  function volver() {
    if (desdeTienda && history.length > 1) { history.back(); return; }
    const r = ruta || {};
    if (r.codigo) location.hash = "#tiendas/" + r.slug;
    else if (r.slug) location.hash = "#tiendas";
    else { history.replaceState(null, "", location.pathname + location.search + "#asociadas"); ocultar(); }
  }
  window.addEventListener("hashchange", () => { if (leerRuta()) desdeTienda = true; enrutar(); });

  pag.addEventListener("input", e => {
    if (e.target.id !== "asBuscar" || !ruta) return;
    filtroTienda.texto = e.target.value.slice(0, 60);
    const v = D.porSlug.get(ruta.slug); if (!v) return;
    const t = norm(filtroTienda.texto), lista = v.productos.filter(p => !t || norm(p.nombre + " " + p.categoria + " " + p.codigo).includes(t));
    $("#asProds").innerHTML = lista.length ? lista.map(p => cardHTML(v, p)).join("") : '<div class="state"><b>No encontramos productos con esa búsqueda.</b></div>';
  });
  pag.addEventListener("scroll", e => {
    const t = e.target;
    if (!(t instanceof Element) || !t.classList.contains("as-track")) return;
    const i = Math.round(t.scrollLeft / Math.max(1, t.clientWidth));
    if (i === fotoI) return;
    fotoI = i;
    const c = pag.querySelector(".f-count b"); if (c) c.textContent = i + 1;
    pag.querySelectorAll(".f-th").forEach((b, k) => b.setAttribute("aria-current", String(k === i)));
  }, true);
  pag.addEventListener("click", e => {
    const b = e.target.closest("[data-as]"); if (!b) return;
    const v = ruta && D.porSlug.get(ruta.slug);
    const a = b.dataset.as;
    if (a === "volver") { volver(); return; }
    if (a === "pedido" && v) { abrirPedido(v); return; }
    if (!v) return;
    if (a === "foto") {
      fotoI = Number(b.dataset.i) || 0;
      const t = pag.querySelector(".as-track"); if (t) t.scrollTo({ left: fotoI * t.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      return;
    }
    if (a === "fdec" || a === "finc" || a === "fadd") {
      const p = v.productos.find(x => x.codigo === ruta.codigo); if (!comprable(p)) return;
      if (a === "fdec") qFicha = Math.max(1, qFicha - 1);
      if (a === "finc") qFicha = Math.min(MAX, qFicha + 1);
      if (a === "fadd") {
        const antes = (pedidos[v.slug] || {})[p.id] || 0, nuevo = Math.min(MAX, antes + qFicha);
        if (nuevo === antes) { toast("Llegaste al máximo de " + MAX + " unidades."); return; }
        setQ(v, p.id, nuevo); qFicha = 1;
        toast(`<b>Agregado al pedido a ${esc(v.nombre)}:</b> ${nuevo - antes} × ${esc(p.nombre)}`);
      }
      redibujar();
      const again = pag.querySelector(`[data-as="${a}"]`); if (again && !again.disabled) again.focus({ preventScroll: true });
      return;
    }
    const card = b.closest(".card"), p = card && v.productos.find(x => x.id === card.dataset.id);
    if (!comprable(p)) return;
    const q = qCard.get(p.id) || 1;
    if (a === "inc") qCard.set(p.id, Math.min(MAX, q + 1));
    if (a === "dec") qCard.set(p.id, Math.max(1, q - 1));
    if (a === "add") {
      const antes = (pedidos[v.slug] || {})[p.id] || 0, nuevo = Math.min(MAX, antes + q);
      if (nuevo === antes) { toast("Llegaste al máximo de " + MAX + " unidades."); return; }
      setQ(v, p.id, nuevo); qCard.set(p.id, 1);
      toast(`<b>Agregado al pedido a ${esc(v.nombre)}:</b> ${nuevo - antes} × ${esc(p.nombre)}`);
    }
    redibujar();
    const again = pag.querySelector(`.card[data-id="${CSS.escape(p.id)}"] [data-as="${a}"]`);
    if (again && !again.disabled) again.focus({ preventScroll: true });
  });
  pag.addEventListener("error", e => {
    if (e.target.tagName !== "IMG") return;
    const s = document.createElement("span"); s.className = "ph"; e.target.replaceWith(s);
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!hoja.hidden) { e.stopImmediatePropagation(); cerrarPedido(); return; }
    if (!pag.hidden) { e.stopImmediatePropagation(); volver(); }
  }, true);
  hoja.addEventListener("keydown", e => {
    if (e.key !== "Tab") return;
    const f = Array.from(hoja.querySelectorAll("a[href], button:not([disabled]), input, summary"));
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });

  /* ---------- Inicio ---------- */
  (async function iniciar() {
    pedidos = leer();
    if (!(await cargar())) return;
    conciliar();
    dibujarSeccion();
    enrutar();
  })();
})();
