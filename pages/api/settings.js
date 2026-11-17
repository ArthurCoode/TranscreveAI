// pages/api/settings.js
// GET/PUT do perfil (variante usada por telas antigas). Usa a mesma
// autenticação de todas as rotas — antes chamava supabase.auth.getUser()
// com o JWT próprio do site, o que nunca funcionava.
import supabase from '../../lib/supabase';
import { autenticarReq } from '../../lib/auth';
import { aplicarCors } from '../../lib/cors';
import { validarAtualizacaoPerfil } from '../../lib/perfil';

const CAMPOS_PERFIL = 'id, nome, email, plano, plano_id, avatar_url, criado_em, role, fim_ciclo';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, PUT')) return;

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('usuarios')
        .select(CAMPOS_PERFIL)
        .eq('id', usuario.id)
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, perfil: data });
    }

    if (req.method === 'PUT') {
      const { erro, atualizacao } = validarAtualizacaoPerfil(req.body || {});
      if (erro) return res.status(400).json({ erro });

      const { data, error } = await supabase
        .from('usuarios')
        .update({ ...atualizacao, updated_at: new Date().toISOString() })
        .eq('id', usuario.id)
        .select(CAMPOS_PERFIL)
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, perfil: data });
    }

    return res.status(405).json({ erro: 'Método não permitido' });
  } catch (err) {
    console.error('Erro em /api/settings:', err);
    return res.status(500).json({ erro: 'Erro interno' });
  }
}
