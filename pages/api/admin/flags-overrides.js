// pages/api/admin/flags-overrides.js
// GET    ?flag_id=...        -> lista overrides de uma flag (com nome/email do usuário)
// POST   { flag_id, email, ativo } -> adiciona/atualiza override para um usuário (por email)
// DELETE ?id=...             -> remove um override
import { aplicarCors } from '../../../lib/cors';
import supabase from '../../../lib/supabase';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, POST, DELETE')) return;

  const admin = await exigirAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const { flag_id } = req.query;
    if (!flag_id) return res.status(400).json({ erro: 'flag_id é obrigatório.' });

    const { data, error } = await supabase
      .from('feature_flags_usuario')
      .select('id, ativo, usuario_id, usuarios(nome, email)')
      .eq('flag_id', flag_id);

    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ok: true, data });
  }

  if (req.method === 'POST') {
    const { flag_id, email, ativo } = req.body || {};
    if (!flag_id || !email) return res.status(400).json({ erro: 'flag_id e email são obrigatórios.' });

    const { data: usuario, error: userErr } = await supabase
      .from('usuarios')
      .select('id')
      .eq('email', email)
      .single();

    if (userErr || !usuario) return res.status(404).json({ erro: 'Usuário não encontrado com esse email.' });

    const { error } = await supabase
      .from('feature_flags_usuario')
      .upsert([{ flag_id, usuario_id: usuario.id, ativo: !!ativo }], { onConflict: 'flag_id,usuario_id' });

    if (error) return res.status(500).json({ erro: error.message });

    await supabase.from('logs_admin').insert([{
      tipo: 'acao_admin', categoria: 'feature_flag', usuario_id: usuario.id,
      descricao: `Override de flag adicionado para ${email} (${ativo ? 'ligado' : 'desligado'})`,
      admin_email: admin.email || null,
    }]);

    return res.status(200).json({ ok: true, usuario_id: usuario.id });
  }

  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ erro: 'id é obrigatório.' });

    const { error } = await supabase.from('feature_flags_usuario').delete().eq('id', id);
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}