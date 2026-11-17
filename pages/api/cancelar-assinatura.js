import { fimDoPeriodo } from '../../lib/planos';
import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import supabase from '../../lib/supabase';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  try {
    // busca a assinatura paga ativa do usuário
    const { data: assinatura, error: assinaturaError } = await supabase
      .from('assinaturas')
      .select('id, plano_id, ciclo, criado_em')
      .eq('user_id', usuario.id)
      .eq('status', 'ativa')
      .maybeSingle();

    if (assinaturaError) throw assinaturaError;

    if (!assinatura) {
      return res.status(400).json({ erro: 'Você não tem uma assinatura paga ativa para cancelar.' });
    }

    // confere se o plano dessa assinatura não é o Free (não faz sentido "cancelar" o Free)
    const { data: planoInfo } = await supabase
      .from('planos')
      .select('nome')
      .eq('id', assinatura.plano_id)
      .single();

    if (planoInfo?.nome === 'Free') {
      return res.status(400).json({ erro: 'O plano gratuito não precisa ser cancelado.' });
    }

    // NÃO rebaixa agora — só marca como "cancelamento agendado". O acesso
    // pago continua até o fim do período pago, quando o job diário processa
    // o rebaixamento de fato (ver /api/cron/processar-cancelamentos).
    const { error: updateError } = await supabase
      .from('assinaturas')
      .update({ status: 'cancelamento_agendado' })
      .eq('id', assinatura.id);

    if (updateError) throw updateError;

    const { data: perfil } = await supabase
      .from('usuarios')
      .select('fim_ciclo')
      .eq('id', usuario.id)
      .single();

    return res.status(200).json({
      ok: true,
      mensagem: 'Cancelamento agendado. Você continua com acesso ao plano pago até o fim do período já pago.',
      acessoAte: fimDoPeriodo(assinatura).toISOString(),
    });

  } catch (err) {
    console.error('Erro ao cancelar assinatura:', err);
    return res.status(500).json({ erro: 'Erro interno ao cancelar assinatura.' });
  }
}