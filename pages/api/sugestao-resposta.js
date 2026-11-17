// pages/api/sugestao-resposta.js
//
// Fase 4 do copiloto em tempo real: recebe a categoria do gatilho
// detectado no cliente (Fase 3, roda no content.js) + a frase que
// disparou + as últimas falas da conversa como contexto, e devolve
// 2-3 sugestões curtas de resposta geradas por IA.
//
// Usa a API da Groq (Llama 3.3 70B Versatile) — decisão de custo:
// nessa fase inicial do produto, preço por token é prioridade, e o
// Groq fica ~3x mais barato que Claude Haiku pra esse volume de
// tokens, com latência ainda mais baixa (hardware LPU dedicado).
// Se no futuro a qualidade das sugestões virar gargalo, é uma troca
// pequena (só a chamada HTTP muda — ver comentário no fim do arquivo
// com a variante Anthropic, caso queiram comparar lado a lado).
//
// IMPORTANTE: ajuste a parte de autenticação (verificarToken) pro
// mesmo padrão usado nos outros endpoints deste projeto (ex: o mesmo
// helper usado em /api/atividades.js ou /api/transcrever.js) — aqui
// deixei um placeholder simples só pra não travar a integração.
//
// Variável de ambiente necessária na Vercel: GROQ_KEY

import { autenticarReq } from '../../lib/auth';
import { aplicarCors } from '../../lib/cors';
import { limitar } from '../../lib/rateLimit';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODELO = 'llama-3.3-70b-versatile';
// Alternativa ainda mais barata (~35x mais barata que Claude Haiku),
// se quiserem espremer custo ao máximo — qualidade um pouco menor,
// principalmente em obedecer o formato JSON estrito:
// const MODELO = 'llama-3.1-8b-instant';

// rótulos legíveis por categoria, usados no prompt pra IA entender
// o tom esperado de cada tipo de situação
const CONTEXTO_CATEGORIA = {
  objecao_preco:  'O cliente sinalizou que o preço está alto ou fora do orçamento.',
  objecao_tempo:  'O cliente está adiando a decisão ou dizendo que não é prioridade agora.',
  insatisfacao:   'O cliente demonstrou insatisfação ou dúvida genérica sobre a proposta.',
  concorrente:    'O cliente mencionou um concorrente ou outra opção que está avaliando.',
  urgencia:       'O cliente sinalizou urgência ou prazo apertado para decidir.',
  sinal_compra:   'O cliente sinalizou disposição de fechar negócio agora.'
};

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido.' });
  }

  // Antes só checava se havia "algum" Bearer — qualquer string passava.
  const usuario = await autenticarReq(req, res);
  if (!usuario) return;
  if (!limitar(req, res, { chave: `sugestao:${usuario.id}`, limite: 60, janelaMs: 10 * 60 * 1000 })) return;

  const body = req.body || {};
  const categoria = typeof body.categoria === 'string' ? body.categoria.slice(0, 50) : '';
  const frase = typeof body.frase === 'string' ? body.frase.slice(0, 1000) : '';
  const contexto = typeof body.contexto === 'string' ? body.contexto.slice(-4000) : '';
  const nomeReuniao = typeof body.nomeReuniao === 'string' ? body.nomeReuniao.slice(0, 200) : '';

  if (!categoria || !frase) {
    return res.status(400).json({ ok: false, erro: 'Categoria e frase são obrigatórias.' });
  }

  const descricaoCategoria = CONTEXTO_CATEGORIA[categoria] || 'O cliente disse algo relevante para a negociação.';

  const systemPrompt =
    'Você é um copiloto de vendas em tempo real, ajudando um vendedor durante uma call. ' +
    'Sua tarefa: sugerir 2 a 3 respostas curtas (1-2 frases cada) que o vendedor pode usar AGORA, ' +
    'em português do Brasil, tom natural e consultivo (nunca agressivo ou robótico). ' +
    'Contexto da situação: ' + descricaoCategoria + '\n\n' +
    'Responda ESTRITAMENTE em JSON válido, sem markdown, sem texto antes ou depois, no formato: ' +
    '{"sugestoes": ["resposta 1", "resposta 2", "resposta 3"]}';

  const userPrompt =
    (nomeReuniao ? 'Reunião: ' + nomeReuniao + '\n' : '') +
    (contexto ? 'Últimas falas da conversa:\n' + contexto + '\n\n' : '') +
    'Frase do cliente que disparou o alerta: "' + frase + '"';

  try {
    const resposta = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.GROQ_KEY
      },
      body: JSON.stringify({
        model: MODELO,
        max_tokens: 400,
        temperature: 0.6,
        // Groq (formato compatível com OpenAI) suporta modo JSON estrito
        // pra alguns modelos — reduz bastante a chance da IA "escapar"
        // do formato pedido só no texto do prompt
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      console.error('Erro da API Groq:', resposta.status, erroTexto);
      return res.status(502).json({ ok: false, erro: 'Falha ao gerar sugestões (IA indisponível).' });
    }

    const data = await resposta.json();
    const textoResposta = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';

    // remove eventuais cercas de markdown (```json ... ```), por segurança —
    // o response_format:json_object já deveria evitar isso, mas modelos
    // open-source às vezes ainda "vazam" formatação
    const limpo = textoResposta.replace(/```json|```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(limpo);
    } catch (e) {
      console.error('Resposta da IA não veio em JSON válido:', textoResposta);
      return res.status(502).json({ ok: false, erro: 'Resposta da IA em formato inesperado.' });
    }

    const sugestoes = Array.isArray(parsed.sugestoes)
      ? parsed.sugestoes.filter(function(s) { return typeof s === 'string' && s.trim(); }).slice(0, 3)
      : [];

    if (!sugestoes.length) {
      return res.status(502).json({ ok: false, erro: 'IA não retornou sugestões válidas.' });
    }

    return res.status(200).json({ ok: true, sugestoes: sugestoes });

  } catch (err) {
    console.error('Erro em /api/sugestao-resposta:', err);
    return res.status(500).json({ ok: false, erro: 'Falha ao gerar sugestões.' });
  }
}

// -------------------------------------------------------------
// Variante Anthropic (Claude Haiku 4.5), caso queiram comparar
// qualidade lado a lado no futuro — só trocar a chamada fetch acima
// por isto (e usar ANTHROPIC_API_KEY em vez de GROQ_KEY):
//
// const resposta = await fetch('https://api.anthropic.com/v1/messages', {
//   method: 'POST',
//   headers: {
//     'Content-Type': 'application/json',
//     'x-api-key': process.env.ANTHROPIC_API_KEY,
//     'anthropic-version': '2023-06-01'
//   },
//   body: JSON.stringify({
//     model: 'claude-haiku-4-5',
//     max_tokens: 400,
//     system: systemPrompt,
//     messages: [{ role: 'user', content: userPrompt }]
//   })
// });
// // e trocar a extração de texto pra: data.content.filter(b => b.type === 'text').map(b => b.text).join('')
// -------------------------------------------------------------