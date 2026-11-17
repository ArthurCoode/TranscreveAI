// pages/api/transcrever.js
import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import supabase from '../../lib/supabase';
import FormData from 'form-data';
import fetch from 'node-fetch';
export const config = { api: { bodyParser: false } };
// helper para ler o body como buffer
function lerBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
// helper para parsear multipart simples
function parsearMultipart(buffer, boundary) {
  const str   = buffer.toString('binary');
  const parts = str.split('--' + boundary);
  const result = {};
  for (const part of parts) {
    if (!part || part === '--\r\n' || part.trim() === '--') continue;
    const [header, ...bodyParts] = part.split('\r\n\r\n');
    if (!header) continue;
    const body = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '');
    const nameMatch = header.match(/name="([^"]+)"/);
    if (nameMatch) {
      result[nameMatch[1]] = Buffer.from(body, 'binary');
    }
  }
  return result;
}
export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });
  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  // verifica cota + libera os booleans de feature do plano numa query só
  const { data: cota, error: erroCota } = await supabase
    .rpc('verificar_cota', { p_user_id: usuario.id })
    .single();

  if (erroCota || !cota) {
    // usuário sem plano_id válido (não deveria acontecer após o backfill, mas evita crash)
    return res.status(403).json({ erro: 'Não foi possível verificar seu plano. Contate o suporte.' });
  }

  if (!cota.pode_gravar) {
    return res.status(403).json({
      erro: 'Cota mensal esgotada. Faça upgrade do seu plano.',
      segundosUsados: cota.segundos_usados,
      segundosLimite: cota.segundos_limite
    });
  }

  try {
    // le o body como buffer
    const rawBuffer  = await lerBuffer(req);
    const contentType = req.headers['content-type'] || '';
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    let audioBuffer;
    let mimeType = 'audio/webm';
    // duração real do chunk em segundos, enviada pelo cliente (usada pra cobrança correta de cota)
    let duracaoSegundos = null;
    // origem do áudio: 'voce' (microfone) ou 'outros' (áudio da aba/outros participantes).
    // desde a extensão passar a gravar aba e microfone em streams separados, CADA bloco de
    // ~10s de reunião gera DUAS chamadas a este endpoint (uma de cada origem) — sem tratar
    // isso aqui, a cota do usuário seria debitada em dobro pro mesmo intervalo de tempo real.
    // Clientes antigos da extensão (sem esse campo) continuam funcionando normalmente:
    // origem fica null e o comportamento cai no mesmo caminho de sempre (cobra normalmente).
    let origem = null;
    if (boundaryMatch) {
      // multipart form-data (vindo direto)
      const parts = parsearMultipart(rawBuffer, boundaryMatch[1]);
      audioBuffer = parts['file'] || parts['audio'];
      if (parts['duracao']) {
        duracaoSegundos = parseFloat(parts['duracao'].toString('utf-8'));
      }
      if (parts['origem']) {
        origem = parts['origem'].toString('utf-8').trim();
      }
    } else {
      // json com array de bytes (vindo da extensao via background.js)
      const body = JSON.parse(rawBuffer.toString());
      audioBuffer = Buffer.from(body.audio);
      mimeType    = body.mimeType || 'audio/webm';
      duracaoSegundos = typeof body.duracaoSegundos === 'number' ? body.duracaoSegundos : null;
      origem = typeof body.origem === 'string' ? body.origem : null;
    }
    if (!audioBuffer || audioBuffer.length < 1000) {
      return res.status(400).json({ erro: 'Áudio muito curto ou inválido.' });
    }
    // envia para o Whisper via Groq
    // whisper-large-v3-turbo: ~64% mais barato que o large-v3 padrão ($0.04/h vs $0.111/h),
    // com WER (taxa de erro) só ~1% pior — troca compensa pro caso de uso de transcrição de reunião.
    //
    // ATENÇÃO CUSTO: com aba+microfone gravados separados, cada bloco de reunião agora gera
    // DUAS chamadas reais ao Whisper (uma por origem) — isso dobra o custo pago à Groq por
    // minuto de reunião gravado, independente de como a cota do usuário é contabilizada
    // abaixo. Essa parte não tem correção de código; é uma decisão de produto (vale o custo
    // extra pela identificação de quem fala, ou compensa filtrar blocos silenciosos antes
    // de mandar pro Whisper?).
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.webm', contentType: mimeType });
    form.append('model', 'whisper-large-v3-turbo');
    form.append('language', 'pt');
    // verbose_json + timestamp_granularities=segment: devolve, dentro da MESMA
    // chamada de ~10s, os horários de início/fim de cada frase transcrita.
    // Isso não custa nem demora mais que o response_format 'json' simples
    // (só timestamp de PALAVRA teria latência extra — não é o que pedimos
    // aqui). É o que permite ao content.js casar cada frase com o nome de
    // quem estava falando naquele instante específico, em vez de atribuir
    // o bloco de 10s inteiro a uma pessoa só.
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    const respGroq = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + process.env.GROQ_KEY, ...form.getHeaders() },
      body:    form
    });
    const data = await respGroq.json();
    if (data.error) return res.status(500).json({ erro: data.error.message });

    // segmentos individuais (frase a frase) com timestamp relativo ao início
    // deste blob de áudio, em segundos. Se por qualquer motivo a Groq não
    // devolver 'segments' (mudança de API, formato inesperado etc.), fica
    // um array vazio — o content.js já sabe cair de volta pro texto corrido
    // nesse caso, sem quebrar nada.
    const segmentos = Array.isArray(data.segments)
      ? data.segments.map(function(s) {
          return {
            texto:  s.text || '',
            inicio: typeof s.start === 'number' ? s.start : 0,
            fim:    typeof s.end === 'number' ? s.end : 0
          };
        })
      : [];

    // COTA — calculada no SERVIDOR, nunca a partir de dados do cliente.
    //
    // A duração vem do próprio Whisper (campo "duration" do verbose_json).
    // Antes usávamos "duracaoSegundos" e "origem" enviados pelo cliente, e
    // bastava mandar origem='voce' para nunca ter a cota debitada.
    //
    // Aba e microfone cobrem o MESMO intervalo de tempo real em dois canais.
    // Para não cobrar em dobro, cada canal identificado debita 50% da sua
    // duração (aba 50% + microfone 50% = 100% do tempo real). Um cliente
    // malicioso, no pior caso, consegue no máximo 2x a cota — não infinito.
    // Clientes antigos (sem "origem") debitam 100%, como antes.
    const duracaoWhisper = Number(data.duration);
    const duracaoBase = Number.isFinite(duracaoWhisper) && duracaoWhisper > 0
      ? duracaoWhisper
      : (Number.isFinite(duracaoSegundos) && duracaoSegundos > 0 ? Math.min(duracaoSegundos, 60) : 10);
    const canalSeparado = origem === 'voce' || origem === 'outros';
    const segundosConsumidos = Math.max(1, Math.round(duracaoBase * (canalSeparado ? 0.5 : 1)));

    const { error: erroIncremento } = await supabase.rpc('incrementar_uso', {
      p_user_id: usuario.id,
      p_segundos: segundosConsumidos
    });
    if (erroIncremento) {
      // não bloqueia a resposta pro usuário, mas loga pra investigar depois
      console.error('Falha ao incrementar uso:', erroIncremento.message);
    }

    return res.status(200).json({ ok: true, text: data.text || '', segments: segmentos });
  } catch (err) {
    console.error('Falha na transcrição:', err);
    return res.status(500).json({ erro: 'Falha na transcrição.' });
  }
}