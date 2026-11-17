// theo-insights.js
//
// Camada de respostas "de síntese" do Theo (custo zero — não chama IA).
// Usa exatamente os mesmos dados que já aparecem nas abas "Resumo" e
// "Insights" do modal de transcrição (dados.resumo e dados.insights,
// vindos de /api/transcricoes/:id). Não inventa nenhuma estrutura nova:
// interpreta o texto do resumo em seções "**Título**\nconteúdo" do MESMO
// jeito que formatarResumo() já faz em transcricoes.js pra exibir na tela
// — então a resposta do Theo fica sempre consistente com o que o usuário
// já vê na aba Resumo.

const TheoInsights = (() => {
  const PADROES = [
    { intencao: 'decisoes', termos: ['decis'] },
    { intencao: 'tarefas', termos: ['tarefa', 'acao', 'a fazer', 'pendenc', 'proximos passos', 'proxima etapa', 'next steps'] },
    { intencao: 'riscos', termos: ['risco', 'objec', 'preocupac', 'duvida', 'problema', 'obstaculo'] },
    { intencao: 'sentimento', termos: ['sentimento', 'clima', 'tom da reuniao', 'satisfacao', 'humor'] },
    { intencao: 'topicos', termos: ['topico', 'assunto', 'pauta', 'sobre o que', 'temas'] },
    { intencao: 'insights', termos: ['insight', 'destaque', 'observac'] },
    { intencao: 'resumo', termos: ['resum', 'principais pontos', 'visao geral', 'sintese', 'de que se trata'] },
  ];

  // termos de título usados pra localizar a seção certa dentro do resumo
  const TERMOS_TITULO_POR_INTENCAO = {
    decisoes: ['decis'],
    tarefas: ['tarefa', 'acao', 'proximos passos', 'pendenc'],
    riscos: ['risco', 'objec', 'preocupac'],
    sentimento: ['sentimento', 'clima', 'tom'],
    topicos: ['topico', 'assunto', 'tema'],
  };

  function normalizar(texto) {
    return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function detectarIntencao(pergunta) {
    const perguntaNorm = normalizar(pergunta);
    for (const padrao of PADROES) {
      if (padrao.termos.some((termo) => perguntaNorm.includes(termo))) return padrao.intencao;
    }
    return null;
  }

  // Mesmo split que formatarResumo() usa em transcricoes.js, pra ler as
  // seções "**Título**" do resumo gerado pela IA no upload.
  function dividirEmSecoes(resumoTexto) {
    if (!resumoTexto) return [];
    const partes = resumoTexto.split(/\*\*(.*?)\*\*/).filter(Boolean);
    const secoes = [];
    for (let i = 0; i < partes.length; i += 2) {
      secoes.push({ titulo: (partes[i] || '').trim(), conteudo: (partes[i + 1] || '').trim() });
    }
    return secoes;
  }

  function encontrarSecao(secoes, termosBusca) {
    return secoes.find((s) => {
      const tituloNorm = normalizar(s.titulo);
      return termosBusca.some((t) => tituloNorm.includes(t));
    });
  }

  function formatarConteudoSecao(conteudo) {
    const linhas = conteudo.split('\n').map((l) => l.trim()).filter(Boolean);
    return linhas.map((l) => (l.startsWith('*') ? `• ${l.replace(/^\*\s?/, '')}` : l)).join('\n');
  }

  // `dados` = { resumo: string, insightsLista: string[] } — os mesmos
  // campos que já vêm de /api/transcricoes/:id (dados.resumo, dados.insights).
  function responder(dados, intencao) {
    if (!dados) return null;
    const secoes = dividirEmSecoes(dados.resumo);

    if (intencao === 'insights') {
      if (!dados.insightsLista || dados.insightsLista.length === 0) return null;
      return dados.insightsLista.map((i) => `• ${i}`).join('\n');
    }

    if (intencao === 'resumo') {
      if (!secoes.length) return null;
      const secaoGeral = encontrarSecao(secoes, ['resumo geral', 'visao geral', 'geral']);
      if (secaoGeral) return formatarConteudoSecao(secaoGeral.conteudo);
      // sem seção "geral" identificada: devolve todas as seções concatenadas
      return secoes.map((s) => `**${s.titulo}**\n${formatarConteudoSecao(s.conteudo)}`).join('\n\n');
    }

    const termos = TERMOS_TITULO_POR_INTENCAO[intencao];
    if (!termos || !secoes.length) return null;

    const secaoEncontrada = encontrarSecao(secoes, termos);
    if (!secaoEncontrada) return null;

    return formatarConteudoSecao(secaoEncontrada.conteudo);
  }

  return { detectarIntencao, responder };
})();