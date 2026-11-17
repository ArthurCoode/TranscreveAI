// pages/api/admin/logs.js
// GET  -> lista logs_admin com filtros opcionais (?tipo=, ?nivel=, ?q=)
// POST -> registra uma nova entrada de log (usada pelas outras rotas/módulos admin)
import { aplicarCors } from '../../../lib/cors';
import supabase from '../../../lib/supabase';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, POST')) return;

  const admin = await exigirAdmin(req, res);
  if (!admin) return;

  if (req.method === 'GET') {
    const { tipo, nivel, q } = req.query;
    let query = supabase.from('logs_admin').select('*').order('criado_em', { ascending: false }).limit(100);
    if (tipo && tipo !== 'all') query = query.eq('tipo', tipo);
    if (nivel && nivel !== 'all') query = query.eq('nivel', nivel);
    if (q) query = query.ilike('descricao', `%${q}%`);

    const { data, error } = await query;
    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ok: true, data });
  }

  if (req.method === 'POST') {
    const { descricao, categoria, usuario_id, nivel, metadata } = req.body || {};
    if (!descricao) return res.status(400).json({ erro: 'descricao é obrigatória.' });

    const { error } = await supabase.from('logs_admin').insert([
      {
        tipo: 'acao_admin',
        categoria: categoria || null,
        descricao,
        usuario_id: usuario_id || null,
        admin_email: admin.email || null, // agora vem do token verificado no servidor, não do front
        nivel: nivel || 'info',
        metadata: metadata || null,
      },
    ]);

    if (error) return res.status(500).json({ erro: error.message });
    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}