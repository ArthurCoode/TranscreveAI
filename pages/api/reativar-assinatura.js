import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import supabase from '../../lib/supabase';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  try {
    const { data: assinatura, error: assinaturaError } = await supabase
      .from('assinaturas')
      .select('id')
      .eq('user_id', usuario.id)
      .eq('status', 'cancelamento_agendado')
      .maybeSingle();

    if (assinaturaError) throw assinaturaError;

    if (!assinatura) {
      return res.status(400).json({ erro: 'Não há nenhum cancelamento agendado para desfazer.' });
    }

    const { error: updateError } = await supabase
      .from('assinaturas')
      .update({ status: 'ativa' })
      .eq('id', assinatura.id);

    if (updateError) throw updateError;

    return res.status(200).json({ ok: true, mensagem: 'Cancelamento desfeito — sua assinatura continua normalmente.' });

  } catch (err) {
    console.error('Erro ao reativar assinatura:', err);
    return res.status(500).json({ erro: 'Erro interno ao reativar assinatura.' });
  }
}