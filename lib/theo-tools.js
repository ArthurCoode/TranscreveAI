// lib/theo-tools.js
//
// Ferramentas que o agente Theo pode chamar via tool use do Groq.
// Cada ferramenta é uma função pura: recebe (usuarioId, args) e devolve
// dados já prontos pra virar mensagem "tool" na conversa com o modelo.
//
// REGRA DE SEGURANÇA: usuarioId NUNCA vem de um argumento que o modelo
// preenche — sempre vem fixado pelo endpoint a partir da sessão
// autenticada (ver pages/api/theo/agente.js). As funções aqui recebem
// usuarioId como primeiro parâmetro, separado do "args" do modelo, pra
// deixar isso impossível de esquecer por engano.

import supabase from './supabase';

// teto de segurança: nunca deixa uma busca devolver reuniões demais de
// uma vez, senão a etapa de sintese (obter_resumos) pode estourar TPM
// do Groq Free Tier ao juntar resumo de muitas reuniões.
const LIMITE_RESULTADOS_BUSCA = 15;

// mesmo limite de segurança usado em resumo.js e theo/chat.js, pra manter
// o padrão de "nunca manda resumo gigante pro modelo"
const LIMITE_CARACTERES_RESUMO = 6000;

// ---------------------------------------------------------------------
// Definição das ferramentas no formato esperado pelo Groq (compatível
// com o formato "tools" da OpenAI). Isso é o que vai no parâmetro
// `tools` da chamada ao /v1/chat/completions.
// ---------------------------------------------------------------------
export const THEO_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'buscar_reunioes',
      description:
        'Busca reuniões por período, título, tema, cliente, participante ou características ' +
        '(reclamação, risco de cancelamento, sentimento). Devolve uma lista resumida (id, nome, data, ' +
        'temas, cliente, sentimento, responsavel) — NÃO devolve o texto completo do resumo. Use obter_resumos ' +
        'depois, passando os ids retornados aqui, para ler o conteúdo de reuniões específicas. ' +
        'Se o usuário for administrador de um time, a busca abrange as reuniões de TODOS os membros do ' +
        'time (o campo "responsavel" no resultado indica de quem é cada reunião); para outros usuários, ' +
        'a busca é só nas próprias reuniões. ' +
        'Pelo menos um filtro deve ser informado; se a pergunta não tiver filtro claro, use um período ' +
        'razoável (ex: mês atual) e/ou um termo de busca livre.',
      parameters: {
        type: 'object',
        properties: {
          titulo: {
            type: 'string',
            description:
              'Título (ou parte do título) exato da reunião, quando o usuário mencionar o nome da ' +
              'reunião diretamente (ex: "Revisão e Alinhamento - Cliente X"). Use este campo antes de ' +
              'tentar tema/cliente quando o usuário já der um nome específico de reunião.'
          },
          periodo_inicio: {
            type: 'string',
            description: 'Data inicial no formato YYYY-MM-DD (inclusive). Omitir se não houver filtro de data.'
          },
          periodo_fim: {
            type: 'string',
            description: 'Data final no formato YYYY-MM-DD (inclusive). Omitir se não houver filtro de data.'
          },
          tema: {
            type: 'string',
            description:
              'Um tema/assunto específico para filtrar (ex: "preço", "contrato", "cancelamento"). ' +
              'Casa tanto com a lista de temas estruturados quanto com busca livre no texto do resumo. ' +
              'Acentos não importam (busca é acento-insensível).'
          },
          cliente: {
            type: 'string',
            description: 'Nome (ou parte do nome) do cliente/empresa mencionada na reunião.'
          },
          participante: {
            type: 'string',
            description: 'Nome (ou parte do nome) de uma pessoa que participou da reunião.'
          },
          apenas_com_reclamacao: {
            type: 'boolean',
            description: 'Se true, retorna só reuniões marcadas com reclamação do cliente/participante.'
          },
          apenas_com_risco_cancelamento: {
            type: 'boolean',
            description: 'Se true, retorna só reuniões com menção a risco de cancelamento/não renovação.'
          },
          sentimento: {
            type: 'string',
            enum: ['positivo', 'neutro', 'negativo'],
            description: 'Filtra pelo sentimento geral da reunião.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'obter_resumos',
      description:
        'Retorna o texto completo do resumo (e insights) de uma lista de reuniões, dado os ids. ' +
        'Use depois de buscar_reunioes para ler o conteúdo das reuniões relevantes antes de responder. ' +
        'O escopo de acesso é o mesmo de buscar_reunioes (próprias reuniões, ou de todo o time se admin). ' +
        'Não peça mais que ~15 ids de uma vez.',
      parameters: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de ids de reuniões (retornados por buscar_reunioes).'
          }
        },
        required: ['ids']
      }
    }
  }
];

// ---------------------------------------------------------------------
// Implementações
// ---------------------------------------------------------------------

// Remove acentos do termo de busca no lado do JS, pra ficar consistente
// com o que já está normalizado no banco (immutable_unaccent, ver migration).
// Sem isso, "preço" (com cedilha) buscado contra "preco" (sem acento,
// armazenado em temas_texto/resumo_tsv) não daria match.
function removerAcentos(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

// escapa vírgula/parênteses que quebrariam a sintaxe do .or() do PostgREST
function escaparParaOr(termo) {
  return String(termo).replace(/[,()]/g, ' ').trim();
}

// -----------------------------------------------------------------------
// Escopo de busca: por padrão, um usuário só busca as PRÓPRIAS reuniões
// (transcricoes.usuario_id = usuarioId). Mas se o usuário é admin de um
// time, o escopo se amplia para TODAS as reuniões de TODOS os membros do
// time — é isso que permite ao admin pedir "resuma a reunião X do João"
// e o Theo encontrar, mesmo sendo uma reunião de outra pessoa.
//
// Sem isso, buscar_reunioes/obter_resumos ficavam restritas ao próprio
// admin mesmo com as ferramentas de supervisão existindo — o admin só
// conseguia ver AGREGADOS da equipe, nunca abrir uma reunião específica
// de outra pessoa pelo chat.
// -----------------------------------------------------------------------
async function obterEscopoBusca(usuarioId) {
  const { data: me } = await supabase
    .from('usuarios')
    .select('role, team_id')
    .eq('id', usuarioId)
    .maybeSingle();

  const ehAdmin = (me?.role || '').toLowerCase() === 'admin';

  if (!ehAdmin || !me?.team_id) {
    return { idsEscopo: [usuarioId], mapaNomes: {} };
  }

  const { data: membros } = await supabase
    .from('usuarios')
    .select('id, nome')
    .eq('team_id', me.team_id);

  const lista = membros && membros.length ? membros : [{ id: usuarioId, nome: null }];

  return {
    idsEscopo: lista.map((m) => m.id),
    mapaNomes: Object.fromEntries(lista.map((m) => [m.id, m.nome]))
  };
}

export async function buscar_reunioes(usuarioId, args) {
  args = args || {};

  const { idsEscopo, mapaNomes } = await obterEscopoBusca(usuarioId);

  var query = supabase
    .from('transcricoes')
    .select('id, nome, data, temas, cliente_mencionado, participantes, sentimento, tem_reclamacao, tem_risco_cancelamento, usuario_id')
    .in('usuario_id', idsEscopo)
    .order('data', { ascending: false })
    .limit(LIMITE_RESULTADOS_BUSCA);

  if (args.titulo) {
    query = query.ilike('nome', '%' + escaparParaOr(args.titulo) + '%');
  }

  if (args.periodo_inicio) query = query.gte('data', args.periodo_inicio);
  if (args.periodo_fim) query = query.lte('data', args.periodo_fim);
  if (args.cliente) query = query.ilike('cliente_mencionado', '%' + args.cliente + '%');
  if (args.participante) query = query.contains('participantes', [args.participante]);
  if (args.apenas_com_reclamacao === true) query = query.eq('tem_reclamacao', true);
  if (args.apenas_com_risco_cancelamento === true) query = query.eq('tem_risco_cancelamento', true);
  if (args.sentimento) query = query.eq('sentimento', args.sentimento);

  if (args.tema) {
    var termo = removerAcentos(args.tema.trim().toLowerCase());
    if (termo) {
      query = query.or(
        'temas_texto.ilike.%' + escaparParaOr(termo) + '%,' +
        'resumo_tsv.plfts.' + escaparParaOr(termo)
      );
    }
  }

  const { data, error } = await query;

  if (error) {
    return { erro: 'Falha ao buscar reuniões: ' + error.message };
  }

  // "responsavel" só é informativo quando o escopo é de time (admin) —
  // pra usuário comum sempre vai ser o próprio nome, o que é inofensivo.
  const reunioes = data.map((r) => ({
    ...r,
    responsavel: mapaNomes[r.usuario_id] || null
  }));

  return {
    total_encontrado: reunioes.length,
    limite_aplicado: LIMITE_RESULTADOS_BUSCA,
    reunioes
  };
}

export async function obter_resumos(usuarioId, args) {
  args = args || {};
  var ids = Array.isArray(args.ids) ? args.ids.filter(Boolean).slice(0, 15) : [];

  if (ids.length === 0) {
    return { erro: 'Nenhum id informado.' };
  }

  const { idsEscopo } = await obterEscopoBusca(usuarioId);

  const { data, error } = await supabase
    .from('transcricoes')
    .select('id, nome, data, resumo, insights')
    .in('usuario_id', idsEscopo) // escopo: próprio usuário, ou todo o time se for admin
    .in('id', ids);

  if (error) {
    return { erro: 'Falha ao obter resumos: ' + error.message };
  }

  return {
    reunioes: data.map(function(r) {
      return {
        id: r.id,
        nome: r.nome,
        data: r.data,
        resumo: (r.resumo || '').slice(0, LIMITE_CARACTERES_RESUMO),
        insights: Array.isArray(r.insights) ? r.insights : []
      };
    })
  };
}

// mapa nome da ferramenta -> função. Usado pelo loop do agente pra
// despachar a chamada sem um switch/case gigante.
export const THEO_TOOL_HANDLERS = {
  buscar_reunioes: buscar_reunioes,
  obter_resumos: obter_resumos
};

// =======================================================================
// FERRAMENTAS DE SUPERVISÃO (só para admin)
//
// Diferente das ferramentas acima (escopo: reuniões do próprio usuário),
// estas consultam dados de TODOS os membros do time do usuário. Por isso
// cada handler faz sua própria verificação de admin — mesmo que alguém
// force o modelo a chamar a ferramenta, o handler recusa sozinho. Isso é
// defesa em profundidade: a ideia principal é nem OFERECER essas tools
// pro Groq quando o usuário não é admin (ver obterFerramentasParaUsuario,
// usado em pages/api/theo/agente.js), mas o handler não confia só nisso.
// =======================================================================

async function verificarAdminEObterTeam(usuarioId) {
  const { data: me, error } = await supabase
    .from('usuarios')
    .select('role, team_id')
    .eq('id', usuarioId)
    .maybeSingle();

  if (error) throw error;

  const ehAdmin = (me?.role || '').toLowerCase() === 'admin';

  return { ehAdmin, teamId: me?.team_id || null };
}

function diasParaPeriodo(periodo) {
  return periodo === 'mes' ? 30 : 7; // default: semana
}

export const THEO_TOOLS_SUPERVISOR = [
  {
    type: 'function',
    function: {
      name: 'resumo_desempenho_equipe',
      description:
        'Disponível apenas para administradores de time. Retorna um resumo agregado de desempenho de ' +
        'toda a equipe num período: reuniões realizadas, atividades concluídas/pendentes/atrasadas, e ' +
        'quantidade de reuniões com sentimento negativo, por membro. Use para responder perguntas como ' +
        '"como está a equipe essa semana?" ou "quem está com mais atividades atrasadas?".',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            enum: ['semana', 'mes'],
            description: 'Janela de tempo a considerar. Default: semana.'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'comparar_membros',
      description:
        'Disponível apenas para administradores de time. Compara dois membros da equipe (por nome ou ' +
        'e-mail) em reuniões realizadas e atividades concluídas/pendentes/atrasadas nos últimos 30 dias. ' +
        'Use quando o admin pedir para comparar o desempenho de duas pessoas específicas.',
      parameters: {
        type: 'object',
        properties: {
          membro_a: {
            type: 'string',
            description: 'Nome (ou parte do nome) ou e-mail do primeiro membro.'
          },
          membro_b: {
            type: 'string',
            description: 'Nome (ou parte do nome) ou e-mail do segundo membro.'
          }
        },
        required: ['membro_a', 'membro_b']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'reunioes_sentimento_negativo',
      description:
        'Disponível apenas para administradores de time. Lista reuniões recentes da equipe com sentimento ' +
        'negativo do cliente ou risco de cancelamento identificado. Use para responder perguntas como ' +
        '"algum cliente insatisfeito essa semana?" ou "tem risco de cancelamento em alguma conta?".',
      parameters: {
        type: 'object',
        properties: {
          periodo: {
            type: 'string',
            enum: ['semana', 'mes'],
            description: 'Janela de tempo a considerar. Default: mes.'
          },
          membro: {
            type: 'string',
            description: 'Opcional: filtra só as reuniões de um membro específico (nome ou parte do nome).'
          }
        }
      }
    }
  }
];

export async function resumo_desempenho_equipe(usuarioId, args) {
  args = args || {};

  const { ehAdmin, teamId } = await verificarAdminEObterTeam(usuarioId);

  if (!ehAdmin || !teamId) {
    return { erro: 'Esta ferramenta é exclusiva para administradores de um time.' };
  }

  const dias = diasParaPeriodo(args.periodo);
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);
  const desdeISO = desde.toISOString();

  const { data: membros, error: membrosError } = await supabase
    .from('usuarios')
    .select('id, nome')
    .eq('team_id', teamId);

  if (membrosError) return { erro: 'Falha ao buscar membros: ' + membrosError.message };
  if (!membros || membros.length === 0) return { membros: [] };

  const memberIds = membros.map((m) => m.id);

  const { data: atividades, error: atividadesError } = await supabase
    .from('atividades')
    .select('responsavel_id, status, prazo')
    .in('responsavel_id', memberIds);

  if (atividadesError) return { erro: 'Falha ao buscar atividades: ' + atividadesError.message };

  const { data: transcricoes, error: transcricoesError } = await supabase
    .from('transcricoes')
    .select('usuario_id, sentimento, tem_risco_cancelamento, criado_em')
    .in('usuario_id', memberIds)
    .gte('criado_em', desdeISO);

  if (transcricoesError) return { erro: 'Falha ao buscar reuniões: ' + transcricoesError.message };

  const agora = new Date();

  const resultado = membros.map((m) => {
    const minhasAtividades = (atividades || []).filter((a) => a.responsavel_id === m.id);
    const minhasTranscricoes = (transcricoes || []).filter((t) => t.usuario_id === m.id);

    const concluidas = minhasAtividades.filter((a) => a.status === 'concluido').length;
    const pendentes = minhasAtividades.filter((a) => a.status !== 'concluido').length;
    const atrasadas = minhasAtividades.filter(
      (a) => a.status !== 'concluido' && a.prazo && new Date(a.prazo) < agora
    ).length;

    const sentimentoNegativo = minhasTranscricoes.filter(
      (t) => t.sentimento === 'negativo' || t.tem_risco_cancelamento
    ).length;

    return {
      membro: m.nome,
      reunioes_no_periodo: minhasTranscricoes.length,
      atividades_concluidas: concluidas,
      atividades_pendentes: pendentes,
      atividades_atrasadas: atrasadas,
      reunioes_sentimento_negativo: sentimentoNegativo
    };
  });

  return { periodo: args.periodo || 'semana', membros: resultado };
}

export async function comparar_membros(usuarioId, args) {
  args = args || {};

  const { ehAdmin, teamId } = await verificarAdminEObterTeam(usuarioId);

  if (!ehAdmin || !teamId) {
    return { erro: 'Esta ferramenta é exclusiva para administradores de um time.' };
  }

  if (!args.membro_a || !args.membro_b) {
    return { erro: 'Informe membro_a e membro_b.' };
  }

  const { data: candidatos, error: candidatosError } = await supabase
    .from('usuarios')
    .select('id, nome, email')
    .eq('team_id', teamId)
    .or(
      `nome.ilike.%${args.membro_a}%,email.ilike.%${args.membro_a}%,` +
      `nome.ilike.%${args.membro_b}%,email.ilike.%${args.membro_b}%`
    );

  if (candidatosError) return { erro: 'Falha ao buscar membros: ' + candidatosError.message };

  const encontrarMembro = (termo) =>
    (candidatos || []).find(
      (c) =>
        c.nome?.toLowerCase().includes(termo.toLowerCase()) ||
        c.email?.toLowerCase().includes(termo.toLowerCase())
    );

  const membroA = encontrarMembro(args.membro_a);
  const membroB = encontrarMembro(args.membro_b);

  if (!membroA || !membroB) {
    return { erro: 'Não encontrei um ou ambos os membros informados neste time.' };
  }

  const trintaDiasAtras = new Date();
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);
  const desdeISO = trintaDiasAtras.toISOString();

  const idsComparar = [membroA.id, membroB.id];

  const { data: atividades } = await supabase
    .from('atividades')
    .select('responsavel_id, status, prazo')
    .in('responsavel_id', idsComparar);

  const { data: transcricoes } = await supabase
    .from('transcricoes')
    .select('usuario_id, criado_em')
    .in('usuario_id', idsComparar)
    .gte('criado_em', desdeISO);

  const agora = new Date();

  function metricasDe(membro) {
    const minhasAtividades = (atividades || []).filter((a) => a.responsavel_id === membro.id);
    const minhasTranscricoes = (transcricoes || []).filter((t) => t.usuario_id === membro.id);

    return {
      membro: membro.nome,
      reunioes_ultimos_30_dias: minhasTranscricoes.length,
      atividades_concluidas: minhasAtividades.filter((a) => a.status === 'concluido').length,
      atividades_pendentes: minhasAtividades.filter((a) => a.status !== 'concluido').length,
      atividades_atrasadas: minhasAtividades.filter(
        (a) => a.status !== 'concluido' && a.prazo && new Date(a.prazo) < agora
      ).length
    };
  }

  return {
    membro_a: metricasDe(membroA),
    membro_b: metricasDe(membroB)
  };
}

export async function reunioes_sentimento_negativo(usuarioId, args) {
  args = args || {};

  const { ehAdmin, teamId } = await verificarAdminEObterTeam(usuarioId);

  if (!ehAdmin || !teamId) {
    return { erro: 'Esta ferramenta é exclusiva para administradores de um time.' };
  }

  const dias = diasParaPeriodo(args.periodo || 'mes');
  const desde = new Date();
  desde.setDate(desde.getDate() - dias);
  const desdeISO = desde.toISOString();

  const { data: membros, error: membrosError } = await supabase
    .from('usuarios')
    .select('id, nome')
    .eq('team_id', teamId);

  if (membrosError) return { erro: 'Falha ao buscar membros: ' + membrosError.message };

  let memberIds = membros.map((m) => m.id);
  const memberMap = Object.fromEntries(membros.map((m) => [m.id, m.nome]));

  if (args.membro) {
    const termo = args.membro.toLowerCase();
    memberIds = membros.filter((m) => m.nome?.toLowerCase().includes(termo)).map((m) => m.id);

    if (memberIds.length === 0) {
      return { erro: 'Não encontrei nenhum membro com esse nome neste time.' };
    }
  }

  const { data: transcricoes, error: transcricoesError } = await supabase
    .from('transcricoes')
    .select('id, nome, usuario_id, criado_em, sentimento, tem_risco_cancelamento, cliente_mencionado')
    .in('usuario_id', memberIds)
    .gte('criado_em', desdeISO)
    .or('sentimento.eq.negativo,tem_risco_cancelamento.eq.true')
    .order('criado_em', { ascending: false })
    .limit(LIMITE_RESULTADOS_BUSCA);

  if (transcricoesError) return { erro: 'Falha ao buscar reuniões: ' + transcricoesError.message };

  return {
    total_encontrado: (transcricoes || []).length,
    reunioes: (transcricoes || []).map((t) => ({
      id: t.id,
      nome: t.nome,
      membro: memberMap[t.usuario_id] || '—',
      data: t.criado_em,
      sentimento: t.sentimento,
      tem_risco_cancelamento: !!t.tem_risco_cancelamento,
      cliente_mencionado: t.cliente_mencionado || null
    }))
  };
}

export const THEO_TOOL_HANDLERS_SUPERVISOR = {
  resumo_desempenho_equipe: resumo_desempenho_equipe,
  comparar_membros: comparar_membros,
  reunioes_sentimento_negativo: reunioes_sentimento_negativo
};

// Monta a lista de tools + handlers a oferecer pro Groq, conforme o
// cargo do usuário. Chamado uma vez por pergunta em pages/api/theo/agente.js,
// ANTES de montar as messages — assim usuários não-admin nunca recebem
// (nem sabem que existem) as ferramentas de supervisão.
export function obterFerramentasParaUsuario(role) {
  const ehAdmin = (role || '').toLowerCase() === 'admin';

  if (!ehAdmin) {
    return { tools: THEO_TOOLS, handlers: THEO_TOOL_HANDLERS, ehAdmin: false };
  }

  return {
    tools: THEO_TOOLS.concat(THEO_TOOLS_SUPERVISOR),
    handlers: Object.assign({}, THEO_TOOL_HANDLERS, THEO_TOOL_HANDLERS_SUPERVISOR),
    ehAdmin: true
  };
}