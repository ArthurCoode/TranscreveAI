// theo-busca.js
//
// Motor de busca do Theo (Fase 1 - sem IA).
// Em vez de chamar um LLM, o Theo extrai palavras-chave da pergunta do
// usuário e procura diretamente na transcrição os trechos mais relevantes,
// retornando a citação, o horário e o autor da fala (quando existirem).
//
// LIMITAÇÃO IMPORTANTE: isso é busca lexical, não compreensão de linguagem.
// Funciona bem para perguntas como:
//   "Foi falado sobre o orçamento?"
//   "Quando o prazo foi mencionado?"
//   "O que disseram sobre o cliente X?"
// Não funciona para perguntas que exigem síntese, sem um termo concreto
// pra buscar, como:
//   "Resuma a reunião" / "Quais foram as decisões?" / "Quais os próximos passos?"
// Essas exigem um passo de IA (resumo/extração) feito antes ou depois — ver
// nota no final do arquivo.

const TheoBusca = (() => {
  // Palavras de baixo valor semântico: question words, verbos genéricos do
  // próprio padrão de perguntas do Theo, preposições, artigos etc.
  const STOPWORDS = new Set([
    'a','o','as','os','de','da','do','das','dos','em','no','na','nos','nas',
    'um','uma','uns','umas','e','ou','que','se','por','para','com','sem',
    'foi','foram','houve','ha','há','é','sao','são','esta','está','estao','estão',
    'qual','quais','quando','quem','como','onde','porque','por que',
    'sobre','isso','essa','esse','esses','essas','este','esta','aquele','aquela',
    'falado','falou','falaram','mencionado','mencionou','mencionaram',
    'comentou','comentaram','comentado','discutido','discutiram','discutiu',
    'definido','definiram','definiu','ficou','ficaram','tomada','tomadas','tomado','tomados',
    'reuniao','reunião','transcricao','transcrição','assunto','tema',
    'algum','alguma','alguns','algumas','nao','não','tambem','também',
    'eu','voce','você','ele','ela','eles','elas','nos','nós','meu','minha','seu','sua',
    // verbos genéricos / de opinião — causam falsos positivos por serem muito
    // curtos e aparecerem como substring dentro de várias outras palavras
    // (ex: "ser" dentro de "observar", "reserva", "conservador"...), e também
    // porque perguntas de opinião ("parece difícil?") não são buscáveis por
    // palavra-chave, precisam cair no fallback de IA.
    'ser','sera','será','seria','estar','tera','terá','teria',
    'parece','parecem','pareceu','parecer',
    'acha','acho','achei','achar','acreditam','acredita',
    'pensa','pensam','opiniao','opinião',
  ]);

  function normalizar(texto) {
    return String(texto)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, ''); // remove acentos
  }

  // Detecta perguntas de OPINIÃO/JULGAMENTO (ex: "isso parece difícil?",
  // "você acha que foi uma boa negociação?", "como foi o clima da reunião?").
  // Essas perguntas podem ter palavras que existem literalmente na
  // transcrição (ex: "venda", "difícil"), mas a resposta certa não é
  // devolver o trecho onde a palavra aparece — é uma interpretação, que
  // exige IA. Quando isso é detectado, o orquestrador (theo.js) ignora o
  // resultado da busca literal e força a passagem para o fallback de IA.
  const MARCADORES_INTERPRETATIVOS = [
    'parece', 'parecem', 'pareceu', 'parecer',
    'acha', 'acho', 'achei', 'acreditam', 'acredita',
    'opiniao', 'classificaria', 'diria', 'consideraria',
    'do seu ponto de vista', 'na sua visao',
  ];

  function ehPerguntaInterpretativa(pergunta) {
    const perguntaNorm = normalizar(pergunta);
    if (MARCADORES_INTERPRETATIVOS.some((m) => perguntaNorm.includes(m))) return true;
    if (/\bcomo (foi|esta|ficou|estava)\b/.test(perguntaNorm)) return true;
    return false;
  }

  function extrairPalavrasChave(pergunta) {
    const palavras = normalizar(pergunta)
      .replace(/[?!.,;:]/g, ' ')
      .split(/\s+/)
      .filter((p) => p.length >= 3 && !STOPWORDS.has(p));
    return [...new Set(palavras)];
  }

  // Aceita tanto um array de segmentos já estruturados:
  //   [{ speaker: 'João', inicio: '00:12:30', texto: '...' }, ...]
  // quanto uma string única de transcrição.
  function segmentar(transcricao) {
    if (Array.isArray(transcricao)) {
      return transcricao.map((s) => ({
        speaker: s.speaker || s.autor || null,
        timestamp: s.inicio || s.timestamp || s.tempo || null,
        texto: s.texto || s.text || '',
      }));
    }

    const texto = String(transcricao);
    const linhas = texto.split(/\n+/).filter(Boolean);

    // Tenta reconhecer um padrão comum: "[00:12:30] Nome: fala"
    // Ajuste esse regex se o seu formato de transcrição for diferente.
    const padraoLinha = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*[-–]?\s*([^:]{1,40}):\s*(.+)$/;

    const segmentosComEstrutura = linhas.map((linha) => {
      const m = linha.match(padraoLinha);
      if (m) {
        return { speaker: m[2].trim(), timestamp: m[1], texto: m[3].trim() };
      }
      return null;
    });

    if (segmentosComEstrutura.every(Boolean) && segmentosComEstrutura.length > 0) {
      return segmentosComEstrutura;
    }

    // Fallback: sem estrutura reconhecida, quebra em frases.
    return texto
      .split(/(?<=[.!?])\s+/)
      .filter((f) => f.trim().length > 0)
      .map((f) => ({ speaker: null, timestamp: null, texto: f.trim() }));
  }

  function escaparRegex(texto) {
    return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // \b à esquerda evita falso positivo tipo "ser" casando dentro de
  // "observar"/"reserva", mas permite casar prefixo de palavras maiores
  // (ex: "decis" casa "decisão" e "decisões") — útil em português, onde
  // plural/conjugação mudam o final da palavra.
  function pontuarSegmento(segmentoNormalizado, palavrasChave) {
    let pontos = 0;
    for (const palavra of palavrasChave) {
      const regex = new RegExp(`\\b${escaparRegex(palavra)}`, 'g');
      const ocorrencias = (segmentoNormalizado.match(regex) || []).length;
      pontos += ocorrencias;
    }
    return pontos;
  }

  function destacar(texto, palavrasChave) {
    let resultado = texto;
    for (const palavra of palavrasChave) {
      const regex = new RegExp(`\\b(${escaparRegex(palavra)}\\w*)`, 'gi');
      resultado = resultado.replace(regex, '**$1**');
    }
    return resultado;
  }

  // Retorna até `limite` trechos mais relevantes, com contexto (a frase
  // anterior e a seguinte), já formatados para exibição.
  function buscar(transcricao, pergunta, limite = 4) {
    const ehInterpretativa = ehPerguntaInterpretativa(pergunta);
    const palavrasChave = extrairPalavrasChave(pergunta);

    if (palavrasChave.length === 0) {
      return {
        encontrouAlgo: false,
        semTermoBuscavel: true,
        ehInterpretativa,
        resultados: [],
      };
    }

    const segmentos = segmentar(transcricao);

    const pontuados = segmentos
      .map((seg, indice) => ({
        ...seg,
        indice,
        pontos: pontuarSegmento(normalizar(seg.texto), palavrasChave),
      }))
      .filter((s) => s.pontos > 0)
      .sort((a, b) => b.pontos - a.pontos)
      .slice(0, limite);

    if (pontuados.length === 0) {
      return { encontrouAlgo: false, semTermoBuscavel: false, ehInterpretativa, resultados: [] };
    }

    const resultados = pontuados
      .sort((a, b) => a.indice - b.indice) // volta pra ordem cronológica
      .map((s) => ({
        speaker: s.speaker,
        timestamp: s.timestamp,
        textoDestacado: destacar(s.texto, palavrasChave),
      }));

    return { encontrouAlgo: true, semTermoBuscavel: false, ehInterpretativa, resultados, palavrasChave };
  }

  // Monta a resposta final em texto, já no estilo do Theo (tópicos, citação,
  // autor e horário quando existirem).
  function responder(transcricao, pergunta) {
    const { encontrouAlgo, semTermoBuscavel, resultados } = buscar(transcricao, pergunta);

    if (semTermoBuscavel) {
      return (
        'Não consegui identificar um termo específico para buscar nessa pergunta.\n' +
        'Essa busca funciona melhor para perguntas sobre um assunto concreto ' +
        '(ex: "foi falado sobre o orçamento?"). Perguntas de resumo ou síntese ' +
        '("quais foram as decisões?") ainda não são suportadas nesta versão.'
      );
    }

    if (!encontrouAlgo) {
      return 'Não encontrei essa informação na transcrição.';
    }

    const linhas = resultados.map((r) => {
      const origem = [r.speaker, r.timestamp].filter(Boolean).join(' · ');
      const prefixo = origem ? `**${origem}:** ` : '• ';
      return `${prefixo}"${r.textoDestacado}"`;
    });

    return linhas.join('\n\n');
  }

  return { buscar, responder, extrairPalavrasChave, ehPerguntaInterpretativa };
})();

// ---
// Nota sobre evolução futura (Fase 2, opcional):
// Para perguntas de síntese ("resuma", "quais as decisões", "próximos passos"),
// dá pra evitar IA em tempo real reaproveitando os insights estruturados que
// você já extrai no upload da reunião (tópicos, decisões, tarefas, riscos,
// sentimento) — se essas perguntas baterem com esses campos pré-computados,
// o Theo responde lendo direto do Supabase, sem chamar nenhum modelo agora.
// Só perguntas realmente abertas precisariam, no futuro, do endpoint /api/theo/chat.