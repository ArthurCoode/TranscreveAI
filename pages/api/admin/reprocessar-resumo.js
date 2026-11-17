// pages/api/admin/reprocessar-resumo.js
import { supabaseAdmin } from '../../../lib/supabaseAdmin';
import { gerarResumoDeTranscricao } from '../../../lib/resumoIA';
import { exigirAdmin } from './_adminGuard';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });

  const admin = await exigirAdmin(req, res);
  if (!admin) return;

  const { id } = req.body;
  if (!id) return res.status(400).json({ erro: 'ID da transcrição não informado.' });

  const { data: registro, error: erroBusca } = await supabaseAdmin
    .from('transcricoes')
    .select('id, nome, transcricao')
    .eq('id', id)
    .single();

  if (erroBusca || !registro) {
    return res.status(404).json({ erro: 'Transcrição não encontrada.' });
  }

  if (!registro.transcricao || !registro.transcricao.trim()) {
    return res.status(400).json({ erro: 'Esta reunião não possui texto de transcrição para reprocessar.' });
  }

  const resultado = await gerarResumoDeTranscricao(registro.transcricao);
  if (!resultado.ok) {
    return res.status(502).json({ erro: resultado.erro });
  }

  const { metadados } = resultado;

  const { data: atualizado, error: erroUpdate } = await supabaseAdmin
    .from('transcricoes')
    .update({
      resumo: resultado.resumo,
      insights: resultado.insights,
      temas: metadados.temas,
      cliente_mencionado: metadados.cliente_mencionado,
      participantes: metadados.participantes,
      sentimento: metadados.sentimento,
      tem_reclamacao: metadados.tem_reclamacao,
      tem_risco_cancelamento: metadados.tem_risco_cancelamento,
      intencao_compra: metadados.intencao_compra,
      nivel_urgencia: metadados.nivel_urgencia,
      tipo_reuniao: metadados.tipo_reuniao
      // temas_texto e resumo_tsv ficam de fora: assumo que são gerados
      // automaticamente por trigger/generated column no Postgres.
      // Se não forem, me avisa que eu adiciono aqui.
    })
    .eq('id', id)
    .select('id, nome, resumo, insights, temas, cliente_mencionado, participantes, sentimento, tem_reclamacao, tem_risco_cancelamento, intencao_compra, nivel_urgencia, tipo_reuniao')
    .single();

  if (erroUpdate) {
    return res.status(500).json({ erro: 'Resumo gerado, mas falhou ao salvar: ' + erroUpdate.message });
  }

  return res.status(200).json({ ok: true, transcricao: atualizado });
}