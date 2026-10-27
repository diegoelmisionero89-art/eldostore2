/* ==========================================================================
   ELDOSTORE CRM — Conexión a Supabase (supabase-config.js)

   ANTES DE USAR: reemplazá los dos valores de abajo por los de tu proyecto.
   Dónde encontrarlos: Supabase → proyecto ELDOSTORE → Project Settings →
   API Keys (o "Data API").
     - SUPABASE_URL: "Project URL" (https://xxxxx.supabase.co)
     - SUPABASE_PUBLISHABLE_KEY: la clave "publishable" (sb_publishable_...)
       o, en proyectos viejos, la "anon public".

   La publishable/anon key está pensada para ir en el navegador. La
   seguridad real la dan las políticas RLS (ver data/schema-supabase.sql).

   NUNCA pongas acá la clave "service_role" ni la "secret" (sb_secret_...).
   ========================================================================== */

const SUPABASE_URL = 'https://vahzvjhrtnfcjfrmwbol.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_KRkiaaG_AGTo-oWI1OB16A_T8AfrvFQ';

// Instancia del cliente de Supabase, usada por auth.js y db.js.
// (se llama "sb" para no pisar el objeto global "supabase" que expone la librería)
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
