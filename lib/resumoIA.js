// lib/resumoIA.js
import fetch from 'node-fetch';

const SECOES_PADRAO = [
  'VISÃO GERAL',
  'PRINCIPAIS TÓPICOS DISCUTIDOS',
  'VALORES E CONDIÇÕES COMERCIAIS',
  'DECISÕES TOMADAS',
  'PRÓXIMOS PASSOS'
];

const SENTIMENTOS_VALIDOS = ['positivo', 'neutro', 'negativo'];
const NIVEIS_VALIDOS = ['alta', 'media', 'baixa']; // usado por intencao_compra e nivel_urgencia
const TIPOS_REUNIAO_VALIDOS = ['venda', 'suporte', 'alinhamento', 'interno', 'negociacao', 'outro'];

function montarPrompts(transcricao) {
  // Reduzido de 12000 para 6000 caracteres (~1500 tokens em pt-BR) para
  // caber com folga no limite de TPM (6000 tokens/request) do tier
  // on_demand atual do Groq, considerando também o tamanho do system
  // prompt, do user prompt e do max_tokens reservado para a resposta.
  const MAX = 5000;
  var texto = transcricao;
  if (texto.length > MAX) {
    const m = Math.floor(MAX / 2);
    texto = texto.substring(0, m) + '\n\n[... trecho omitido ...]\n\n' + texto.substring(texto.length - m);
  }

  const SYSTEM_PROMPT =
    'Você é um assistente especializado em analisar transcrições de reuniões corporativas em português do Brasil, ' +
    'incluindo reuniões comerciais/vendas, técnicas, internas e de alinhamento com clientes. Gere relatórios ' +
    'executivos completos e precisos.\n\n' +
    'REGRAS ABSOLUTAS DE SAÍDA:\n' +
    '- Responda SOMENTE com um objeto JSON válido. Nada de markdown, nada de ```json, nada de texto antes ou depois.\n' +
    '- O JSON deve ter EXATAMENTE estas quatro chaves: "resumo" (string), "insights" (array de strings), ' +
    '"metadados" (objeto) e "acoes" (array de objetos).\n' +
    '- Dentro de qualquer string do JSON (incluindo "resumo"), toda quebra de linha DEVE ser escrita como a sequência de ' +
    'escape \\n (dois caracteres: barra invertida e n). NUNCA insira uma quebra de linha real dentro de uma string — isso quebra o JSON.\n' +
    '- Nunca omita nenhuma das 5 seções do resumo, mesmo que não haja conteúdo — nesse caso escreva a seção com o texto ' +
    '"Não identificado nesta reunião." logo abaixo do header.\n' +
    '- Os headers das seções são FIXOS e devem ser copiados EXATAMENTE como no exemplo abaixo — mesmas palavras, ' +
    'todos em LETRAS MAIÚSCULAS, sem numeração, sem markdown (nada de ** ou #), cada um em sua própria linha.\n' +
    '- Escape corretamente aspas e quebras de linha para o JSON ser sempre parseável por JSON.parse().\n' +
    '- NUNCA repita a mesma frase, bullet ou ideia mais de uma vez em nenhum campo. Se não houver mais conteúdo ' +
    'relevante para uma seção, PARE de escrever — não preencha espaço repetindo frases anteriores com pequenas variações.';

  const USER_PROMPT =
    'Analise a transcrição abaixo e gere um relatório executivo completo em formato JSON com quatro campos: ' +
    '"resumo", "insights", "metadados" e "acoes".\n\n' +
    '1) "resumo": string única contendo as 5 seções abaixo, NESTA ORDEM, cada header em uma linha própria, ' +
    'seguido do conteúdo, com uma linha em branco (\\n\\n) entre seções:\n\n' +
    'VISÃO GERAL\n' +
    'Faça um resumo executivo em 3 a 5 frases contendo: objetivo da reunião; participantes envolvidos; ' +
    'resultado principal; contexto geral.\n\n' +
    'PRINCIPAIS TÓPICOS DISCUTIDOS\n' +
    'Liste em bullets (use "- " no início de cada linha): assuntos abordados; problemas levantados; ' +
    'necessidades identificadas; dúvidas importantes; pontos relevantes.\n\n' +
    'VALORES E CONDIÇÕES COMERCIAIS\n' +
    'Extraia absolutamente todos: preços; valores; descontos; planos; contratos; pagamentos; prazos; ' +
    'quantidades; condições negociadas. Nunca arredonde valores. Nunca altere números. ' +
    'Se não existir, escreva apenas: "Não identificado nesta reunião."\n\n' +
    'DECISÕES TOMADAS\n' +
    'Liste somente decisões realmente aprovadas. Inclua, por bullet: decisão; responsável; contexto. ' +
    'Não coloque sugestões como decisões.\n\n' +
    'PRÓXIMOS PASSOS\n' +
    'Liste ações futuras. Sempre que possível informe, por bullet: ação; responsável; prazo.\n\n' +
    '2) "insights": no máximo 5 insights estratégicos, curtos e diretos, SEM REPETIÇÃO entre si e sem repetir ' +
    'informações já ditas no "resumo", sem numeração, cada um iniciado por um destes prefixos conforme o caso — ' +
    '"Oportunidade: ", "Risco: ", "Alerta: ", "Objeção: ", "Intenção de compra: ", "Melhoria: ", "Valor comercial: " — ' +
    'priorizando informações que ajudem alguém a tomar decisões. Exemplos:\n' +
    '"Oportunidade: Cliente demonstrou interesse em ampliar o contrato após resolver integração inicial."\n' +
    '"Risco: Cliente mencionou dificuldade operacional que pode atrasar a implementação."\n' +
    '"Objeção: Cliente apresentou preocupação com investimento mensal."\n' +
    'Se não houver 5 insights distintos para extrair, devolva menos — nunca repita ou reformule o mesmo ponto.\n\n' +
    '3) "metadados": objeto com EXATAMENTE estas chaves:\n' +
    '   - "temas": array com até 6 palavras-chave curtas em minúsculas resumindo os assuntos centrais. Nunca ' +
    'deixe vazio — se a reunião for genérica, descreva o assunto principal mesmo assim.\n' +
    '   - "cliente_mencionado": nome da empresa ou cliente citado, ou null se nenhum cliente específico foi ' +
    'mencionado (reunião puramente interna).\n' +
    '   - "participantes": array com os nomes próprios das pessoas identificadas na conversa, ou array vazio [] ' +
    'se não for possível identificar nomes.\n' +
    '   - "sentimento": classifique o tom geral da reunião como exatamente uma destas três strings — ' +
    '"positivo", "neutro" ou "negativo".\n' +
    '   - "tem_reclamacao": true se o cliente ou algum participante reclamou de algo, false caso contrário.\n' +
    '   - "tem_risco_cancelamento": true se houve QUALQUER menção, mesmo indireta, a cancelar, não renovar, ' +
    'trocar de fornecedor ou encerrar o contrato/serviço, false caso contrário.\n' +
    '   - "intencao_compra": classifique como exatamente uma destas strings — "alta", "media", "baixa" — ' +
    'ou null se não for possível avaliar (ex: reunião sem contexto comercial).\n' +
    '   - "nivel_urgencia": classifique como exatamente uma destas strings — "alta", "media", "baixa" — ' +
    'ou null se não for possível avaliar.\n' +
    '   - "tipo_reuniao": classifique como exatamente uma destas strings — "venda", "suporte", "alinhamento", ' +
    '"interno", "negociacao", "outro".\n\n' +
    '4) "acoes": array com no máximo 5 objetos representando ações concretas e acionáveis extraídas da seção ' +
    '"PRÓXIMOS PASSOS" (e de qualquer outro trecho da reunião onde alguém se comprometeu a fazer algo). ' +
    'Cada objeto deve ter EXATAMENTE estas chaves:\n' +
    '   - "titulo": string curta e imperativa descrevendo a ação (ex: "Enviar proposta comercial atualizada"). ' +
    'Nunca inclua nome de responsável ou prazo dentro do título — isso vai em campos separados.\n' +
    '   - "prazo_sugerido": uma data no formato "YYYY-MM-DD" SOMENTE se um prazo explícito e claro foi mencionado ' +
    'na reunião (ex: "até sexta", "semana que vem", "dia 15") — nesses casos, calcule a data real assumindo que ' +
    'hoje é o dia da reunião. Se nenhum prazo foi mencionado, use null. NUNCA invente uma data.\n' +
    'Se a reunião não tiver nenhuma ação concreta e acionável (ex: reunião puramente informativa, sem combinados), ' +
    'devolva um array vazio []. Não invente ações genéricas só para preencher o campo.\n\n' +
    'FORMATO EXATO ESPERADO PARA O CAMPO "resumo" (copie este padrão de escrita literalmente, ' +
    'apenas substituindo o conteúdo de cada seção pelo conteúdo real da reunião — lembre-se: \\n é a sequência ' +
    'de escape, não uma quebra de linha real):\n\n' +
    'VISÃO GERAL\n' +
    'Texto aqui.\n\n' +
    'PRINCIPAIS TÓPICOS DISCUTIDOS\n' +
    '- item 1\n- item 2\n\n' +
    'VALORES E CONDIÇÕES COMERCIAIS\n' +
    '- item 1\n\n' +
    'DECISÕES TOMADAS\n' +
    '- item 1\n\n' +
    'PRÓXIMOS PASSOS\n' +
    '- item 1\n\n' +
    'Os headers acima (VISÃO GERAL, PRINCIPAIS TÓPICOS DISCUTIDOS, VALORES E CONDIÇÕES COMERCIAIS, ' +
    'DECISÕES TOMADAS, PRÓXIMOS PASSOS) devem ser copiados exatamente como estão escritos aqui, ' +
    'sempre em letras maiúsculas, sem nenhuma outra formatação, mesmo que o conteúdo da seção mude.\n\n' +
    'EXEMPLO DO CAMPO "metadados" (apenas ilustrativo, substitua pelos dados reais da reunião):\n' +
    '{"temas":["preço","renovação de contrato"],"cliente_mencionado":"Acme Ltda","participantes":["João","Maria"],' +
    '"sentimento":"negativo","tem_reclamacao":true,"tem_risco_cancelamento":false,"intencao_compra":"media",' +
    '"nivel_urgencia":"alta","tipo_reuniao":"negociacao"}\n\n' +
    'EXEMPLO DO CAMPO "acoes" (apenas ilustrativo, substitua pelos dados reais da reunião):\n' +
    '[{"titulo":"Enviar proposta comercial revisada","prazo_sugerido":"2026-08-08"},' +
    '{"titulo":"Agendar reunião de follow-up com o time técnico","prazo_sugerido":null}]\n\n' +
    'TRANSCRIÇÃO:\n' + texto;

  return { SYSTEM_PROMPT, USER_PROMPT };
}

// Chama o Groq e devolve { ok: true, resumo, insights, metadados, acoes } ou { ok: false, erro }
export async function gerarResumoDeTranscricao(transcricao) {
  if (!transcricao || !transcricao.trim()) {
    return { ok: false, erro: 'Transcrição vazia.' };
  }

  const { SYSTEM_PROMPT, USER_PROMPT } = montarPrompts(transcricao);

  let resp, data;
  try {
    resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + process.env.GROQ_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        temperature: 0.2,
        // Junto com o corte de transcrição para 5000 caracteres, garante
        // que prompt + resposta fiquem com folga abaixo do limite de
        // 6000 tokens/request (TPM) do tier on_demand atual do Groq,
        // mesmo com o prompt maior (mais campos de metadados + acoes).
        max_tokens: 1400,
        // Penaliza tokens/frases já usados na resposta, reduzindo a chance
        // do modelo entrar em loop de repetição (ex: ficar repetindo a
        // mesma frase de insight dezenas de vezes até estourar o tamanho).
        frequency_penalty: 0.5,
        presence_penalty: 0.3,
        // Força o Groq a sempre devolver um JSON sintaticamente válido.
        // Isso elimina a causa mais comum de quebra: o modelo inserindo
        // quebras de linha reais (em vez de \n escapado) dentro das strings.
        // Importante: JSON válido não significa conteúdo são — o guard
        // de repetição abaixo cobre o caso de loop dentro das strings.
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: USER_PROMPT }
        ]
      })
    });
    data = await resp.json();
  } catch (err) {
    return { ok: false, erro: 'Falha ao chamar a IA: ' + err.message };
  }

  if (data.error) return { ok: false, erro: data.error.message };

  const bruto = data.choices?.[0]?.message?.content?.trim() || '';
  const parsed = tentarParsearJSON(bruto);

  if (!parsed || typeof parsed.resumo !== 'string') {
    console.warn('Resumo nao veio em JSON valido mesmo apos reparo. Resposta bruta do modelo:', bruto);
    return { ok: false, erro: 'Não foi possível gerar o resumo (formato inválido retornado pela IA). Tente novamente.' };
  }

  const resumoSemLoop = cortarRepeticoes(parsed.resumo);
  const resumo = garantirSecoes(resumoSemLoop);

  const insightsBrutos = Array.isArray(parsed.insights) ? parsed.insights.filter(Boolean) : [];
  const vistos = new Set();
  const insights = [];
  for (const item of insightsBrutos) {
    const chave = String(item).trim().toLowerCase();
    if (!chave || vistos.has(chave)) continue;
    vistos.add(chave);
    insights.push(String(item).trim());
    if (insights.length >= 5) break;
  }

  const metadados = validarMetadados(parsed.metadados);
  const acoes = validarAcoes(parsed.acoes);

  return { ok: true, resumo, insights, metadados, acoes };
}

function tentarParsearJSON(bruto) {
  var tentativas = [
    bruto,
    bruto.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, ''),
  ];

  var match = bruto.match(/\{[\s\S]*\}/);
  if (match) tentativas.push(match[0]);

  for (var i = 0; i < tentativas.length; i++) {
    var candidato = tentativas[i].trim();

    try {
      var obj = JSON.parse(candidato);
      if (obj && typeof obj.resumo === 'string') return obj;
    } catch (e) {}

    try {
      var reparado = repararNewlinesEmStrings(candidato);
      var obj2 = JSON.parse(reparado);
      if (obj2 && typeof obj2.resumo === 'string') return obj2;
    } catch (e) {}
  }
  return null;
}

function repararNewlinesEmStrings(str) {
  var out = '';
  var dentroDeString = false;
  for (var i = 0; i < str.length; i++) {
    var ch = str[i];
    if (ch === '"' && str[i - 1] !== '\\') {
      dentroDeString = !dentroDeString;
      out += ch;
      continue;
    }
    if (dentroDeString) {
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { continue; }
      if (ch === '\t') { out += '\\t'; continue; }
    }
    out += ch;
  }
  return out;
}

// Guard contra degeneração por repetição: modelos pequenos às vezes
// entram em loop e ficam repetindo a mesma frase/bullet (com pequenas
// variações de palavra) até estourar o max_tokens, mesmo dentro de um
// JSON sintaticamente válido. Isso não quebra o parse, mas produz um
// resumo ilegível (ex: "A equipe precisa de mais X..." dezenas de vezes).
//
// Estratégia: percorre linha a linha; se a MESMA linha (normalizada)
// aparecer mais de 2 vezes, considera que entrou em loop e corta o
// texto ali, descartando o restante (que é lixo repetido).
function cortarRepeticoes(texto) {
  if (!texto) return texto;

  const linhas = texto.split('\n');
  const contagem = {};
  const resultado = [];

  for (const linha of linhas) {
    const chave = linha.trim().toLowerCase();

    if (!chave) {
      resultado.push(linha);
      continue;
    }

    contagem[chave] = (contagem[chave] || 0) + 1;

    if (contagem[chave] > 2) {
      // achou um loop de repetição — para aqui e descarta o resto
      break;
    }

    resultado.push(linha);
  }

  return resultado.join('\n').trim();
}

// garante que todas as 5 secoes padrao existam no texto do resumo,
// mesmo que o modelo tenha esquecido alguma — evita quebrar o parser
// do dashboard que espera headers fixos (case-insensitive)
function garantirSecoes(resumo) {
  var texto = resumo || '';
  var normalizado = normalizarParaComparacao(texto);

  SECOES_PADRAO.forEach(function(header) {
    var headerNormalizado = normalizarParaComparacao(header);
    if (normalizado.indexOf(headerNormalizado) === -1) {
      texto += '\n\n' + header + '\nNão identificado nesta reunião.';
      normalizado = normalizarParaComparacao(texto);
    }
  });

  return texto.trim();
}

function normalizarParaComparacao(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}

function validarMetadados(m) {
  var base = metadadosVazios();
  if (!m || typeof m !== 'object') return base;

  if (Array.isArray(m.temas)) {
    base.temas = m.temas
      .filter(function(t) { return typeof t === 'string' && t.trim().length > 0; })
      .map(function(t) { return t.trim().toLowerCase(); })
      .slice(0, 6);
  }

  if (typeof m.cliente_mencionado === 'string' && m.cliente_mencionado.trim().length > 0) {
    base.cliente_mencionado = m.cliente_mencionado.trim();
  }

  if (Array.isArray(m.participantes)) {
    base.participantes = m.participantes
      .filter(function(p) { return typeof p === 'string' && p.trim().length > 0; })
      .map(function(p) { return p.trim(); })
      .slice(0, 20);
  }

  if (SENTIMENTOS_VALIDOS.indexOf(m.sentimento) !== -1) {
    base.sentimento = m.sentimento;
  }

  base.tem_reclamacao = m.tem_reclamacao === true;
  base.tem_risco_cancelamento = m.tem_risco_cancelamento === true;

  if (NIVEIS_VALIDOS.indexOf(m.intencao_compra) !== -1) {
    base.intencao_compra = m.intencao_compra;
  }

  if (NIVEIS_VALIDOS.indexOf(m.nivel_urgencia) !== -1) {
    base.nivel_urgencia = m.nivel_urgencia;
  }

  if (TIPOS_REUNIAO_VALIDOS.indexOf(m.tipo_reuniao) !== -1) {
    base.tipo_reuniao = m.tipo_reuniao;
  }

  return base;
}

function metadadosVazios() {
  return {
    temas: [],
    cliente_mencionado: null,
    participantes: [],
    sentimento: null, // null = não analisado; nunca inventa um valor
    tem_reclamacao: false,
    tem_risco_cancelamento: false,
    intencao_compra: null,   // null = não avaliado; nunca inventa um valor
    nivel_urgencia: null,    // null = não avaliado; nunca inventa um valor
    tipo_reuniao: null       // null = não classificado; nunca inventa um valor
  };
}

// valida o array "acoes" vindo do modelo — nunca confia cegamente no
// formato/tamanho, já que isso alimenta INSERTs na tabela "atividades".
// Formato de data aceito: YYYY-MM-DD estrito; qualquer coisa fora disso
// vira null (sem prazo) em vez de tentar adivinhar.
const REGEX_DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function validarAcoes(lista) {
  if (!Array.isArray(lista)) return [];

  const resultado = [];
  for (const item of lista) {
    if (!item || typeof item !== 'object') continue;
    const titulo = typeof item.titulo === 'string' ? item.titulo.trim() : '';
    if (!titulo) continue;

    let prazoSugerido = null;
    if (typeof item.prazo_sugerido === 'string' && REGEX_DATA_ISO.test(item.prazo_sugerido.trim())) {
      prazoSugerido = item.prazo_sugerido.trim();
    }

    resultado.push({ titulo: titulo.slice(0, 140), prazo_sugerido: prazoSugerido });
    if (resultado.length >= 5) break;
  }

  return resultado;
}