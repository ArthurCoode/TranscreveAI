// lib/groq.js
// Funções utilitárias para chamar a API da Groq (transcrição de áudio + resumo/insights)

import fs from 'fs';

const GROQ_KEY = process.env.GROQ_KEY;
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';

// Envia o áudio para o Whisper da Groq e retorna o texto transcrito
export async function transcreverAudio(caminhoArquivo, nomeArquivo) {
  const buffer = fs.readFileSync(caminhoArquivo);
  const blob = new Blob([buffer]);

  const formData = new FormData();
  formData.append('file', blob, nomeArquivo);
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'verbose_json');
  formData.append('language', 'pt');

  const resp = await fetch(`${GROQ_BASE_URL}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_KEY}` },
    body: formData,
  });

  if (!resp.ok) {
    const erro = await resp.text();
    throw new Error(`Falha na transcrição (Groq): ${erro}`);
  }

  const json = await resp.json();

  return {
    texto: json.text || '',
    duracao: json.duration ? Math.round(json.duration) : null,
  };
}

// Gera resumo + insights a partir do texto transcrito.
// Em vez de pedir pro modelo escrever o texto JÁ formatado (**Título**,
// bullets etc.), pedimos os dados em campos separados e SEMPRE montamos
// o texto final aqui no código — assim o formato fica idêntico em toda
// reunião, não importa como a Groq decidiu escrever naquele dia.
export async function gerarResumoEInsights(textoTranscricao) {
  const prompt = `Você é um assistente que analisa transcrições de reuniões.
Leia a transcrição abaixo e responda APENAS em JSON, exatamente com este formato:

{
  "resumo_geral": "um ou dois parágrafos explicando do que se tratou a reunião",
  "decisoes": ["decisão 1", "decisão 2"],
  "proximos_passos": ["ação 1", "ação 2"],
  "pontos_atencao": ["ponto 1"],
  "insights": ["insight 1", "insight 2", "insight 3"]
}

Regras:
- Cada item de "decisoes", "proximos_passos" e "pontos_atencao" é uma frase curta e objetiva, sem numeração e sem marcadores (o código adiciona os marcadores depois).
- Texto puro, sem markdown, sem **negrito**, sem títulos dentro dos campos.
- Se não houver conteúdo relevante para "decisoes", "proximos_passos" ou "pontos_atencao", use um array vazio [] — não invente conteúdo.
- "insights" deve ter de 3 a 6 frases curtas.

Transcrição:
"""
${textoTranscricao.slice(0, 15000)}
"""`;

  const resp = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const erro = await resp.text();
    throw new Error(`Falha ao gerar resumo (Groq): ${erro}`);
  }

  const json = await resp.json();
  const conteudo = json.choices?.[0]?.message?.content || '{}';

  let dados = {};
  try {
    dados = JSON.parse(conteudo);
  } catch {
    // se vier algo que não é JSON válido, segue com dados vazios
    // (montarResumo já lida bem com campos ausentes)
  }

  return {
    resumo: montarResumo(dados),
    insights: Array.isArray(dados.insights) ? dados.insights : [],
  };
}

// Monta o texto final do resumo SEMPRE no mesmo formato
// (**Título** sozinho na linha + bullets "- item"), a partir dos
// campos estruturados que vieram da Groq. É isso que garante que
// toda reunião renderize igual no front (formatarResumo/extrairBlocosResumo).
function montarResumo(dados) {
  const secoes = [];

  if (dados.resumo_geral?.trim()) {
    secoes.push(`**Resumo Geral**\n${dados.resumo_geral.trim()}`);
  }

  if (Array.isArray(dados.decisoes) && dados.decisoes.length) {
    secoes.push(`**Decisões**\n${dados.decisoes.map(d => `- ${d}`).join('\n')}`);
  }

  if (Array.isArray(dados.proximos_passos) && dados.proximos_passos.length) {
    secoes.push(`**Próximos Passos**\n${dados.proximos_passos.map(p => `- ${p}`).join('\n')}`);
  }

  if (Array.isArray(dados.pontos_atencao) && dados.pontos_atencao.length) {
    secoes.push(`**Pontos de Atenção**\n${dados.pontos_atencao.map(p => `- ${p}`).join('\n')}`);
  }

  return secoes.join('\n\n') || 'Sem resumo disponível.';
}