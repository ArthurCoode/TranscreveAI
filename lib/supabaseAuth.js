// lib/supabaseAuth.js
// Operações de login/cadastro em um client DESCARTÁVEL, criado por chamada.
//
// Motivo: signInWithPassword/signUp guardam a sessão do usuário dentro do
// client. Se isso acontecesse no client compartilhado de lib/supabase.js
// (service role), as próximas queries da mesma instância passariam a rodar
// com o token daquele usuário em vez da service role.
import { createClient } from '@supabase/supabase-js';

function clienteEfemero() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

// Retorna o usuário do Supabase Auth se email/senha estiverem corretos, ou null.
export async function verificarCredenciais(email, senha) {
  const { data, error } = await clienteEfemero().auth.signInWithPassword({ email, password: senha });
  if (error || !data?.user) return null;
  return data.user;
}

export async function cadastrarUsuario({ email, senha, nome }) {
  return clienteEfemero().auth.signUp({
    email,
    password: senha,
    options: {
      data: { nome },
      // o link de confirmação do e-mail leva de volta para o login do site
      emailRedirectTo: `${(process.env.PUBLIC_BASE_URL || 'https://www.transcreveia.com').replace(/\/+$/, '')}/login.html`,
    },
  });
}
