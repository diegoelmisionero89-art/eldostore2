// Prueba de punta a punta (navegador real) de Vendedores asociados V1, contra la base DESCARTABLE.
// Uso: node herramientas/prueba-006/e2e.js http://127.0.0.1:8099 <carpeta-capturas>
const { chromium, devices } = require("playwright");
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const BASE = process.argv[2] || "http://127.0.0.1:8099";
const OUT = process.argv[3] || "capturas";
fs.mkdirSync(OUT, { recursive: true });

// PNG de prueba (cuadrado de color con franja), sin dependencias
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    let x = 0xffffffff; for (const v of buf) x = t[(x ^ v) & 0xff] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const chunk = (tipo, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(tipo), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const f = Math.abs(y - h / 2) < h / 8; raw[o] = f ? 255 : r; raw[o + 1] = f ? 215 : g; raw[o + 2] = f ? 0 : b; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const IMG = { logo: png(300, 300, [20, 20, 20]), a: png(900, 900, [146, 80, 217]), b: png(900, 900, [30, 120, 200]) };
for (const [k, v] of Object.entries(IMG)) fs.writeFileSync(path.join(OUT, k + ".png"), v);

let ok = 0, mal = 0;
const r = (n, cond, det) => { if (cond) { ok++; console.log("[OK]   ", n, det ? "→ " + det : ""); } else { mal++; console.log("[FALLA]", n, det ? "→ " + det : ""); } };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["iPhone 13"] });
  // Fotos «subidas»: se sirven con la imagen de prueba
  const fotos = new Map();
  await ctx.route("https://fotos.prueba.invalid/**", rt => rt.fulfill({ status: 200, contentType: "image/png", body: IMG.a }));
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", e => errores.push(e.message));
  page.on("dialog", d => d.accept(d.type() === "prompt" ? "Cliente desistió de la compra" : undefined));

  /* ---------------- PANEL ---------------- */
  await page.goto(BASE + "/admin.html");
  await page.waitForSelector(".nav-item[data-view=asociados]", { state: "attached" });
  await page.waitForFunction(() => document.body.classList.contains("modo-asociados"), null, { timeout: 15000 });
  r("Panel: aparece «Tiendas asociadas» con la migración 006", true);
  await page.evaluate(() => switchView("asociados"));
  await page.screenshot({ path: path.join(OUT, "01-panel-vacio.png") });

  // Nuevo vendedor
  await page.click("text=+ Nuevo vendedor");
  await page.fill("#mv_nombre", "Perfumes del Sol");
  await page.fill("#mv_wa", "3751 11-2233");
  await page.fill("#mv_loc", "Eldorado, Km 9");
  await page.fill("#mv_desc", "Perfumes árabes y de diseñador. Envíos dentro de Eldorado.");
  await page.check("#mv_activo");
  await page.setInputFiles("#mv_logo", { name: "logo.png", mimeType: "image/png", buffer: IMG.logo });
  await page.waitForSelector("#mv_logo_prev .img-prev-info.ok, #mv_logo_prev .img-prev-info.aviso", { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, "02-panel-nuevo-vendedor.png") });
  await page.click("#mvBtn");
  await page.waitForSelector(".promo-item >> text=Perfumes del Sol");
  const vend = await page.evaluate(() => MKT.vendedores[0]);
  r("Vendedor creado con WhatsApp internacional y logo subido", vend && vend.whatsapp === "5493751112233" && /^https:\/\/fotos\.prueba\.invalid\/vendedores\//.test(vend.logo_url) && vend.activo, vend && vend.whatsapp + " " + vend.logo_url);

  // Segundo vendedor, inactivo
  await page.click("text=+ Nuevo vendedor");
  await page.fill("#mv_nombre", "Herramientas Km 5");
  await page.fill("#mv_wa", "3757 000111");
  await page.click("#mvBtn");
  await page.waitForSelector(".promo-item >> text=Herramientas Km 5");

  // Producto con 2 fotos
  await page.click(".tab >> text=Productos");
  await page.click("text=+ Nuevo producto asociado");
  await page.selectOption("#mp_vend", { label: "Perfumes del Sol" });
  await page.fill("#mp_nombre", "Perfume Lattafa Asad 100 ml");
  await page.fill("#mp_cat", "Perfumes");
  await page.fill("#mp_precio", "45000");
  await page.fill("#mp_stock", "4");
  await page.fill("#mp_desc", "Eau de parfum original.\nDuración: 8 a 10 horas.");
  await page.setInputFiles("#modalBody label.file-btn input[type=file]", [
    { name: "a.png", mimeType: "image/png", buffer: IMG.a }, { name: "b.png", mimeType: "image/png", buffer: IMG.b }]);
  await page.waitForFunction(() => document.querySelectorAll("#mp_fotos .mkt-foto img").length === 2, null, { timeout: 15000 });
  await page.screenshot({ path: path.join(OUT, "03-panel-nuevo-producto.png") });
  await page.click("#mpBtn");
  await page.waitForSelector(".promo-item >> text=Perfume Lattafa Asad 100 ml");
  let prod = await page.evaluate(() => MKT.productos[0]);
  r("Producto creado: código automático, pendiente, 2 fotos", prod.codigo === "TA0001" && prod.estado === "pendiente" && prod.fotos.length === 2, `${prod.codigo} ${prod.estado} ${prod.fotos.length} fotos`);
  // Producto del vendedor inactivo, aprobado (no debe verse)
  await page.click("text=+ Nuevo producto asociado");
  await page.selectOption("#mp_vend", { label: "Herramientas Km 5 (inactivo)" });
  await page.fill("#mp_nombre", "Taladro percutor 500 W");
  await page.fill("#mp_precio", "80000");
  await page.click("#mpBtn");
  await page.waitForSelector(".promo-item >> text=Taladro percutor 500 W");

  // Tienda ANTES de aprobar: no hay nada publicado
  const p2 = await ctx.newPage();
  await p2.goto(BASE + "/index.html");
  await p2.waitForSelector(".card", { timeout: 15000 });
  await p2.waitForTimeout(800);
  r("Tienda: sin productos aprobados no se muestra ninguna tienda asociada", await p2.$eval("#asociadas", s => s.hidden));
  await p2.close();

  // Aprobar los dos
  for (const n of ["Perfume Lattafa Asad 100 ml", "Taladro percutor 500 W"]) {
    await page.click(`.promo-item:has-text("${n}") >> text=Aprobar y publicar`);
    await page.waitForFunction(nombre => MKT.productos.find(p => p.nombre === nombre).estado === "aprobado", n);
  }
  await page.screenshot({ path: path.join(OUT, "04-panel-productos.png"), fullPage: true });
  r("Productos aprobados", await page.evaluate(() => MKT.productos.every(p => p.estado === "aprobado")));

  /* ---------------- TIENDA PÚBLICA ---------------- */
  const t = await ctx.newPage();
  t.on("pageerror", e => errores.push("tienda: " + e.message));
  await t.goto(BASE + "/index.html");
  await t.waitForSelector("#catalogo-productos .card", { timeout: 15000 });
  await t.waitForSelector("#asociadas:not([hidden])", { timeout: 15000 });
  const propios = await t.$$eval("#catalogo-productos .card", cs => cs.map(c => c.textContent));
  r("«Todos los productos» de ELDOSTORE sigue igual (no aparecen los asociados)", propios.length === 1 && !propios.join(" ").includes("Lattafa"), propios.length + " producto(s)");
  await t.fill("#qMob", "Lattafa");
  await t.waitForTimeout(200);
  r("El buscador de ELDOSTORE no muestra productos asociados", await t.$$eval("#catalogo-productos .card", cs => cs.every(c => !c.textContent.includes("Lattafa"))));
  await t.fill("#qMob", "");
  const secc = await t.$eval("#asociadas", s => s.textContent);
  r("Sección pública: solo la tienda ACTIVA", secc.includes("Perfumes del Sol") && !secc.includes("Herramientas Km 5"));
  await t.$eval("#asociadas", s => s.scrollIntoView());
  await t.screenshot({ path: path.join(OUT, "05-tienda-seccion.png") });

  await t.click(".as-tienda >> text=Perfumes del Sol");
  await t.waitForSelector(".asp:not([hidden]) .as-cab");
  await t.waitForTimeout(400);
  r("Dirección propia de la tienda", (await t.evaluate(() => location.hash)) === "#tiendas/perfumes-del-sol");
  await t.screenshot({ path: path.join(OUT, "06-tienda-vendedor.png") });

  await t.click(".asp .card .name a");
  await t.waitForSelector(".asp .f-name");
  await t.waitForTimeout(400);
  r("Ficha del producto asociado con «Vendido por»", await t.$eval(".asp", e => e.textContent.includes("Vendido por Perfumes del Sol") && e.textContent.includes("TA0001") && e.textContent.includes("Duración")));
  await t.screenshot({ path: path.join(OUT, "07-tienda-ficha.png") });
  await t.click("[data-as=finc]");
  await t.click("[data-as=fadd]");
  await t.click("[data-as=volver]");
  await t.waitForSelector(".asp .as-cab");
  r("Atrás vuelve a la tienda del vendedor", (await t.evaluate(() => location.hash)) === "#tiendas/perfumes-del-sol");
  await t.click(".as-flota");
  await t.waitForSelector(".as-hoja:not([hidden]) #asEnviar");
  await t.fill("#asNombre", "Ana");
  await t.fill("#asZona", "Km 9, Eldorado");
  await t.click(".as-hoja .preview summary");
  await t.screenshot({ path: path.join(OUT, "08-tienda-pedido.png") });
  const href = await t.$eval("#asEnviar", a => a.href);
  const msg = decodeURIComponent(href.split("?text=")[1] || "");
  r("El pedido va al WhatsApp DEL VENDEDOR", href.startsWith("https://wa.me/5493751112233?text="), href.slice(0, 40));
  r("Mensaje: vendedor, producto, código, cantidad, precio y total",
    /Vendedor: Perfumes del Sol/.test(msg) && /2 × Perfume Lattafa Asad 100 ml/.test(msg) && /Código: TA0001/.test(msg) && /45\.000 c\/u/.test(msg) && /Total estimado: \$\s?90\.000/.test(msg) && /Nombre: Ana/.test(msg), msg.replace(/\n/g, " | "));
  r("El carrito de ELDOSTORE no cambió", (await t.$eval("#cartCount", e => e.textContent)) === "0");
  await t.keyboard.press("Escape");
  await t.keyboard.press("Escape");
  await t.waitForTimeout(300);
  r("Escape cierra el pedido y la tienda asociada", await t.$eval("#asPagina", p => p.hidden));
  await t.goto(BASE + "/index.html#tiendas/herramientas-km-5");
  await t.waitForSelector(".asp:not([hidden]) .state");
  r("Tienda de vendedor INACTIVO no está disponible", await t.$eval(".asp", e => e.textContent.includes("no está disponible")));

  /* ---------------- VENTAS Y COMISIÓN ---------------- */
  await page.bringToFront();
  await page.click(".tab >> text=Ventas y comisiones");
  await page.click("text=+ Registrar venta asociada");
  prod = await page.evaluate(() => MKT.productos.find(p => p.codigo === "TA0001"));
  await page.selectOption("#ms_prod", prod.id);
  await page.fill("#ms_cant", "2");
  await page.fill("#ms_cliente", "Ana");
  await page.waitForSelector("#ms_vista:not([hidden])");
  const vista = await page.$eval("#ms_vista", e => e.textContent);
  r("Vista previa: total, comisión 10 % y parte del vendedor", /90\.000/.test(vista) && /9\.000/.test(vista) && /81\.000/.test(vista), vista);
  await page.screenshot({ path: path.join(OUT, "09-panel-registrar-venta.png") });
  await page.click("#msBtn");
  await page.waitForFunction(() => MKT.ventas.length === 1);
  const venta = await page.evaluate(() => MKT.ventas[0]);
  r("Venta guardada con la comisión calculada por la base", venta.total === 90000 && venta.comision === 9000 && venta.monto_vendedor === 81000 && venta.comision_pct === 10);
  r("La venta descontó el stock asociado (4 → 2)", await page.evaluate(() => MKT.productos.find(p => p.codigo === "TA0001").stock === 2));
  const cajaAntes = await page.evaluate(() => DB.cashMovements.length);
  r("Comisión pendiente: la caja no cambia", await page.evaluate(() => !DB.cashMovements.some(m => m.origen === "comision_asociado")));
  await page.click("text=Marcar cobrada");
  await page.waitForSelector("#mcBtn");
  const aviso = await page.$eval("#modalBody", e => e.textContent);
  r("El panel avisa que entra SOLO la comisión a la caja y pide quién recibió el dinero",
    /ingreso de \$9\.000/.test(aviso) && (await page.$("#mc_quien")) !== null, aviso.replace(/\s+/g, " ").slice(0, 160));
  await page.screenshot({ path: path.join(OUT, "10a-panel-comision-cobrada.png") });
  await page.click("#mcBtn");
  await page.waitForFunction(() => MKT.ventas[0].comision_cobrada === true && !document.getElementById("modalBg").classList.contains("open"));
  const mov = await page.evaluate(() => DB.cashMovements.filter(m => m.origen === "comision_asociado"));
  r("Caja: un ingreso de $9.000 (la comisión, no los $90.000), cuenta ELDOSTORE, con la referencia de la venta",
    mov.length === 1 && mov[0].tipo === "ingreso" && mov[0].monto === 9000 && mov[0].refId === (await page.evaluate(() => MKT.ventas[0].id))
      && (await page.evaluate(id => accountName(id), mov[0].accountId)) === "ELDOSTORE",
    mov[0] && `${mov[0].tipo} ${mov[0].monto} · ${mov[0].descripcion}`);
  r("Los movimientos anteriores de la caja siguen iguales", await page.evaluate(n => DB.cashMovements.length === n + 1, cajaAntes));
  await page.screenshot({ path: path.join(OUT, "10-panel-ventas.png"), fullPage: true });
  await page.evaluate(() => switchView("caja"));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, "10b-panel-caja.png"), fullPage: true });
  r("La caja del panel muestra el ingreso de la comisión", await page.$eval("#cajaTableBody", t => t.textContent.includes("comision_asociado") && t.textContent.includes("Comisión 10 % de Perfumes del Sol")));
  // ESCENARIO de indicadores: venta 1 cobrada ($9.000) + venta 2 pendiente ($6.750)
  await page.evaluate(() => switchView("asociados"));
  await page.click("text=+ Registrar venta asociada");
  await page.selectOption("#ms_prod", prod.id);
  await page.fill("#ms_cant", "1");
  await page.fill("#ms_precio", "67500");
  await page.fill("#ms_cliente", "Bruno");
  await page.click("#msBtn");
  await page.waitForFunction(() => MKT.ventas.length === 2 && !document.getElementById("modalBg").classList.contains("open"));
  const leerInd = async () => { await page.waitForFunction(() => /Ingresos efectivos/.test((document.getElementById("mktIndicadores") || {}).textContent || "")); return page.$eval("#mktIndicadores", e => e.textContent.replace(/\s+/g, " ")); };
  const leerRep = async () => { await page.evaluate(() => switchView("reportes")); await page.waitForFunction(() => /Ingresos totales de ELDOSTORE/.test(document.getElementById("repMarketplace").textContent)); return page.$eval("#repMarketplace", e => e.textContent.replace(/\s+/g, " ")); };
  let ind = await leerInd();
  r("Pestaña Ventas: generadas $15.750 · cobradas $9.000 · pendientes $6.750 · ingresos efectivos $9.000",
    /Comisiones generadas ?\$15\.750/.test(ind) && /Comisiones cobradas ?\$9\.000/.test(ind) && /Comisiones pendientes ?\$6\.750/.test(ind) && /Ingresos efectivos por comisiones ?\$9\.000/.test(ind), ind.slice(0, 260));
  await page.screenshot({ path: path.join(OUT, "10c-panel-indicadores.png"), fullPage: true });
  let rep = await leerRep();
  r("Reportes: ingresos por comisiones = $9.000 (solo cobradas) y total = propias + $9.000, sin los $6.750 pendientes",
    /Ingresos por comisiones del Marketplace ?\$9\.000/.test(rep) && /Ingresos totales de ELDOSTORE ?\$9\.000/.test(rep)
      && /Comisiones generadas ?\$15\.750/.test(rep) && /Comisiones pendientes ?\$6\.750/.test(rep), rep.slice(0, 300));
  r("Reportes: la ganancia de ventas propias sigue siendo la del cálculo de siempre",
    await page.evaluate(() => { const g = [...document.querySelectorAll("#repKpis .kpi")].find(k => /Ganancia bruta/.test(k.textContent)); return !!g && /Ganancia por ventas propias ?\$0/.test(document.getElementById("repMarketplace").textContent.replace(/\s+/g, " ")) && /\$0/.test(g.textContent); }));
  await (await page.$("#repMarketplace")).screenshot({ path: path.join(OUT, "10d-panel-reportes.png") });

  // Cobrar después los $6.750
  await page.evaluate(() => switchView("asociados"));
  await page.click('tr:has-text("Bruno") >> text=Marcar cobrada');
  await page.waitForSelector("#mcBtn");
  await page.click("#mcBtn");
  await page.waitForFunction(() => MKT.ventas.every(v => v.comision_cobrada) && !document.getElementById("modalBg").classList.contains("open"));
  ind = await leerInd();
  r("Al cobrar los $6.750: ingresos efectivos $15.750, cobradas $15.750, pendientes $0",
    /Comisiones generadas ?\$15\.750/.test(ind) && /Comisiones cobradas ?\$15\.750/.test(ind) && /Comisiones pendientes ?\$0/.test(ind) && /Ingresos efectivos por comisiones ?\$15\.750/.test(ind), ind.slice(0, 260));
  const vig = await page.evaluate(() => DB.cashMovements.filter(m => m.origen === "comision_asociado" && m.tipo === "ingreso" && !DB.cashMovements.some(x => x.anulaA === m.id)).map(m => m.monto).sort((a, b) => a - b));
  r("Los $9.000 anteriores no se duplicaron: en caja hay un ingreso de $6.750 y uno de $9.000", JSON.stringify(vig) === "[6750,9000]", JSON.stringify(vig));
  await page.screenshot({ path: path.join(OUT, "10e-panel-indicadores-cobrado.png"), fullPage: true });
  rep = await leerRep();
  r("Reportes después del cobro: ingresos por comisiones $15.750 y total $15.750",
    /Ingresos por comisiones del Marketplace ?\$15\.750/.test(rep) && /Ingresos totales de ELDOSTORE ?\$15\.750/.test(rep), rep.slice(0, 260));
  await (await page.$("#repMarketplace")).screenshot({ path: path.join(OUT, "10f-panel-reportes-cobrado.png") });

  // Anular la venta de $90.000 (comisión ya cobrada)
  await page.evaluate(() => switchView("asociados"));
  await page.click('tr:has-text("Ana") >> text=Anular');
  await page.waitForSelector("#maBtn");
  await page.fill("#ma_motivo", "El cliente devolvió el perfume");
  await page.click("#maBtn");
  await page.waitForFunction(() => MKT.ventas.some(v => v.anulada) && !document.getElementById("modalBg").classList.contains("open"));
  r("Anular: conserva la venta y devuelve el stock (1 → 3)", await page.evaluate(() => MKT.ventas.find(v => v.total === 90000).anulada && MKT.productos.find(p => p.codigo === "TA0001").stock === 3));
  const saldoCom = await page.evaluate(() => DB.cashMovements.filter(m => m.origen === "comision_asociado").reduce((a, m) => a + (m.tipo === "ingreso" ? m.monto : -m.monto), 0));
  r("Anular con comisión cobrada: contramovimiento; quedan en caja solo los $6.750 (nada borrado)",
    saldoCom === 6750 && (await page.evaluate(() => DB.cashMovements.filter(m => m.origen === "comision_asociado").length)) === 3);
  ind = await leerInd();
  r("Indicadores después de anular: generadas, cobradas e ingresos efectivos $6.750", /Comisiones generadas ?\$6\.750/.test(ind) && /Ingresos efectivos por comisiones ?\$6\.750/.test(ind), ind.slice(0, 200));

  // Desactivar vendedor → desaparece de la tienda
  await page.click(".tab >> text=Vendedores");
  await page.click('.promo-item:has-text("Perfumes del Sol") >> text=Desactivar');
  await page.waitForFunction(() => !MKT.vendedores.find(v => v.nombre === "Perfumes del Sol").activo);
  await t.goto(BASE + "/index.html");
  await t.waitForSelector("#catalogo-productos .card");
  await t.waitForTimeout(800);
  r("Vendedor desactivado: la sección pública desaparece", await t.$eval("#asociadas", s => s.hidden));

  r("Sin errores de JavaScript", errores.length === 0, errores.join(" | "));
  console.log(`\nResultado: ${ok} correctas, ${mal} con falla.`);
  await browser.close();
  process.exit(mal ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
