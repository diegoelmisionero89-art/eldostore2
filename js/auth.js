/* ==========================================================================
   ELDOSTORE CRM — Acceso administrativo (auth.js) — versión Supabase Auth

   El login real lo maneja Supabase Auth (email + contraseña). El usuario
   administrador se crea desde el panel de Supabase (Authentication > Users),
   no desde este código — así ninguna contraseña queda escrita en JavaScript.

   Supabase guarda la sesión (token) en el propio navegador de forma segura
   y la renueva sola; por eso isLoggedIn() consulta la sesión actual de
   Supabase en vez de una bandera propia.
   ========================================================================== */

async function getCurrentSession() {
  const { data, error } = await sb.auth.getSession();
  if (error) { console.error('Error obteniendo sesión', error); return null; }
  return data.session;
}

async function isLoggedIn() {
  const session = await getCurrentSession();
  return !!session;
}

async function login(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: traducirErrorAuth(error) };
  return { ok: true, session: data.session };
}

async function logout() {
  await sb.auth.signOut();
  location.reload();
}

/* Cambia la contraseña del usuario ya logueado. Supabase no pide la
   contraseña actual: la sesión activa ya prueba que sos vos. */
async function changePassword(nuevaPassword) {
  const { error } = await sb.auth.updateUser({ password: nuevaPassword });
  if (error) return { ok: false, error: traducirErrorAuth(error) };
  return { ok: true };
}

function traducirErrorAuth(error) {
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('invalid login credentials')) return 'Email o contraseña incorrectos.';
  if (msg.includes('email not confirmed')) return 'El email todavía no fue confirmado en Supabase.';
  if (msg.includes('password')) return 'La contraseña no cumple los requisitos mínimos (6 caracteres).';
  return error.message || 'Error de autenticación.';
}
