// pages/api/admin/metrics.js
// GET -> dados brutos usados pela aba "Métricas do Negócio" do painel.
// Devolve dados crus (não o MRR já calculado) para o front continuar controlando
// como exibe/agrupa — evita duplicar a lógica de negócio em dois lugares.
import { aplicarCors } from '../../../lib/cors';
import supabase from '../../../lib/supabase';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET')) return;

  const admin = await exigirAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido.' });

  const catorzeDiasAtras = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  const [assinaturasRes, usuariosRes, planosRes, checkoutsRes, transcricoesRes] = await Promise.all([
    supabase.from('assinaturas').select('*'),
    supabase.from('usuarios').select('id, criado_em'),
    supabase.from('planos').select('*'),
    supabase.from('checkouts_pendentes').select('id, email, ciclo, status, criado_em').order('criado_em', { ascending: false }).limit(15),
    supabase.from('transcricoes').select('criado_em').gte('criado_em', catorzeDiasAtras),
  ]);

  const comErro = [assinaturasRes, usuariosRes, planosRes, checkoutsRes, transcricoesRes].find((r) => r.error);
  if (comErro) return res.status(500).json({ erro: comErro.error.message });

  return res.status(200).json({
    ok: true,
    data: {
      assinaturas: assinaturasRes.data,
      usuarios: usuariosRes.data,
      planos: planosRes.data,
      checkoutsPendentes: checkoutsRes.data,
      transcricoes: transcricoesRes.data,
    },
  });
}