// pages/api/transcricoes.js
// GET  → lista todas as transcrições do usuario
// DELETE → deleta uma transcrição
import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import supabase from '../../lib/supabase';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, DELETE')) return;

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  // listar transcrições
  if (req.method === 'GET') {
    const pagina = parseInt(req.query.pagina) || 1;
    const limite = parseInt(req.query.limite) || 20;
    const offset = (pagina - 1) * limite;

    const { data, error, count } = await supabase
      .from('transcricoes')
      .select('id, nome, data, hora_inicio, hora_fim, duracao, total_falas, total_palavras, insights, criado_em', { count: 'exact' })
      .eq('usuario_id', usuario.id)
      .order('criado_em', { ascending: false })
      .range(offset, offset + limite - 1);

    if (error) return res.status(500).json({ erro: error.message });

    return res.status(200).json({
      ok:   true,
      data,
      total:  count,
      pagina,
      limite
    });
  }

  // deletar transcrição
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ erro: 'ID obrigatório.' });

    const { error } = await supabase
      .from('transcricoes')
      .delete()
      .eq('id', id)
      .eq('usuario_id', usuario.id); // garante que só deleta o proprio

    if (error) return res.status(500).json({ erro: error.message });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}