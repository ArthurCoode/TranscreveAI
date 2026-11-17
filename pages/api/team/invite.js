// pages/api/team/invite.js
// POST { email, role } → cria um convite pendente e envia por e-mail.
//
// Regras:
// - Só admin do time pode convidar.
// - O convidado só entra no time quando ELE aceitar (/api/team/aceitar-convite),
//   logado na própria conta. Ninguém é colocado num time sem consentimento.
// - A resposta é a mesma exista ou não conta com esse e-mail (evita
//   descobrir quais e-mails são clientes).
import crypto from 'crypto';
import supabase from '../../../lib/supabase';
import { autenticarReq } from '../../../lib/auth';
import { limitar } from '../../../lib/rateLimit';
import { enviarEmailConviteTime } from '../../../lib/email';
import { normalizarEmail, EMAIL_RE, urlBase } from '../../../lib/assinaturas';

const ROLES_VALIDOS = ['viewer', 'editor', 'admin'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  const auth = await autenticarReq(req, res);
  if (!auth) return;

  if (!limitar(req, res, { chave: `invite:${auth.id}`, limite: 20, janelaMs: 60 * 60 * 1000 })) return;

  const email = normalizarEmail(req.body?.email);
  const role = req.body?.role || 'viewer';

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }
  if (!ROLES_VALIDOS.includes(role)) {
    return res.status(400).json({ error: 'Função inválida' });
  }

  try {
    const { data: me, error: meError } = await supabase
      .from('usuarios')
      .select('id, nome, email, team_id, role')
      .eq('id', auth.id)
      .maybeSingle();
    if (meError) throw meError;

    if (!me?.team_id) {
      return res.status(403).json({ error: 'Você não pertence a nenhum time' });
    }
    if ((me.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ error: 'Apenas administradores do time podem convidar membros' });
    }
    if (normalizarEmail(me.email) === email) {
      return res.status(400).json({ error: 'Você já faz parte deste time' });
    }

    // cancela convites pendentes anteriores para o mesmo e-mail/time
    await supabase
      .from('convites_time')
      .update({ status: 'cancelado' })
      .eq('team_id', String(me.team_id))
      .eq('email', email)
      .eq('status', 'pendente');

    const token = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const { error: insertError } = await supabase.from('convites_time').insert({
      team_id: String(me.team_id),
      email,
      role,
      token_hash: tokenHash,
      convidado_por: me.id,
    });
    if (insertError) throw insertError;

    await enviarEmailConviteTime({
      email,
      nomeQuemConvidou: me.nome || me.email,
      linkAceite: `${urlBase()}/dashboard.html?convite=${token}`,
    });

    return res.status(200).json({
      success: true,
      mensagem: 'Convite enviado. A pessoa entra no time assim que aceitar pelo link do e-mail.',
    });
  } catch (err) {
    console.error('TEAM INVITE:', err);
    return res.status(500).json({ error: 'Não foi possível enviar o convite.' });
  }
}
