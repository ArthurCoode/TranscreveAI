// pages/api/audio/[id].js
// Gera uma URL assinada (válida por 1h) para baixar o áudio de uma
// transcrição do próprio usuário. O bucket nunca é público.
import supabase from '../../../lib/supabase';
import { autenticarReq } from '../../../lib/auth';
import { aplicarCors } from '../../../lib/cors';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET')) return;
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, erro: 'Método não permitido' });
  }

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  try {
    const { id } = req.query;
    if (!id) return res.status(400).json({ ok: false, erro: 'id obrigatório' });

    const { data: transcricao, error: erroBusca } = await supabase
      .from('transcricoes')
      .select('id, audio_path')
      .eq('id', id)
      .eq('usuario_id', usuario.id)
      .maybeSingle();

    if (erroBusca || !transcricao) {
      return res.status(404).json({ ok: false, erro: 'Transcrição não encontrada' });
    }
    if (!transcricao.audio_path) {
      return res.status(404).json({ ok: false, erro: 'Esta reunião não tem áudio salvo' });
    }

    const { data: assinada, error: erroAssinar } = await supabase.storage
      .from('audios')
      .createSignedUrl(transcricao.audio_path, 3600);

    if (erroAssinar) {
      console.error('ERRO SIGNED URL:', erroAssinar);
      return res.status(500).json({ ok: false, erro: 'Falha ao gerar link do áudio.' });
    }

    return res.status(200).json({ ok: true, url: assinada.signedUrl });
  } catch (err) {
    console.error('ERRO FATAL /api/audio/[id]:', err);
    return res.status(500).json({ ok: false, erro: 'Falha ao gerar link do áudio.' });
  }
}
