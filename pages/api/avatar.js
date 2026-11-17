// pages/api/avatar.js
// POST multipart (campo "avatar") → envia a foto de perfil para o bucket
// "avatars" usando a service role, em uma pasta do próprio usuário.
// Antes o navegador enviava direto ao Storage com a anon key, o que exigia
// o bucket aceitar upload anônimo (qualquer pessoa podia hospedar arquivos).
import formidable from 'formidable';
import fs from 'fs';
import crypto from 'crypto';
import supabase from '../../lib/supabase';
import { autenticarReq } from '../../lib/auth';
import { limitar } from '../../lib/rateLimit';

export const config = { api: { bodyParser: false } };

const TIPOS = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const MAX_BYTES = 2 * 1024 * 1024;

// confere a assinatura real do arquivo (não confia só no mimetype enviado)
function tipoPelosBytes(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;
  if (!limitar(req, res, { chave: `avatar:${usuario.id}`, limite: 10, janelaMs: 60 * 60 * 1000 })) return;

  let arquivo;
  try {
    const form = formidable({ maxFileSize: MAX_BYTES, maxFiles: 1 });
    const [, files] = await form.parse(req);
    arquivo = Array.isArray(files.avatar) ? files.avatar[0] : files.avatar;
    if (!arquivo) return res.status(400).json({ erro: 'Envie uma imagem.' });

    const buffer = await fs.promises.readFile(arquivo.filepath);
    const mime = tipoPelosBytes(buffer);
    if (!mime) return res.status(400).json({ erro: 'Formato não suportado. Use PNG, JPG, WEBP ou GIF.' });

    const caminho = `${usuario.id}/${crypto.randomUUID()}.${TIPOS[mime]}`;
    const { error } = await supabase.storage
      .from('avatars')
      .upload(caminho, buffer, { contentType: mime, cacheControl: '3600', upsert: false });
    if (error) throw error;

    const { data } = supabase.storage.from('avatars').getPublicUrl(caminho);
    return res.status(200).json({ ok: true, url: data.publicUrl });
  } catch (err) {
    if (err?.code === 1009 || /maxFileSize/i.test(err?.message || '')) {
      return res.status(413).json({ erro: 'Imagem muito grande (máx. 2 MB).' });
    }
    console.error('Erro no upload de avatar:', err);
    return res.status(500).json({ erro: 'Não foi possível enviar a imagem.' });
  } finally {
    if (arquivo?.filepath) fs.unlink(arquivo.filepath, () => {});
  }
}
