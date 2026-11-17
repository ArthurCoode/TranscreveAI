// pages/api/transcricoes/upload.js
// POST → recebe um arquivo de áudio, transcreve via Groq Whisper, gera o
// relatório (mesmo pipeline das reuniões gravadas pela extensão) e salva.
// Respeita e debita a cota do plano, igual ao /api/transcrever.
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import { autenticarReq } from '../../../lib/auth';
import { aplicarCors } from '../../../lib/cors';
import supabase from '../../../lib/supabase';
import { transcreverAudio } from '../../../lib/groq';
import { gerarResumoDeTranscricao } from '../../../lib/resumoIA';

export const config = { api: { bodyParser: false } };

const TAMANHO_MAX_MB = 100;

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  const { data: cota, error: erroCota } = await supabase
    .rpc('verificar_cota', { p_user_id: usuario.id })
    .single();

  if (erroCota || !cota) {
    return res.status(403).json({ erro: 'Não foi possível verificar seu plano. Contate o suporte.' });
  }
  if (!cota.pode_gravar) {
    return res.status(403).json({ erro: 'Cota mensal esgotada. Faça upgrade do seu plano.' });
  }

  const form = formidable({
    maxFileSize: TAMANHO_MAX_MB * 1024 * 1024,
    maxFiles: 1,
    filter: ({ mimetype }) =>
      !mimetype || mimetype.startsWith('audio/') || mimetype.startsWith('video/'),
  });

  let arquivoTemp;

  try {
    const [, files] = await form.parse(req);
    const audio = files.audio?.[0];

    if (!audio) {
      return res.status(400).json({ erro: 'Nenhum arquivo de áudio enviado.' });
    }

    arquivoTemp = audio.filepath;
    const nomeOriginal = audio.originalFilename || 'audio';

    // 1) Transcreve
    const { texto, duracao } = await transcreverAudio(arquivoTemp, nomeOriginal);
    if (!texto.trim()) {
      return res.status(422).json({ erro: 'Não foi possível extrair texto do áudio enviado.' });
    }

    // 2) Debita a cota pela duração real devolvida pelo Whisper
    const segundos = Math.max(1, Math.round(duracao || 0));
    const { error: erroIncremento } = await supabase.rpc('incrementar_uso', {
      p_user_id: usuario.id,
      p_segundos: segundos,
    });
    if (erroIncremento) console.error('Falha ao incrementar uso (upload):', erroIncremento.message);

    // 3) Relatório (resumo + insights + metadados) — mesmo formato da extensão
    const relatorio = await gerarResumoDeTranscricao(texto);

    const totalPalavras = texto.trim().split(/\s+/).length;
    const nome = (path.parse(nomeOriginal).name || 'Transcrição de áudio').slice(0, 200);
    const metadados = relatorio.ok ? relatorio.metadados : {};

    const { data, error } = await supabase
      .from('transcricoes')
      .insert({
        usuario_id: usuario.id,
        nome,
        transcricao: texto,
        resumo: relatorio.ok ? relatorio.resumo : '',
        insights: relatorio.ok ? relatorio.insights : [],
        total_palavras: totalPalavras,
        duracao,
        temas: metadados.temas || [],
        cliente_mencionado: metadados.cliente_mencionado || null,
        participantes: metadados.participantes || [],
        sentimento: metadados.sentimento || null,
        tem_reclamacao: metadados.tem_reclamacao === true,
        tem_risco_cancelamento: metadados.tem_risco_cancelamento === true,
        intencao_compra: metadados.intencao_compra || null,
        nivel_urgencia: metadados.nivel_urgencia || null,
        tipo_reuniao: metadados.tipo_reuniao || null,
      })
      .select('id, nome, data, hora_inicio, hora_fim, duracao, total_falas, total_palavras, insights, criado_em')
      .single();

    if (error) {
      console.error('Erro ao salvar upload:', error);
      return res.status(500).json({ erro: 'Falha ao salvar a transcrição.' });
    }

    return res.status(200).json({ ok: true, data });
  } catch (err) {
    console.error('Erro no upload de áudio:', err);
    return res.status(500).json({ erro: 'Erro ao processar o áudio.' });
  } finally {
    if (arquivoTemp) fs.unlink(arquivoTemp, () => {});
  }
}
