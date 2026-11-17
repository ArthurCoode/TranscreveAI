// pages/api/team/remove.js
// DELETE { id } → remove um membro do time. Exclusivo para admin do time.
import supabase from '../../../lib/supabase';
import { autenticarReq } from '../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const auth = await autenticarReq(req, res);
  if (!auth) return;

  const { id } = req.body || {};
  if (!id) return res.status(400).json({ error: 'ID obrigatório' });

  try {
    const { data: me, error: meError } = await supabase
      .from('usuarios')
      .select('id, team_id, role')
      .eq('id', auth.id)
      .maybeSingle();
    if (meError) throw meError;

    if (!me?.team_id) {
      return res.status(403).json({ error: 'Você não pertence a nenhum time' });
    }
    if ((me.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores do time podem remover membros' });
    }
    if (id === me.id) {
      return res.status(400).json({ error: 'Você não pode remover a si mesmo' });
    }

    const { data: member, error: memberError } = await supabase
      .from('usuarios')
      .select('id, team_id')
      .eq('id', id)
      .maybeSingle();
    if (memberError) throw memberError;

    if (!member || member.team_id !== me.team_id) {
      return res.status(404).json({ error: 'Membro não encontrado' });
    }

    const { error: updateError } = await supabase
      .from('usuarios')
      .update({ team_id: null, role: 'viewer' })
      .eq('id', id)
      .eq('team_id', me.team_id);
    if (updateError) throw updateError;

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('TEAM REMOVE:', err);
    return res.status(500).json({ error: 'Não foi possível remover o membro.' });
  }
}
