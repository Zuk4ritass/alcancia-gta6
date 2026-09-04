// Configuración de la Alcancía VI
// ---------------------------------
// 1. Crea un proyecto gratis en https://supabase.com
// 2. Ejecuta el archivo supabase/schema.sql en el SQL Editor del proyecto
// 3. Copia aquí la URL del proyecto y la "anon public" key (Settings → API)
//
// Mientras SUPABASE_URL esté vacío, la página funciona en MODO DEMO:
// todo se guarda solo en el navegador de cada persona.

window.ALCANCIA_CONFIG = {
  SUPABASE_URL: 'https://rrxdbxobogowrgoolewm.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_UmHe89LU4xD-d2HVuDe68g_TvwCpn0W',

  // Precio del juego en pesos colombianos (meta fija para todo el grupo)
  META_COP: 430000,

  // Fecha estimada de lanzamiento (cada alcancía puede cambiar la suya)
  FECHA_META_DEFAULT: '2027-02-01',
};
