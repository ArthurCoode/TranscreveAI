// pages/api/admin/listar-transcricoes.js
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });

  const admin = await exigirAdmin(req, res);
  if (!admin) return;

  const busca = (req.query.q || '').trim();

  let query = supabaseAdmin
    .from('transcricoes')
    .select('id, nome, data, hora_inicio, usuario_id, criado_em, sentimento, tem_risco_cancelamento')
    .order('criado_em', { ascending: false })
    .limit(20);

  if (busca) {
    // busca por id exato (uuid) ou por nome (parcial, case-insensitive)
    const pareceUuid = /^[0-9a-f-]{36}$/i.test(busca);
    query = pareceUuid ? query.eq('id', busca) : query.ilike('nome', `%${busca}%`);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ erro: error.message });

  return res.status(200).json({ ok: true, transcricoes: data || [] });
}