// lib/supabase.js
// Cliente Supabase com service role — SOMENTE para uso no servidor.
// Ignora RLS, portanto toda rota que o usa precisa validar o usuário e
// filtrar por ele explicitamente. Use este módulo em vez de criar novos
// clients em cada arquivo.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

export default supabase;
