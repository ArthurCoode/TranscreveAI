// pages/api/team/aceitar-convite.js
// POST { token } → o próprio convidado (logado) aceita o convite.
import crypto from 'crypto';
import supabase from '../../../lib/supabase';
import { autenticarReq } from '../../../lib/auth';
import { limitar } from '../../../lib/rateLimit';
import { normalizarEmail } from '../../../lib/assinaturas';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const auth = await autenticarReq(req, res);
  if (!auth) return;

  if (!limitar(req, res, { chave: `aceitar-convite:${auth.id}`, limite: 10, janelaMs: 10 * 60 * 1000 })) return;

  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  if (!token || token.length > 100) {
    return res.status(400).json({ error: 'Convite inválido' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { data: convite, error: conviteError } = await supabase
      .from('convites_time')
      .select('id, team_id, email, role, status, expira_em')
      .eq('token_hash', tokenHash)
      .maybeSingle();
    if (conviteError) throw conviteError;

    if (!convite || convite.status !== 'pendente') {
      return res.status(404).json({ error: 'Convite inválido ou já utilizado' });
    }
    if (new Date(convite.expira_em) < new Date()) {
      await supabase.from('convites_time').update({ status: 'expirado' }).eq('id', convite.id);
      return res.status(410).json({ error: 'Este convite expirou. Peça um novo ao administrador do time.' });
    }

    const { data: me, error: meError } = await supabase
      .from('usuarios')
      .select('id, email, team_id')
      .eq('id', auth.id)
      .maybeSingle();
    if (meError) throw meError;

    if (!me || normalizarEmail(me.email) !== normalizarEmail(convite.email)) {
      return res.status(403).json({ error: 'Este convite foi enviado para outro e-mail. Entre com a conta convidada.' });
    }
    if (me.team_id && String(me.team_id) !== String(convite.team_id)) {
      return res.status(409).json({ error: 'Você já faz parte de outro time. Saia dele antes de aceitar este convite.' });
    }

    const { error: updateError } = await supabase
      .from('usuarios')
      .update({ team_id: convite.team_id, role: convite.role })
      .eq('id', me.id);
    if (updateError) throw updateError;

    await supabase
      .from('convites_time')
      .update({ status: 'aceito', aceito_em: new Date().toISOString() })
      .eq('id', convite.id);

    return res.status(200).json({ success: true, mensagem: 'Convite aceito! Você agora faz parte do time.' });
  } catch (err) {
    console.error('ACEITAR CONVITE:', err);
    return res.status(500).json({ error: 'Não foi possível aceitar o convite.' });
  }
}
