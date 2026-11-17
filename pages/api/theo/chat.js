// pages/api/theo/chat.js
//
// Camada 3 do Theo: fallback de IA via Groq.
//
// IMPORTANTE (rate limit do Free Tier do Groq): este endpoint NÃO envia a
// transcrição completa da reunião para o modelo quando há resumo/insights
// disponíveis. Em vez disso, usa dados.resumo + dados.insights (já
// extraídos no upload), que são muito mais compactos. Isso mantém o
// consumo de tokens baixo e CONSTANTE, independente da duração da reunião
// — o que evita o erro "Request too large... tokens per minute" que
// reuniões longas causavam ao enviar a transcrição inteira.
//
// Por que isso funciona bem neste desenho: a Camada 2 (busca local, em
// theo-busca.js) já varre a transcrição COMPLETA por palavra-chave antes
// de chegar aqui. Se a Camada 3 foi acionada, é porque (a) a busca literal
// não achou nada — e nesse caso a transcrição completa não traria valor
// extra — ou (b) a pergunta é de opinião/julgamento, caso em que o resumo
// (já uma interpretação da reunião) tende a servir melhor que o texto bruto.
//
// TRADE-OFF: perguntas que pedem um detalhe bem específico que não entrou
// no resumo, formulado de um jeito que a busca por palavra-chave não
// capturou, podem não ser respondidas (o Theo vai dizer que não encontrou,
// em vez de tentar achar no texto bruto). Se isso virar um problema
// recorrente, dá pra evoluir pra enviar trechos relevantes da transcrição
// (não a transcrição inteira) — fica como possível Fase 3.
//
// Se a reunião ainda não tem resumo/insights gerados, cai de volta pra
// transcrição completa (caso raro — e nesse caso ainda existe o mesmo
// risco de TPM em reuniões muito longas, até que o resumo exista).

import { autenticarReq } from '../../../lib/auth';
import { aplicarCors } from '../../../lib/cors';
import { limitar } from '../../../lib/rateLimit';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

// Limite de segurança pro próprio resumo, caso algum dia venha anormalmente
// longo (defesa extra — não deve disparar em uso normal).
const LIMITE_CARACTERES_RESUMO = 6000;

// Mesmo limite, mas pra transcrição completa, usado só no caso de fallback
// (reunião sem resumo ainda). ~16.000 caracteres ≈ 4.000 tokens, deixando
// bastante margem sob o teto de 12.000 TPM do Free Tier.
const LIMITE_CARACTERES_TRANSCRICAO_FALLBACK = 16000;

const THEO_SYSTEM_PROMPT = `Você é o Theo, o assistente oficial do TranscreveAI.
Sua principal função é analisar transcrições de reuniões, entrevistas, aulas, podcasts e qualquer outro conteúdo enviado pelo usuário.

Sua missão
Ajudar o usuário a encontrar informações na transcrição de forma rápida, precisa e confiável.
Você deve responder utilizando apenas as informações presentes no conteúdo fornecido (transcrição, resumo e/ou insights).
Nunca invente informações.
Se algo não foi mencionado, responda claramente:
"Não encontrei essa informação na transcrição."
ou
"Esse assunto não foi mencionado na reunião."

Sempre que possível:
- Cite o trecho que embasa a resposta.
- Informe o horário (timestamp), caso esteja disponível.
- Informe quem falou, caso essa informação exista.
- Organize respostas longas em tópicos.

Quando não houver informação suficiente, nunca faça suposições. Informe que a informação não está presente.

Estilo: claro, objetivo, profissional, educado. Respostas curtas quando possível.`;

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  // Antes esta rota não tinha autenticação nenhuma — qualquer pessoa podia
  // usá-la como proxy gratuito de LLM pago pela chave do Groq.
  const usuario = await autenticarReq(req, res);
  if (!usuario) return;
  if (!limitar(req, res, { chave: `theo-chat:${usuario.id}`, limite: 30, janelaMs: 10 * 60 * 1000 })) return;

  const { transcricao, historico, insights } = req.body || {};
  const pergunta = typeof req.body?.pergunta === 'string' ? req.body.pergunta.slice(0, 2000) : '';

  const resumo = insights?.resumo ? String(insights.resumo).slice(0, LIMITE_CARACTERES_RESUMO) : null;
  const insightsLista = Array.isArray(insights?.insightsLista) ? insights.insightsLista : null;
  const temResumoOuInsights = Boolean(resumo || (insightsLista && insightsLista.length > 0));

  if (!pergunta || typeof pergunta !== 'string') {
    return res.status(400).json({ erro: 'Campo "pergunta" é obrigatório' });
  }
  if (!temResumoOuInsights && (!transcricao || typeof transcricao !== 'string')) {
    return res.status(400).json({ erro: 'Nenhum conteúdo disponível (nem resumo/insights, nem transcrição)' });
  }


  try {
    const mensagensHistorico = Array.isArray(historico)
      ? historico
          .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
          .slice(-10)
          .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
      : [];

    let contextoPrincipal;

    if (temResumoOuInsights) {
      // Caminho principal: resumo + insights (compacto, custo/risco de TPM baixo).
      const blocoResumo = resumo
        ? `--- RESUMO DA REUNIÃO ---\n${resumo}\n--- FIM DO RESUMO ---`
        : '--- RESUMO DA REUNIÃO ---\n(não disponível)\n--- FIM DO RESUMO ---';

      const blocoInsights = insightsLista?.length
        ? `\n\n--- INSIGHTS ---\n${insightsLista.map((i) => `• ${i}`).join('\n')}\n--- FIM DOS INSIGHTS ---`
        : '';

      contextoPrincipal =
        `${blocoResumo}${blocoInsights}\n\n` +
        `AVISO IMPORTANTE: você está recebendo o RESUMO da reunião, não a transcrição literal completa. ` +
        `Por isso, NÃO invente citações entre aspas nem horários (timestamps) específicos — você não tem ` +
        `acesso a esses detalhes literais. Baseie-se apenas no conteúdo do resumo e dos insights acima. ` +
        `Se a informação não estiver lá, diga que não encontrou.`;
    } else {
      // Fallback: reunião sem resumo/insights ainda — usa a transcrição completa,
      // truncada por segurança pra reduzir risco de TPM em reuniões muito longas.
      const transcricaoTruncada = transcricao.slice(0, LIMITE_CARACTERES_TRANSCRICAO_FALLBACK);
      const foiTruncada = transcricao.length > LIMITE_CARACTERES_TRANSCRICAO_FALLBACK;

      contextoPrincipal =
        `--- TRANSCRIÇÃO DA REUNIÃO${foiTruncada ? ' (parcial — reunião longa, truncada por limite técnico)' : ''} ---\n` +
        `${transcricaoTruncada}\n--- FIM DA TRANSCRIÇÃO ---`;
    }

    const messages = [
      { role: 'system', content: `${THEO_SYSTEM_PROMPT}\n\n${contextoPrincipal}` },
      ...mensagensHistorico,
      { role: 'user', content: pergunta },
    ];

    const resposta = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.GROQ_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 700, // respostas concisas; também ajuda a ficar bem abaixo do teto de TPM
      }),
    });

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      console.error('Erro Groq (Theo):', resposta.status, erroTexto);
      return res.status(502).json({ erro: 'Falha ao consultar o Theo. Tente novamente.' });
    }

    const dados = await resposta.json();
    const textoResposta = dados?.choices?.[0]?.message?.content?.trim();

    if (!textoResposta) {
      return res.status(502).json({ erro: 'O Theo não retornou uma resposta válida.' });
    }

    return res.status(200).json({ resposta: textoResposta });
  } catch (erro) {
    console.error('Erro inesperado no endpoint do Theo:', erro);
    return res.status(500).json({ erro: 'Erro interno ao processar a pergunta.' });
  }
}