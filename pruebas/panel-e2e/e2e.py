"""Prueba de punta a punta del panel contra Postgres local (SOLO LOCAL)."""
import subprocess, json, sys, time
from playwright.sync_api import sync_playwright
BASE = 'http://127.0.0.1:8765'
DIEGO = '00000000-0000-0000-0000-00000000d1e9'; NIKO = '22222222-2222-2222-2222-222222222222'; AYE = '33333333-3333-3333-3333-333333333333'
ok = []; mal = []
def check(nombre, cond, extra=''):
    (ok if cond else mal).append(nombre); print(('OK   ' if cond else 'FALLA ') + nombre + (f'  [{extra}]' if extra and not cond else ''))
def sql(db, q):
    return subprocess.run(['psql', '-h', '/home/postgres/pgtest', '-p', '5499', '-U', 'postgres', '-d', db, '-XtAq', '-c', q], capture_output=True, text=True).stdout.strip()

def abrir(p, db, uid, email):
    ctx = p.chromium.launch().new_context(viewport={'width': 1300, 'height': 900})
    ctx.add_init_script(f"localStorage.setItem('fake_db','{db}');localStorage.setItem('fake_uid','{uid}');localStorage.setItem('fake_email','{email}');")
    ctx.route('**/@supabase/supabase-js@2', lambda r: r.fulfill(path=__import__('os').path.join(__import__('os').path.dirname(__file__),'fake-supabase.js'), content_type='text/javascript'))
    ctx.route('**/*supabase.co/**', lambda r: r.abort())
    page = ctx.new_page(); errores = []
    page.on('pageerror', lambda e: errores.append(str(e)))
    page.on('dialog', lambda d: d.accept(page.dialog_respuesta) if d.type == 'prompt' else d.accept())
    page.dialog_respuesta = ''
    page.goto(BASE + '/admin.html'); page.wait_for_timeout(1500)
    return ctx, page, errores
def ir(page, vista): page.click(f'.nav-item[data-view="{vista}"]'); page.wait_for_timeout(400)
def toast(page): return page.inner_text('#toast')

with sync_playwright() as p:
    # ===================== MODO ANTERIOR (base sin migrar) =====================
    print('\n== Base SIN migrar (el panel tiene que funcionar como hoy)')
    ctx, page, err = abrir(p, 'eldo_legacy', DIEGO, 'diego@prueba.local')
    check('L1 carga sin errores de JavaScript', not err and 'No se pudo conectar' not in page.inner_text('body'), err)
    check('L2 no aparece el menú Cuentas', not page.is_visible('.nav-item[data-view="cuentas"]'))
    check('L3 body sin modo-cuentas', 'modo-cuentas' not in (page.get_attribute('body', 'class') or ''))
    ir(page, 'productos')
    check('L4 lista los 3 productos', page.locator('#prodTableBody tr').count() == 3)
    check('L5 columna Cuenta oculta', not page.locator('th:has-text("Cuenta")').first.is_visible())
    antes = int(sql('eldo_legacy', 'select count(*) from sales'))
    ir(page, 'ventas'); page.click('text=+ Registrar venta'); page.wait_for_timeout(300)
    check('L6 sin selector "¿Quién cobró?"', page.locator('#v_holder').count() == 0)
    page.check('input[name="v_modalidad"][value="propia"]')
    page.select_option('#v_producto', label=None, index=0) if False else None
    page.click('text=+ Agregar ítem'); page.fill('#v_metodoPago', 'Efectivo'); page.click('#saveSaleBtn'); page.wait_for_timeout(1000)
    check('L7 registra venta con funciones v2', int(sql('eldo_legacy', 'select count(*) from sales')) == antes + 1, toast(page))
    ir(page, 'caja')
    check('L8 botones de caja manual visibles', page.is_visible('text=+ Ingreso manual'))
    check('L9 sin errores al final', not err, err)
    page.screenshot(path='e2e_legacy_caja.png', full_page=True); ctx.close()

    # ===================== MODO TRES CUENTAS (base migrada) =====================
    DB = 'eldo_prueba_local'
    print('\n== Base migrada: Niko antes de ser autorizado')
    check('A1 al migrar solo el administrador queda habilitado',
          sql(DB, "select string_agg(nombre||':'||es_admin, ',') from app_users") == 'diego@prueba.local:true')
    ctx, page, err = abrir(p, DB, NIKO, 'niko@prueba.local')
    check('A2 Niko sin autorizar ve el aviso y no entra', 'no está habilitado' in page.inner_text('.content'))
    r = page.evaluate("sb.rpc('vincular_usuario',{p_email:'niko@prueba.local',p_holder_id:null,p_activo:true}).then(x=>x.error&&x.error.message)")
    check('A3 Niko no puede autorizarse a sí mismo', bool(r) and sql(DB, f"select count(*) from app_users where user_id='{NIKO}'") == '0', r)
    ctx.close()

    print('\n== Base migrada, usuario Diego (administrador)')
    ctx, page, err = abrir(p, DB, DIEGO, 'diego@prueba.local')
    check('C1 carga sin errores de JavaScript', not err and 'No se pudo conectar' not in page.inner_text('body'), err)
    check('C2 aparece el menú Cuentas', page.is_visible('.nav-item[data-view="cuentas"]'))
    check('C3 dashboard muestra saldo por cuenta', page.locator('#dashCuentas .kpi').count() == 3)
    # producto nuevo de Niko
    ir(page, 'productos'); page.click('text=+ Nuevo producto'); page.wait_for_timeout(300)
    page.fill('#f_codigo', 'NK01'); page.fill('#f_nombre', 'Auriculares de Niko'); page.fill('#f_costo', '2000')
    page.fill('#f_precio', '5000'); page.fill('#f_stock', '4')
    page.select_option('#f_owner', label='Niko'); page.click('#saveProductBtn'); page.wait_for_timeout(1000)
    check('C4 producto creado con dueño Niko',
          sql(DB, "select a.codigo from products p join accounts a on a.id=p.owner_account_id where p.codigo='NK01'") == 'niko', toast(page))
    # venta mixta: H01 (ELDOSTORE) + NK01 (Niko), cobra Ayelen
    ir(page, 'ventas'); page.click('text=+ Registrar venta'); page.wait_for_timeout(300)
    check('C5 selector "¿Quién cobró?" presente', page.locator('#v_holder').count() == 1)
    page.check('input[name="v_modalidad"][value="propia"]')
    page.select_option('#v_producto', label='H01 — Producto histórico 1') if page.locator('#v_producto option', has_text='H01').count() and False else None
    opt = lambda txt: page.eval_on_selector('#v_producto', f"s => [...s.options].find(o => o.text.includes('{txt}')).value")
    page.select_option('#v_producto', opt('H01')); page.click('text=+ Agregar ítem')
    page.select_option('#v_producto', opt('NK01')); page.fill('#v_cantidad', '2'); page.click('text=+ Agregar ítem')
    page.select_option('#v_holder', label='Ayelen'); page.fill('#v_metodoPago', 'Transferencia')
    resumen = page.inner_text('#v_resumen')
    check('C6 resumen separa por cuenta', 'ELDOSTORE: ventas' in resumen and 'Niko: ventas' in resumen, resumen)
    page.click('#saveSaleBtn'); page.wait_for_timeout(1200)
    asig = sql(DB, """select string_agg(a.codigo||':'||trim_scale(sa.total)||'/'||trim_scale(sa.ganancia), ',' order by a.codigo) from sale_allocations sa
                     join accounts a on a.id=sa.account_id where sa.sale_id=(select id from sales order by fecha desc limit 1)""")
    check('C7 venta repartida ELDOSTORE 10000/5000 y Niko 10000/6000', asig == 'eldostore:10000/5000,niko:10000/6000', asig)
    caja = sql(DB, """select string_agg(a.codigo||':'||h.codigo||':'||trim_scale(c.monto), ',' order by a.codigo) from cash_movements c join accounts a on a.id=c.account_id
                     join cash_holders h on h.id=c.holder_id where c.ref_id=(select id from sales order by fecha desc limit 1)""")
    check('C8 caja: cada cuenta su importe, en manos de Ayelen', caja == 'eldostore:ayelen:10000,niko:ayelen:10000', caja)
    check('C9 lista de ventas muestra "Cobró: Ayelen"', 'Cobró: Ayelen' in page.inner_text('#view-ventas'))
    # gasto compartido
    ir(page, 'gastos'); page.click('text=+ Registrar gasto') if page.locator('text=+ Registrar gasto').count() else page.click('#view-gastos .btn-primary')
    page.wait_for_timeout(300)
    page.fill('#g_descripcion', 'Publicidad compartida'); page.fill('#g_importe', '3000')
    page.click('text=Partes iguales')
    check('C10 reparto en partes iguales suma el total', 'Reparto completo' in page.inner_text('#g_repartoEstado'), page.inner_text('#g_repartoEstado'))
    parte = lambda c: page.locator(f".g_parte[data-account='{sql(DB, f"select id from accounts where codigo='{c}'")}']")
    check('C10b orden de cuentas fijo: ELDOSTORE, Niko, Ayelen', page.eval_on_selector_all('.reparto-fila > div:first-child', 'e => e.map(x => x.textContent).join(",")') == 'ELDOSTORE,Niko,Ayelen')
    parte('eldostore').fill('1000'); parte('niko').fill('500'); parte('ayelen').fill('0')
    page.click('#saveExpenseBtn'); page.wait_for_timeout(500)
    check('C11 bloquea partes que no suman el total', 'tienen que coincidir' in toast(page), toast(page))
    parte('niko').fill('2000'); page.click('#saveExpenseBtn'); page.wait_for_timeout(1000)
    partes = sql(DB, """select string_agg(a.codigo||':'||ea.importe, ',' order by a.codigo) from expense_allocations ea join accounts a on a.id=ea.account_id
                       where ea.expense_id=(select id from expenses where descripcion='Publicidad compartida')""")
    check('C12 gasto repartido ELDOSTORE 1000 / Niko 2000', partes == 'eldostore:1000,niko:2000', partes)
    # caja: filtros y liquidación
    ir(page, 'caja')
    check('C13 botones manuales ocultos y "Movimiento entre cuentas" visible',
          not page.is_visible('text=+ Ingreso manual') and page.is_visible('#view-caja >> text=+ Movimiento entre cuentas'))
    page.click('#view-caja >> text=+ Movimiento entre cuentas'); page.wait_for_timeout(300)
    page.select_option('#tr_tipo', 'liquidacion')
    page.select_option('#tr_fromAccount', label='Niko'); page.select_option('#tr_fromHolder', label='Ayelen')
    page.select_option('#tr_toAccount', label='Niko'); page.select_option('#tr_toHolder', label='Niko')
    page.fill('#tr_monto', '10000'); page.fill('#tr_motivo', 'Ayelen le entrega a Niko lo cobrado'); page.click('#saveTransferBtn'); page.wait_for_timeout(1000)
    pos = sql(DB, """select string_agg(h.codigo||':'||trim_scale(sum), ',' order by h.codigo) from (select holder_id, sum(case when tipo='ingreso' then monto else -monto end)
                    from cash_movements where account_id=(select id from accounts where codigo='niko') group by holder_id) x join cash_holders h on h.id=x.holder_id""")
    check('C14 liquidación: el dinero de Niko pasa de Ayelen a Niko', pos == 'ayelen:0,diego:-2000,niko:10000', pos)
    page.select_option('#cajaCuentaFilter', label='Niko'); page.wait_for_timeout(300)
    filas = page.locator('#cajaTableBody tr').count()
    check('C15 filtro de caja por cuenta', filas == int(sql(DB, "select count(*) from cash_movements where account_id=(select id from accounts where codigo='niko')")), filas)
    # vista Cuentas
    ir(page, 'cuentas'); page.wait_for_timeout(1000)
    txt = page.inner_text('#view-cuentas')
    check('C16 vista Cuentas con 3 tarjetas', page.locator('#ctaResumen .cuenta-card').count() == 3, txt[:200])
    check('C17 matriz de posiciones', page.locator('#ctaPosiciones tbody tr').count() == 4)
    check('C18 lista la liquidación', 'Liquidación' in page.inner_text('#ctaTransfers'))
    page.screenshot(path='e2e_cuentas.png', full_page=True)
    page.dialog_respuesta = 'Prueba de anulación'
    page.click('#ctaTransfers >> text=Anular'); page.wait_for_timeout(1200)
    check('C19 anula la liquidación', sql(DB, "select bool_and(anulada) from account_transfers") == 't')
    # anular la venta mixta
    ir(page, 'ventas'); page.dialog_respuesta = 'Prueba de anulación de venta'
    page.locator('#view-ventas button', has_text='Anular').first.click(); page.wait_for_timeout(1500)
    check('C20 anula la venta mixta y devuelve stock', sql(DB, "select stock from products where codigo='NK01'") == '4', toast(page))
    # stock con motivo y cambio de dueño
    # usuarios
    ir(page, 'config'); page.wait_for_timeout(300)
    check('C21 panel de usuarios lista a Diego como administrador',
          'diego@prueba.local' in page.inner_text('#cfgUsuarios') and 'administrador' in page.inner_text('#cfgUsuarios'))
    check('C21b el administrador ve el formulario de accesos', page.is_visible('#cfgAdminForm'))
    page.fill('#cfgEmail', 'niko@prueba.local'); page.select_option('#cfgHolder', label='Niko'); page.click('text=Agregar / actualizar usuario'); page.wait_for_timeout(1000)
    check('C22 vincula a Niko', sql(DB, f"select h.codigo from app_users u join cash_holders h on h.id=u.holder_id where u.user_id='{NIKO}'") == 'niko', toast(page))
    check('C23 sin errores de JavaScript', not err, err)
    page.screenshot(path='e2e_config.png', full_page=True); ctx.close()

    print('\n== Usuaria no vinculada (Ayelen)')
    ctx, page, err = abrir(p, DB, AYE, 'ayelen@prueba.local')
    check('C24 ve el aviso de usuario no habilitado', 'no está habilitado' in page.inner_text('.content'))
    check('C25 la base rechaza sus operaciones',
          'no' in json.dumps(page.evaluate("sb.rpc('register_transfer',{p_tipo:'aporte',p_from_account:null,p_from_holder:null,p_to_account:null,p_to_holder:null,p_monto:1,p_motivo:'x'})")).lower())
    ctx.close()

    print('\n== Niko recién vinculado (no administrador)')
    ctx, page, err = abrir(p, DB, NIKO, 'niko@prueba.local')
    ir(page, 'config')
    check('C29 Niko no ve el formulario de accesos', not page.is_visible('#cfgAdminForm') and page.is_visible('#cfgSoloAdmin'))
    aye_h = sql(DB, "select id from cash_holders where codigo='ayelen'")
    r = page.evaluate(f"sb.rpc('vincular_usuario',{{p_email:'ayelen@prueba.local',p_holder_id:'{aye_h}',p_activo:true}}).then(x=>x.error&&x.error.message)")
    check('C30 Niko no puede habilitar a Ayelen', bool(r) and sql(DB, f"select count(*) from app_users where user_id='{AYE}'") == '0', r)
    r = page.evaluate("sb.from('app_users').update({es_admin:true}).eq('user_id','" + NIKO + "').then(x=>x.error&&x.error.message)")
    check('C31 Niko no puede darse permisos de administrador', sql(DB, f"select es_admin from app_users where user_id='{NIKO}'") == 'f', r)
    r = page.evaluate("sb.rpc('void_sale',{p_sale_id:'00000000-0000-0000-0000-000000000000',p_motivo:'x'}).then(x=>x.error&&x.error.message)")
    check('C32 las funciones v2 no se llaman directo desde el navegador', bool(r) and 'permission' in r.lower(), r)
    ir(page, 'ventas'); page.click('text=+ Registrar venta'); page.wait_for_timeout(300)
    check('C26 "¿Quién cobró?" por defecto es Niko', page.eval_on_selector('#v_holder', 's => s.options[s.selectedIndex].text') == 'Niko')
    check('C27 sin errores de JavaScript', not err, err)
    page.set_viewport_size({'width': 390, 'height': 844}); page.keyboard.press('Escape')
    page.goto(BASE + '/admin.html'); page.wait_for_timeout(1500)
    page.evaluate("switchView('cuentas')"); page.wait_for_timeout(1200)
    check('C28 móvil: sin desborde horizontal', page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    page.screenshot(path='e2e_cuentas_movil.png', full_page=True)
    ctx.close()

print(f'\nResultado: {len(ok)} correctas, {len(mal)} con falla')
for m in mal: print('  -', m)
