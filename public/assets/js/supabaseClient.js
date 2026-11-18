// Configuração PÚBLICA do Supabase usada pelo navegador (só para o Supabase Auth:
// recuperação e definição de senha). Único lugar com URL e chave — as páginas
// incluem este arquivo em vez de criar o client por conta própria.
//
// A anon/publishable key é pública por design: a proteção dos dados vem do RLS
// (supabase/migrations/002_lockdown_rls.sql). NUNCA coloque a service key aqui.
const SUPABASE_URL_PUBLICA = "https://vydjlbvscppiflvuzaiw.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_XjXcvDYGp8UDB0bnR3GRvw_cRNscPah";

window.supabaseClient = window.supabase.createClient(SUPABASE_URL_PUBLICA, SUPABASE_ANON_KEY);
