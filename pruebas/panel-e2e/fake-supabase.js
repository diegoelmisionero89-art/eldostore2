/* SOLO PARA PRUEBAS LOCALES: reemplaza supabase-js por un puente a Postgres local. */
(function () {
  const uid = () => localStorage.getItem('fake_uid');
  async function call(body) {
    const r = await fetch('/bridge', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Db': localStorage.getItem('fake_db') || '' },
      body: JSON.stringify({ ...body, uid: uid() }) });
    return r.json();
  }
  class Q {
    constructor(t) { this.b = { table: t, op: 'select', filters: [], order: [], cols: '*' }; }
    select(cols, opt) { if (this.b.op === 'select') this.b.op = 'select'; this.b.returning = true; if (opt && opt.count) this.b.count = true; return this; }
    insert(p) { this.b.op = 'insert'; this.b.payload = p; return this; }
    upsert(p, o) { this.b.op = 'upsert'; this.b.payload = p; this.b.onConflict = o && o.onConflict; this.b.ignore = o && o.ignoreDuplicates; return this; }
    update(p) { this.b.op = 'update'; this.b.payload = p; return this; }
    delete() { this.b.op = 'delete'; return this; }
    eq(c, v) { this.b.filters.push([c, v]); return this; }
    order(c, o) { this.b.order.push([c, !o || o.ascending !== false]); return this; }
    range(a, z) { this.b.range = [a, z]; return this; }
    single() { this.b.single = 'single'; return this; }
    maybeSingle() { this.b.single = 'maybe'; return this; }
    then(res, rej) { return call(this.b).then(res, rej); }
  }
  window.supabase = { createClient: () => ({
    from: t => new Q(t),
    rpc: (fn, args) => call({ rpc: fn, args: args || {} }),
    auth: {
      getSession: async () => ({ data: { session: uid() ? { user: { id: uid(), email: localStorage.getItem('fake_email') } } : null }, error: null }),
      signInWithPassword: async ({ email }) => { const r = await call({ login: email }); if (r.error) return { data: {}, error: r.error };
        localStorage.setItem('fake_uid', r.data); localStorage.setItem('fake_email', email); return { data: { session: { user: { id: r.data } } }, error: null }; },
      signOut: async () => { localStorage.removeItem('fake_uid'); return { error: null }; },
      updateUser: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    storage: { from: () => ({ upload: async () => ({ error: { message: 'storage no simulado' } }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) }
  }) };
})();
