// pages/api/transcricoes/[id].js
// GET → retorna uma transcrição completa com o texto e resumo
//   - dono da transcrição sempre pode ver a própria
//   - admin do time também pode ver transcrições de qualquer
//     membro do MESMO team_id (usado pelo painel de Supervisão)
// PATCH → atualiza campos editáveis (por enquanto: nome/título)
//   - permanece restrito ao dono, por enquanto
import { aplicarCors } from '../../../lib/cors';
import { autenticarReq } from '../../../lib/auth';
import supabase from '../../../lib/supabase';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, PATCH')) return;

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  const { id } = req.query;

  if (req.method === 'GET') {
    // Busca a transcrição sem filtrar por dono ainda —
    // a checagem de permissão é feita depois, manualmente,
    // pra poder liberar o caso do admin.
    const { data, error } = await supabase
      .from('transcricoes')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      return res.status(404).json({ erro: 'Transcrição não encontrada.' });
    }

    const ehDono = data.usuario_id === usuario.id;

    if (!ehDono) {
      // Não é o dono — só libera se for admin E a transcrição
      // pertencer a alguém do mesmo time.
      const { data: me, error: meError } = await supabase
        .from('usuarios')
        .select('role, team_id')
        .eq('id', usuario.id)
        .maybeSingle();

      if (meError) throw meError;

      const ehAdmin = (me?.role || '').toLowerCase() === 'admin';

      if (!ehAdmin || !me?.team_id) {
        return res.status(404).json({ erro: 'Transcrição não encontrada.' });
      }

      const { data: dono, error: donoError } = await supabase
        .from('usuarios')
        .select('team_id')
        .eq('id', data.usuario_id)
        .maybeSingle();

      if (donoError) throw donoError;

      const mesmoTime = dono?.team_id === me.team_id;

      if (!mesmoTime) {
        return res.status(404).json({ erro: 'Transcrição não encontrada.' });
      }
    }

    return res.status(200).json({ ok: true, data });
  }

  if (req.method === 'PATCH') {
    const { nome } = req.body || {};

    const nomeLimpo = typeof nome === 'string' ? nome.trim() : '';

    if (!nomeLimpo) {
      return res.status(400).json({ erro: 'Título não pode ser vazio.' });
    }

    if (nomeLimpo.length > 200) {
      return res.status(400).json({ erro: 'Título muito longo (máx. 200 caracteres).' });
    }

    // PATCH continua restrito ao dono — edição de título de
    // reunião alheia não está liberada pra admin por padrão.
    const { data, error } = await supabase
      .from('transcricoes')
      .update({ nome: nomeLimpo })
      .eq('id', id)
      .eq('usuario_id', usuario.id)
      .select()
      .single();

    if (error || !data) return res.status(404).json({ erro: 'Transcrição não encontrada.' });

    return res.status(200).json({ ok: true, data });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}