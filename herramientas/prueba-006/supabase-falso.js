/* Supabase SIMULADO para pruebas locales (herramientas/prueba-006/servidor.py).
   Lo carga el servidor de prueba en lugar de la librería real: las funciones rpc()
   se ejecutan en una base PostgreSQL descartable. No se usa en la tienda real. */
(function () {
  const ADMIN = "11111111-1111-1111-1111-111111111111";
  const enPanel = /admin\.html$/.test(location.pathname);
  const post = (ruta, cuerpo) => fetch(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo) }).then(r => r.json());
  function consulta(tabla) {
    let unico = false;
    const q = {
      select() { return q; }, order() { return q; }, range() { return q; }, eq() { return q; }, in() { return q; },
      maybeSingle() { unico = true; return q; }, single() { unico = true; return q; },
      insert() { return q; }, update() { return q; }, upsert() { return q; }, delete() { return q; },
      then(ok, mal) {
        return post("/__tabla", { tabla }).then(r => {
          const d = r.data || [];
          return unico ? { data: d[0] || null, error: null } : { data: d, error: r.error, count: d.length };
        }).then(ok, mal);
      }
    };
    return q;
  }
  window.supabase = {
    createClient() {
      return {
        rpc: (fn, args) => post("/__rpc", { fn, args: args || {}, panel: enPanel }),
        from: consulta,
        auth: {
          getSession: async () => ({ data: { session: enPanel ? { user: { id: ADMIN, email: "diego@prueba.local" } } : null }, error: null }),
          signInWithPassword: async () => ({ data: { session: { user: { id: ADMIN } } }, error: null }),
          signOut: async () => ({ error: null }), updateUser: async () => ({ error: null })
        },
        storage: {
          from() {
            return {
              upload: async nombre => { await post("/__subir", { nombre }); return { data: { path: nombre }, error: null }; },
              getPublicUrl: nombre => ({ data: { publicUrl: "https://fotos.prueba.invalid/" + nombre } })
            };
          }
        }
      };
    }
  };
})();
