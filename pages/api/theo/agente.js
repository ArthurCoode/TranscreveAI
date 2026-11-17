// pages/api/theo/agente.js
//
// Theo como agente: em vez de um pipeline fixo (insights -> busca -> IA),
// o modelo recebe um conjunto de FERRAMENTAS (ver lib/theo-tools.js) e
// decide sozinho quais chamar, quantas vezes, e em que ordem, até ter
// informação suficiente pra responder. Isso é "tool use" / function
// calling — suportado nativamente pelos modelos LLaMA 3.3 no Groq.
//
// [modo supervisor] Se o usuário logado é admin de um time, o conjunto
// de ferramentas oferecido ao Groq é ampliado com as ferramentas de
// supervisão (resumo_desempenho_equipe, comparar_membros,
// reunioes_sentimento_negativo — ver THEO_TOOLS_SUPERVISOR em
// lib/theo-tools.js). Usuários não-admin nunca recebem essas ferramentas
// na lista enviada ao modelo — não é só o handler que recusa, o modelo
// nem sabe que elas existem.
//
// Diferença central pro /api/theo/chat.js: aquele responde SOBRE UMA
// reunião já aberta (contexto fixo). Este responde sobre TODAS as
// reuniões do usuário, escolhendo quais consultar dinamicamente —
// é a "memória corporativa".
//
// COTA: cada pergunta (não cada chamada interna de tool use) consome 1
// unidade de perguntas_theo_usadas, no mesmo ciclo de 30 dias já usado
// para horas de transcrição (inicio_ciclo/fim_ciclo, resetado pelo job
// pages/api/cron/processar-cancelamentos.js). A cota só é incrementada
// DEPOIS que o loop termina com sucesso — se o Groq falhar ou o rate
// limit estourar, o usuário não perde a pergunta.
//
// Fluxo:
//   1. Recebe pergunta + histórico
//   2. Verifica cota (verificar_cota_theo) — nega ANTES de gastar Groq
//   3. Busca o cargo do usuário e monta as tools disponíveis (base ou base+supervisor)
//   4. Chama Groq com as tools disponíveis (com retry automático em 429)
//   5. Se vier tool_calls: executa localmente, injeta resultado como
//      mensagem role:"tool", volta pro passo 4
//   6. Se vier texto final: incrementa cota e devolve pro usuário
//
// Limite de iterações evita loop infinito / custo descontrolado caso o
// modelo insista em chamar ferramentas sem nunca finalizar.

import { aplicarCors } from '../../../lib/cors';
import { autenticarReq } from '../../../lib/auth';
import supabase from '../../../lib/supabase';
import fetch from 'node-fetch';
import { obterFerramentasParaUsuario } from '../../../lib/theo-tools';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const MAX_ITERACOES = 5;

const THEO_AGENTE_SYSTEM_PROMPT = `Você é o Theo, o assistente de memória corporativa do TranscreveAI.
Diferente de um chat comum, você tem acesso a FERRAMENTAS que consultam TODAS as reuniões já registradas do usuário — não apenas uma reunião específica.

Como trabalhar:
- Use buscar_reunioes para encontrar reuniões relevantes por período, tema, cliente, participante, sentimento, reclamação ou risco de cancelamento.
- Se o usuário mencionar o NOME/TÍTULO específico de uma reunião (ex: "a reunião Revisão e Alinhamento - Cliente X"), use o parâmetro "titulo" de buscar_reunioes com esse nome (ou parte dele) em vez de tentar adivinhar tema/cliente.
- buscar_reunioes só devolve uma lista resumida (id, nome, data, temas...). Para ler o CONTEÚDO de uma reunião (o que foi de fato discutido), você precisa chamar obter_resumos com os ids encontrados.
- Você pode chamar ferramentas mais de uma vez se a primeira busca não trouxer o que precisa (ex: tentar um termo de busca diferente, ou ampliar o período).
- Nunca invente informação que não veio das ferramentas. Se as buscas não encontrarem nada, diga claramente que não encontrou.
- Ao responder, cite a reunião (nome e data) que embasa cada informação, para o usuário poder conferir a fonte.
- Se a pergunta pedir uma síntese de várias reuniões (ex: "resuma as reuniões da semana"), busque todas as relevantes, leia os resumos, e sintetize você mesmo — não apenas liste.
- Seja direto e objetivo. Organize respostas com múltiplos itens em tópicos.

Hoje é ${new Date().toISOString().split('T')[0]}. Use essa data como referência para expressões como "esse mês", "essa semana", "hoje".`;

// Trecho adicional do system prompt, incluído SÓ quando o usuário é
// admin de um time — explica as ferramentas extras disponíveis nesse caso.
const THEO_AGENTE_SYSTEM_PROMPT_SUPERVISOR = `

Você também está falando com um ADMINISTRADOR de um time no TranscreveAI. Além das ferramentas acima, você tem acesso a:
- resumo_desempenho_equipe: visão agregada de reuniões, atividades e sentimento negativo por membro do time, num período.
- comparar_membros: compara dois membros específicos por nome ou e-mail.
- reunioes_sentimento_negativo: lista reuniões recentes da equipe com sentimento negativo do cliente ou risco de cancelamento.

Use essas ferramentas quando a pergunta for sobre a EQUIPE como um todo, sobre um MEMBRO específico do time (não sobre uma reunião do próprio admin), ou sobre comparação de desempenho entre pessoas. Para perguntas sobre as próprias reuniões do admin, continue usando buscar_reunioes/obter_resumos normalmente.`;

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  const { historico } = req.body || {};
  const pergunta = typeof req.body?.pergunta === 'string' ? req.body.pergunta.slice(0, 2000) : '';

  if (!pergunta || typeof pergunta !== 'string') {
    return res.status(400).json({ erro: 'Campo "pergunta" é obrigatório' });
  }

  // -----------------------------------------------------------------
  // Verificação de cota — ANTES de gastar qualquer chamada ao Groq.
  // -----------------------------------------------------------------
  const { data: cota, error: erroCota } = await supabase
    .rpc('verificar_cota_theo', { p_user_id: usuario.id })
    .single();

  if (erroCota || !cota) {
    return res.status(403).json({ erro: 'Não foi possível verificar sua cota do Theo. Contate o suporte.' });
  }

  if (!cota.pode_perguntar) {
    return res.status(403).json({
      erro: 'Você atingiu o limite de perguntas ao Theo neste ciclo. Faça upgrade do seu plano para continuar.',
      perguntasUsadas: cota.perguntas_usadas,
      perguntasLimite: cota.perguntas_limite
    });
  }

  // -----------------------------------------------------------------
  // Monta o conjunto de ferramentas disponível conforme o cargo do
  // usuário. Usuários não-admin recebem só as tools base — o modelo
  // nem sabe que as ferramentas de supervisão existem.
  // -----------------------------------------------------------------
  const { data: perfil } = await supabase
    .from('usuarios')
    .select('role')
    .eq('id', usuario.id)
    .maybeSingle();

  const { tools, handlers, ehAdmin } = obterFerramentasParaUsuario(perfil?.role);

  const systemPrompt = ehAdmin
    ? THEO_AGENTE_SYSTEM_PROMPT + THEO_AGENTE_SYSTEM_PROMPT_SUPERVISOR
    : THEO_AGENTE_SYSTEM_PROMPT;

  const mensagensHistorico = Array.isArray(historico)
    ? historico
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-10)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    : [];

  var messages = [
    { role: 'system', content: systemPrompt },
    ...mensagensHistorico,
    { role: 'user', content: pergunta }
  ];

  var chamadasFerramentas = []; // pra debug/telemetria — devolvido junto da resposta

  try {
    for (var iteracao = 0; iteracao < MAX_ITERACOES; iteracao++) {
      const resposta = await chamarGroqComRetry(messages, tools);

      if (!resposta.ok) {
        const erroTexto = await resposta.text();
        console.error('Erro Groq (Theo agente):', resposta.status, erroTexto);
        if (resposta.status === 429) {
          return res.status(429).json({
            erro: 'O Theo está com muitas consultas no momento. Aguarde alguns segundos e tente novamente.'
          });
        }
        return res.status(502).json({ erro: 'Falha ao consultar o Theo. Tente novamente.' });
      }

      const dados = await resposta.json();
      const mensagemModelo = dados?.choices?.[0]?.message;

      if (!mensagemModelo) {
        return res.status(502).json({ erro: 'O Theo não retornou uma resposta válida.' });
      }

      // Sem tool_calls: é a resposta final em texto — encerra o loop.
      if (!mensagemModelo.tool_calls || mensagemModelo.tool_calls.length === 0) {
        const textoFinal = (mensagemModelo.content || '').trim();
        if (!textoFinal) {
          return res.status(502).json({ erro: 'O Theo não retornou uma resposta válida.' });
        }

        // Incrementa cota só em caso de sucesso real — se der erro antes
        // disso (Groq fora do ar, rate limit, etc.), a pergunta não é cobrada.
        const { error: erroIncremento } = await supabase.rpc('incrementar_uso_theo', {
          p_user_id: usuario.id
        });
        if (erroIncremento) {
          console.error('Falha ao incrementar uso do Theo:', erroIncremento.message);
        }

        return res.status(200).json({
          resposta: textoFinal,
          ferramentas_usadas: chamadasFerramentas
        });
      }

      // Tem tool_calls: adiciona a mensagem do assistente (com as chamadas)
      // ao histórico, executa cada ferramenta, e injeta os resultados.
      messages.push(mensagemModelo);

      for (const chamada of mensagemModelo.tool_calls) {
        const nomeFuncao = chamada.function?.name;
        let args = {};
        try {
          args = JSON.parse(chamada.function?.arguments || '{}');
        } catch (e) {
          args = {};
        }

        const handler = handlers[nomeFuncao];
        let resultado;

        if (!handler) {
          resultado = { erro: 'Ferramenta desconhecida: ' + nomeFuncao };
        } else {
          try {
            // usuario.id NUNCA vem de "args" — sempre da sessão autenticada.
            resultado = await handler(usuario.id, args);
          } catch (erroFerramenta) {
            console.error('Erro ao executar ferramenta', nomeFuncao, erroFerramenta);
            resultado = { erro: 'Falha ao executar ' + nomeFuncao };
          }
        }

        chamadasFerramentas.push({ nome: nomeFuncao, args });

        messages.push({
          role: 'tool',
          tool_call_id: chamada.id,
          content: JSON.stringify(resultado)
        });
      }
      // volta pro topo do for: manda os resultados de volta pro modelo
    }

    // esgotou MAX_ITERACOES sem resposta final. Não cobra a cota do usuário
    // (a pergunta não foi de fato respondida), mas devolve algo útil.
    return res.status(200).json({
      resposta:
        'Não consegui concluir a busca a tempo. Tente uma pergunta mais específica ' +
        '(ex: um período ou cliente mais exato).',
      ferramentas_usadas: chamadasFerramentas
    });
  } catch (erro) {
    console.error('Erro inesperado no endpoint do Theo agente:', erro);
    return res.status(500).json({ erro: 'Erro interno ao processar a pergunta.' });
  }
}

// Faz a chamada ao Groq com retry automático em caso de rate limit (429).
// O Groq costuma indicar na própria mensagem de erro quantos segundos
// esperar (ex: "try again in 1.08s") — aqui usamos um backoff fixo simples
// (mais previsível que tentar parsear o tempo exato da mensagem de erro).
async function chamarGroqComRetry(messages, tools, tentativa = 0) {
  const MAX_TENTATIVAS = 2; // 1 tentativa original + 2 retries = 3 no total
  const ESPERA_MS = 1500;

  const resposta = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.GROQ_KEY}`
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: tools,
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: 1024
    })
  });

  if (resposta.status === 429 && tentativa < MAX_TENTATIVAS) {
    await new Promise((r) => setTimeout(r, ESPERA_MS * (tentativa + 1)));
    return chamarGroqComRetry(messages, tools, tentativa + 1);
  }

  return resposta;
}