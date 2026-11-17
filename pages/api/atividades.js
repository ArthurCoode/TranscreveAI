// pages/api/atividades.js
// GET    → lista atividades do time do usuário
// POST   → cria uma nova atividade
// PATCH  → move atividade entre status (?id=...)
// DELETE → remove uma atividade (?id=...)
import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import supabase from '../../lib/supabase';

const STATUS_VALIDOS = ['pendente', 'em_andamento', 'concluido'];

async function ehMembroDoTime(usuarioId, teamId) {
  const { data } = await supabase
    .from('usuarios')
    .select('id')
    .eq('id', usuarioId)
    .eq('team_id', teamId)
    .maybeSingle();
  return !!data;
}

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'GET, POST, PATCH, DELETE')) return;

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  // busca o team_id atualizado direto do banco (não confia só no payload do JWT)
  const { data: usuarioRow, error: erroUsuario } = await supabase
    .from('usuarios')
    .select('team_id')
    .eq('id', usuario.id)
    .single();

  if (erroUsuario || !usuarioRow?.team_id) {
    return res.status(403).json({ erro: 'Usuário sem time associado.' });
  }

  const teamId = usuarioRow.team_id;

  // ---------- LISTAR ----------
  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('atividades')
      .select('*')
      .eq('team_id', teamId)
      .order('criado_em', { ascending: false });

    if (error) return res.status(500).json({ erro: error.message });

    return res.status(200).json({ ok: true, data });
  }

  // ---------- CRIAR ----------
  if (req.method === 'POST') {
    const { titulo, descricao, prazo, reuniao_id, transcricao_id, origem, responsavel_id } = req.body || {};

    if (!titulo || !titulo.trim()) {
      return res.status(400).json({ erro: 'Título é obrigatório.' });
    }

    if (responsavel_id && !(await ehMembroDoTime(responsavel_id, teamId))) {
      return res.status(400).json({ erro: 'Responsável precisa ser membro do time.' });
    }

    const { data, error } = await supabase
      .from('atividades')
      .insert({
        team_id: teamId,
        titulo: titulo.trim(),
        descricao: descricao || null,
        prazo: prazo || null,
        reuniao_id: reuniao_id || null,
        transcricao_id: transcricao_id || null,
        origem: origem === 'auto' ? 'auto' : 'manual',
        responsavel_id: responsavel_id || usuario.id,
        criado_por: usuario.id,
      })
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });

    return res.status(201).json({ ok: true, data });
  }

  // ---------- ATUALIZAR (status e/ou dados) ----------
  if (req.method === 'PATCH') {
    const { id } = req.query;
    const { status, titulo, descricao, prazo, responsavel_id, lembrete_enviado, notificado } = req.body || {};

    if (!id) return res.status(400).json({ erro: 'ID obrigatório.' });

    const camposParaAtualizar = {};

    if (status !== undefined) {
      if (!STATUS_VALIDOS.includes(status)) {
        return res.status(400).json({ erro: 'Status inválido.' });
      }
      camposParaAtualizar.status = status;
    }

    if (titulo !== undefined) {
      if (!titulo || !titulo.trim()) {
        return res.status(400).json({ erro: 'Título não pode ficar vazio.' });
      }
      camposParaAtualizar.titulo = titulo.trim();
    }

    if (descricao !== undefined) camposParaAtualizar.descricao = descricao || null;
    if (prazo !== undefined) camposParaAtualizar.prazo = prazo || null;
    if (responsavel_id !== undefined) {
      if (responsavel_id && !(await ehMembroDoTime(responsavel_id, teamId))) {
        return res.status(400).json({ erro: 'Responsável precisa ser membro do time.' });
      }
      camposParaAtualizar.responsavel_id = responsavel_id || null;
    }
    if (lembrete_enviado !== undefined) camposParaAtualizar.lembrete_enviado = !!lembrete_enviado;
    if (notificado !== undefined) camposParaAtualizar.notificado = !!notificado;

    if (Object.keys(camposParaAtualizar).length === 0) {
      return res.status(400).json({ erro: 'Nenhum campo para atualizar.' });
    }

    const { data, error } = await supabase
      .from('atividades')
      .update(camposParaAtualizar)
      .eq('id', id)
      .eq('team_id', teamId) // garante que só mexe em atividade do próprio time
      .select()
      .single();

    if (error) return res.status(500).json({ erro: error.message });
    if (!data) return res.status(404).json({ erro: 'Atividade não encontrada.' });

    return res.status(200).json({ ok: true, data });
  }

  // ---------- EXCLUIR ----------
  if (req.method === 'DELETE') {
    const { id } = req.query;
    if (!id) return res.status(400).json({ erro: 'ID obrigatório.' });

    const { error } = await supabase
      .from('atividades')
      .delete()
      .eq('id', id)
      .eq('team_id', teamId);

    if (error) return res.status(500).json({ erro: error.message });

    return res.status(200).json({ ok: true });
  }

  return res.status(405).json({ erro: 'Método não permitido.' });
}