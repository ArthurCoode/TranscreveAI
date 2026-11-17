// pages/api/cron/processar-cancelamentos.js
// Job diário (Vercel Cron). Três trabalhos:
//
// 1) EXPIRAÇÃO DE ASSINATURAS: o pagamento é avulso (não há cobrança
//    recorrente ainda), então toda assinatura paga tem um período
//    (30 dias no mensal, 365 no anual, contados de criado_em). Ao fim do
//    período — com ou sem pedido de cancelamento — o usuário volta pro
//    Free até pagar de novo. Antes, o plano pago nunca expirava.
// 2) RESET DE COTA: usuários com fim_ciclo vencido recebem um novo ciclo
//    de 30 dias com cota zerada (transcrição + perguntas ao Theo).
//
// Autenticação: a Vercel envia "Authorization: Bearer <CRON_SECRET>".
// Sem CRON_SECRET configurado o job NÃO roda (falha fechado).
import supabase from '../../../lib/supabase';
import { compararSeguro } from '../../../lib/auth';
import { fimDoPeriodo } from '../../../lib/planos';

function autorizado(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers['authorization'] || '';
  return compararSeguro(auth, `Bearer ${secret}`);
}

export default async function handler(req, res) {
  if (!autorizado(req)) {
    return res.status(401).json({ erro: 'Não autorizado.' });
  }

  const agora = new Date();
  const resultado = { assinaturasExpiradas: 0, cotasResetadas: 0, erros: [] };

  try {
    const { data: planoFree, error: planoFreeError } = await supabase
      .from('planos')
      .select('id, nome')
      .eq('nome', 'Free')
      .single();
    if (planoFreeError) throw planoFreeError;

    // ---------------------------------------------------------------
    // 1) EXPIRAÇÃO: assinaturas pagas cujo período já terminou
    // ---------------------------------------------------------------
    const { data: assinaturas, error: buscaError } = await supabase
      .from('assinaturas')
      .select('id, user_id, plano_id, ciclo, status, criado_em')
      .in('status', ['ativa', 'cancelamento_agendado'])
      .neq('plano_id', planoFree.id);
    if (buscaError) throw buscaError;

    const planoAdmin = process.env.ADMIN_PLANO_ID || null;

    for (const assinatura of assinaturas || []) {
      if (planoAdmin && assinatura.plano_id === planoAdmin) continue;
      if (fimDoPeriodo(assinatura) > agora) continue;

      try {
        const { error: erroAssinatura } = await supabase
          .from('assinaturas')
          .update({ status: assinatura.status === 'cancelamento_agendado' ? 'cancelada' : 'expirada' })
          .eq('id', assinatura.id);
        if (erroAssinatura) throw erroAssinatura;

        // só rebaixa se o usuário ainda está nesse plano (pode ter trocado)
        const { error: erroUsuario } = await supabase
          .from('usuarios')
          .update({ plano: planoFree.nome, plano_id: planoFree.id })
          .eq('id', assinatura.user_id)
          .eq('plano_id', assinatura.plano_id);
        if (erroUsuario) throw erroUsuario;

        resultado.assinaturasExpiradas++;
      } catch (e) {
        resultado.erros.push(`Falha ao expirar assinatura ${assinatura.id}: ${e.message}`);
      }
    }

    // ---------------------------------------------------------------
    // 2) RESET DE COTA
    // ---------------------------------------------------------------
    const { data: usuariosParaResetar, error: resetBuscaError } = await supabase
      .from('usuarios')
      .select('id')
      .lte('fim_ciclo', agora.toISOString());
    if (resetBuscaError) throw resetBuscaError;

    const novoInicio = new Date();
    const novoFim = new Date(novoInicio.getTime() + 30 * 24 * 60 * 60 * 1000);

    for (const u of usuariosParaResetar || []) {
      const { error } = await supabase
        .from('usuarios')
        .update({
          segundos_usados: 0,
          perguntas_theo_usadas: 0,
          inicio_ciclo: novoInicio.toISOString(),
          fim_ciclo: novoFim.toISOString(),
        })
        .eq('id', u.id);

      if (error) resultado.erros.push(`Falha ao resetar cota do usuário ${u.id}: ${error.message}`);
      else resultado.cotasResetadas++;
    }

    console.log('Job diário concluído:', resultado);
    return res.status(200).json({ ok: true, ...resultado });
  } catch (err) {
    console.error('Erro no job diário:', err);
    return res.status(500).json({ erro: 'Falha no job diário.', ...resultado });
  }
}
