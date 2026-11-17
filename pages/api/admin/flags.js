// pages/api/admin/flags.js
// GET   -> lista feature flags
// POST  -> cria uma nova flag
// PATCH -> alterna ativo_global de uma flag
import { aplicarCors } from '../../../lib/cors';
import supabase from '../../../lib/supabase';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, POST, PATCH')) return;

  const admin = await exigirAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('feature_flags').select('*').order('criado_em', { ascending: false });
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ok: true, data });
  }

  if (req.method === 'POST') {
    const { chave, nome, descricao } = req.body || {};
    if (!chave || !nome) return res.status(400).json({ erro: 'chave e nome são obrigatórios.' });

    const { error } = await supabase
      .from('feature_flags')
      .insert([{ chave, nome, descricao: descricao || null, ativo_global: false }]);

    if (error) return res.status(500).json({ erro: error.message });

    await supabase.from('logs_admin').insert([{
      tipo: 'acao_admin', categoria: 'feature_flag', nivel: 'info',
      descricao: `Feature flag criada: "${chave}"`, admin_email: admin.email || null,
    }]);

    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const { id, ativo_global } = req.body || {};
    if (!id || ativo_global === undefined) {
      return res.status(400).json({ erro: 'id e ativo_global são obrigatórios.' });
    }

    const { data, error } = await supabase
      .from('feature_flags')
      .update({ ativo_global, atualizado_em: new Date().toISOString() })
      .eq('id', id)
      .select();

    if (error) return res.status(500).json({ erro: error.message });
    if (!data || !data.length) return res.status(404).json({ erro: 'Flag não encontrada.' });

    await supabase.from('logs_admin').insert([{
      tipo: 'acao_admin', categoria: 'feature_flag', nivel: 'warning',
      descricao: `Flag "${data[0].chave}" ${ativo_global ? 'ativada' : 'desativada'} globalmente`,
      admin_email: admin.email || null,
    }]);

    return res.status(200).json({ ok: true, data: data[0] });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}