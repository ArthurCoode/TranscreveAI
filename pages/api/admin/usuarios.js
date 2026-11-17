// pages/api/admin/usuarios.js
// GET  -> lista usuários + histórico de assinaturas de cada um
// PUT  -> atualiza status ('ACTIVE' | 'SUSPENDED' | 'LIMIT_REACHED') e/ou plano_id de um usuário
import { aplicarCors } from '../../../lib/cors';
import supabase from '../../../lib/supabase';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, PUT')) return;

  // Antes: essa rota checava `usuario.email !== ADMIN_EMAIL` na unha, diferente do
  // critério usado pelo middleware.js (plano_id). Unificado para usar exigirAdmin,
  // que é a mesma checagem usada em /admin.html — evita as duas fontes de verdade
  // ficarem dessincronizadas.
  const admin = await exigirAdmin(req, res);
  if (!admin) return; // exigirAdmin já respondeu 401/403

  if (req.method === 'GET') {
    const { data: usuarios, error } = await supabase
      .from('usuarios')
      .select('*')
      .order('criado_em', { ascending: false })
      .limit(200);

    if (error) return res.status(500).json({ erro: error.message });

    const userIds = (usuarios || []).map((u) => u.id);
    let assinaturasPorUser = {};
    if (userIds.length) {
      const { data: assinaturas, error: errAssin } = await supabase
        .from('assinaturas')
        .select('*')
        .in('user_id', userIds)
        .order('criado_em', { ascending: false });

      if (errAssin) return res.status(500).json({ erro: errAssin.message });

      (assinaturas || []).forEach((a) => {
        if (!assinaturasPorUser[a.user_id]) assinaturasPorUser[a.user_id] = [];
        assinaturasPorUser[a.user_id].push(a);
      });
    }

    const resultado = (usuarios || []).map((u) => ({
      ...u,
      assinaturas: assinaturasPorUser[u.id] || [],
    }));

    return res.status(200).json({ ok: true, data: resultado });
  }

  if (req.method === 'PUT') {
    const { id, status, plano_id } = req.body || {};
    if (!id) return res.status(400).json({ erro: 'ID obrigatório.' });
    if (status === undefined && plano_id === undefined) {
      return res.status(400).json({ erro: 'Informe status e/ou plano_id.' });
    }

    const STATUS_VALIDOS = ['ACTIVE', 'SUSPENDED', 'LIMIT_REACHED'];
    if (status !== undefined && !STATUS_VALIDOS.includes(status)) {
      return res.status(400).json({ erro: `status inválido. Use um de: ${STATUS_VALIDOS.join(', ')}` });
    }

    const updates = {};
    if (status !== undefined) updates.status = status;
    if (plano_id !== undefined) updates.plano_id = plano_id;

    const { data, error } = await supabase
      .from('usuarios')
      .update(updates)
      .eq('id', id)
      .select();

    if (error) return res.status(500).json({ erro: error.message });
    if (!data || data.length === 0) return res.status(404).json({ erro: 'Usuário não encontrado.' });

    if (status !== undefined) {
      await supabase.from('logs_admin').insert([{
        tipo: 'acao_admin', categoria: 'usuario', usuario_id: id,
        nivel: status === 'SUSPENDED' ? 'warning' : 'info',
        descricao: `Status do usuário alterado para "${status}"`,
        admin_email: admin.email || null,
      }]);
    }
    if (plano_id !== undefined) {
      await supabase.from('logs_admin').insert([{
        tipo: 'acao_admin', categoria: 'usuario', usuario_id: id, nivel: 'warning',
        descricao: `Plano alterado manualmente (override) para plano_id ${plano_id}`,
        admin_email: admin.email || null,
      }]);
    }

    return res.status(200).json({ ok: true, data: data[0] });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}