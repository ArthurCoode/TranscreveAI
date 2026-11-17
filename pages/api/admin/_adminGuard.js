// pages/api/admin/_adminGuard.js
// Admin do SITE (painel /admin.html) — diferente do "admin de time".
// O critério é o plano definido em ADMIN_PLANO_ID, conferido no BANCO
// (não só no JWT), para que rebaixar alguém tenha efeito imediato.
import { autenticarReq } from '../../../lib/auth';
import supabase from '../../../lib/supabase';
import { idPlanoAdmin } from '../../../lib/planos';

export async function exigirAdmin(req, res) {
  const usuario = await autenticarReq(req, res);
  if (!usuario) return null; // autenticarReq já respondeu 401

  const planoAdmin = idPlanoAdmin();
  if (!planoAdmin) {
    res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
    return null;
  }

  const { data: perfil, error } = await supabase
    .from('usuarios')
    .select('plano_id, email')
    .eq('id', usuario.id)
    .maybeSingle();

  if (error || !perfil || perfil.plano_id !== planoAdmin) {
    res.status(403).json({ erro: 'Acesso restrito ao administrador.' });
    return null;
  }

  return { ...usuario, email: perfil.email };
}
