// pages/api/audio.js
// Recebe o áudio COMPLETO da reunião (enviado pela extensão depois do
// "Parar") e sobe pro Supabase Storage (bucket "audios", privado). Salva
// só o caminho em transcricoes.audio_path; o download é feito por URL
// assinada em GET /api/audio/[id].
//
// ATENÇÃO (Vercel): funções serverless aceitam no máximo ~4,5 MB por
// requisição. Reuniões longas precisam migrar para upload direto ao
// Storage com signed upload URL (ver README → Próximos passos).
import formidable from 'formidable';
import fs from 'fs';
import supabase from '../../lib/supabase';
import { autenticarReq } from '../../lib/auth';
import { aplicarCors } from '../../lib/cors';

export const config = { api: { bodyParser: false } };

const EXTENSOES_PERMITIDAS = ['webm', 'ogg', 'mp3', 'm4a', 'wav', 'mp4'];
// id da transcrição entra no caminho do arquivo — só caracteres seguros
const UUID_RE = /^[A-Za-z0-9-]{1,64}$/;

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido' });
  }

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  let arquivo;
  try {
    const form = formidable({
      maxFileSize: 300 * 1024 * 1024,
      maxFiles: 1,
      filter: ({ mimetype }) => !mimetype || mimetype.startsWith('audio/') || mimetype.startsWith('video/'),
    });
    const [fields, files] = await form.parse(req);

    const transcricaoId = Array.isArray(fields.transcricaoId) ? fields.transcricaoId[0] : fields.transcricaoId;
    arquivo = Array.isArray(files.audio) ? files.audio[0] : files.audio;

    if (!transcricaoId || !UUID_RE.test(transcricaoId)) {
      return res.status(400).json({ ok: false, erro: 'transcricaoId inválido' });
    }
    if (!arquivo) {
      return res.status(400).json({ ok: false, erro: 'Arquivo de áudio obrigatório' });
    }

    // confirma que a transcrição pertence a este usuário antes de gravar
    const { data: transcricaoExistente, error: erroBusca } = await supabase
      .from('transcricoes')
      .select('id')
      .eq('id', transcricaoId)
      .eq('usuario_id', usuario.id)
      .maybeSingle();

    if (erroBusca || !transcricaoExistente) {
      return res.status(404).json({ ok: false, erro: 'Transcrição não encontrada para este usuário' });
    }

    let extensao = (arquivo.originalFilename || '').split('.').pop()?.toLowerCase();
    if (!EXTENSOES_PERMITIDAS.includes(extensao)) extensao = 'webm';
    const caminho = `${usuario.id}/${transcricaoId}.${extensao}`;

    const buffer = await fs.promises.readFile(arquivo.filepath);
    const { error: erroUpload } = await supabase.storage
      .from('audios')
      .upload(caminho, buffer, {
        contentType: arquivo.mimetype || 'audio/webm',
        upsert: true,
      });

    if (erroUpload) {
      console.error('ERRO UPLOAD AUDIO:', erroUpload);
      return res.status(500).json({ ok: false, erro: 'Falha ao salvar o áudio.' });
    }

    const { error: erroUpdate } = await supabase
      .from('transcricoes')
      .update({ audio_path: caminho })
      .eq('id', transcricaoId)
      .eq('usuario_id', usuario.id);

    if (erroUpdate) {
      console.error('ERRO UPDATE audio_path:', erroUpdate);
      return res.status(500).json({ ok: false, erro: 'Falha ao salvar o áudio.' });
    }

    return res.status(200).json({ ok: true, path: caminho });
  } catch (err) {
    console.error('ERRO FATAL /api/audio:', err);
    return res.status(500).json({ ok: false, erro: 'Falha ao processar o áudio.' });
  } finally {
    if (arquivo?.filepath) fs.unlink(arquivo.filepath, () => {});
  }
}
