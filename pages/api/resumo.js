// pages/api/resumo.js
import { limitar } from '../../lib/rateLimit';
import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import { gerarResumoDeTranscricao } from '../../lib/resumoIA';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  if (!limitar(req, res, { chave: `resumo:${usuario.id}`, limite: 30, janelaMs: 10 * 60 * 1000 })) return;

  const transcricao = typeof req.body?.transcricao === 'string' ? req.body.transcricao.slice(0, 2000000) : '';
  if (!transcricao) return res.status(400).json({ erro: 'Transcrição não informada.' });

  try {
    const resultado = await gerarResumoDeTranscricao(transcricao);
    if (!resultado.ok) return res.status(502).json({ erro: resultado.erro });

    return res.status(200).json({
      ok: true,
      resumo: resultado.resumo,
      insights: resultado.insights,
      metadados: resultado.metadados,
      acoes: resultado.acoes
    });
  } catch (err) {
    console.error('Falha ao gerar resumo:', err);
    return res.status(500).json({ erro: 'Falha ao gerar resumo.' });
  }
}