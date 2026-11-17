// pages/api/theo/suporte.js
//
// Theo flutuante — chat de SUPORTE DO SISTEMA (não confundir com
// /api/theo/chat.js, que responde sobre o conteúdo de UMA reunião, nem
// com /api/theo/agente.js, que responde sobre TODAS as reuniões do
// usuário). Este aqui responde dúvidas de USO DA PLATAFORMA: como
// agendar, como convidar membro, como funciona o plano, etc.
//
// [decisão] NÃO consome a cota de perguntas_theo_usadas (verificar_cota_theo
// / incrementar_uso_theo). Cota de uso é sobre "quanto o usuário está
// extraindo de valor das reuniões dele" — suporte é uma preocupação
// diferente (ajudar o usuário a usar o produto) e não deveria competir
// pelo mesmo limite. Se isso precisar mudar (ex: abuso do endpoint),
// dá pra aplicar um rate limit próprio aqui, sem mexer na cota do Theo
// de reuniões.
//
// Sem tool use de propósito: as respostas são só sobre navegação/uso do
// sistema, não precisam consultar dados do usuário no banco.

import { aplicarCors } from '../../../lib/cors';
import { autenticarReq } from '../../../lib/auth';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

const THEO_SUPORTE_SYSTEM_PROMPT = `Você é o Theo, o assistente de suporte do TranscreveAI — uma plataforma que transcreve reuniões, gera resumos e insights com IA.

Sua função aqui é APENAS ajudar o usuário a usar a plataforma: onde encontrar cada funcionalidade, como fazer cada ação, dúvidas sobre planos, e receber sugestões/feedback sobre o produto. Você não tem acesso ao conteúdo das reuniões do usuário — se ele perguntar algo sobre uma reunião específica, oriente-o a usar a aba "Theo" na navbar lateral (que tem acesso a essa memória) ou a abrir a transcrição diretamente.

O que você sabe sobre a plataforma:
- "Novo Agendamento" (topo do dashboard) cria uma reunião com data, convidados, link de Meet/Zoom/Teams opcional.
- Aba "Transcrições": lista as transcrições, permite buscar, e tem o botão "Transcrever Áudio" para fazer upload de um arquivo de áudio/vídeo e gerar a transcrição.
- Aba "Insights": mostra os insights de IA extraídos de todas as reuniões.
- Aba "Theo": chat com memória corporativa, responde perguntas sobre qualquer reunião já registrada.
- Aba "Time": permite convidar membros (botão "Convidar", com permissão Viewer/Editor/Admin) e ver estatísticas do time.
- Aba "Atividades": kanban simples (Pendente / Em andamento / Concluído) para tarefas.
- Aba "Configurações": edição de perfil, integração com Google Calendar, link para instalar a extensão do Chrome, gerenciamento de plano/assinatura, troca de senha.
- Existe uma extensão para o Chrome que permite transcrever reuniões direto do navegador.

Regras:
- Seja direto, objetivo e gentil. Respostas curtas (poucos parágrafos ou uma lista curta).
- Se não souber a resposta com certeza, diga isso claramente e sugira que o usuário envie a dúvida por e-mail para o suporte (há um botão para isso no próprio chat) — não invente funcionalidades que não existem.
- Nunca peça senha, dados de cartão ou informações sensíveis.`;

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  const { pergunta, historico } = req.body || {};

  if (!pergunta || typeof pergunta !== 'string') {
    return res.status(400).json({ erro: 'Campo "pergunta" é obrigatório' });
  }

  const mensagensHistorico = Array.isArray(historico)
    ? historico
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-10)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    : [];

  const messages = [
    { role: 'system', content: THEO_SUPORTE_SYSTEM_PROMPT },
    ...mensagensHistorico,
    { role: 'user', content: pergunta },
  ];

  try {
    const resposta = await chamarGroqComRetry(messages);

    if (!resposta.ok) {
      const erroTexto = await resposta.text();
      console.error('Erro Groq (Theo suporte):', resposta.status, erroTexto);
      if (resposta.status === 429) {
        return res.status(429).json({
          erro: 'O Theo está com muitas consultas no momento. Aguarde alguns segundos e tente novamente.',
        });
      }
      return res.status(502).json({ erro: 'Falha ao consultar o Theo. Tente novamente.' });
    }

    const dados = await resposta.json();
    const textoResposta = dados?.choices?.[0]?.message?.content?.trim();

    if (!textoResposta) {
      return res.status(502).json({ erro: 'O Theo não retornou uma resposta válida.' });
    }

    return res.status(200).json({ resposta: textoResposta });
  } catch (erro) {
    console.error('Erro inesperado no endpoint de suporte do Theo:', erro);
    return res.status(500).json({ erro: 'Erro interno ao processar a pergunta.' });
  }
}

// Mesmo padrão de retry usado em pages/api/theo/agente.js
async function chamarGroqComRetry(messages, tentativa = 0) {
  const MAX_TENTATIVAS = 2;
  const ESPERA_MS = 1500;

  const resposta = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      temperature: 0.3,
      max_tokens: 500, // respostas de suporte devem ser curtas e diretas
    }),
  });

  if (resposta.status === 429 && tentativa < MAX_TENTATIVAS) {
    await new Promise((r) => setTimeout(r, ESPERA_MS * (tentativa + 1)));
    return chamarGroqComRetry(messages, tentativa + 1);
  }

  return resposta;
}