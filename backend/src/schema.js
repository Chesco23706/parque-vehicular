// La estructura de base de datos se administra en Supabase con el SQL del proyecto.
// Este hook se conserva para que el arranque del servidor siga siendo compatible.
export async function migrate() {
  return true;
}
