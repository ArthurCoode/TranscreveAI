// pages/api/admin/planos.js
// GET -> lista todos os planos, usada pelo painel para mapear plano_id -> nome/limites
import { aplicarCors } from '../../../lib/cors';
import supabase from '../../../lib/supabase';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET')) return;

  const admin = await exigirAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });

  const { data, error } = await supabase.from('planos').select('*').order('ordem', { ascending: true });
  if (error) return res.status(500).json({ erro: error.message });
  return res.status(200).json({ ok: true, data });
}