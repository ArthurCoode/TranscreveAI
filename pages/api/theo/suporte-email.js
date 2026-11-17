// pages/api/theo/suporte-email.js
//
// Encaminha a conversa do Theo flutuante (suporte) por e-mail para o
// endereço fixo de suporte, via Resend (mesmo client de lib/email.js).
//
// O e-mail é enviado com reply-to = e-mail do usuário logado, então
// basta responder o e-mail recebido para falar direto com quem pediu
// ajuda — sem precisar copiar o endereço manualmente.
//
// Auth: mesmo padrão de agente.js — usuario.id NUNCA vem do body,
// sempre da sessão autenticada (autenticarReq).

import { aplicarCors } from '../../../lib/cors';
import { autenticarReq } from '../../../lib/auth';
import supabase from '../../../lib/supabase';
import { enviarEmailSuporte } from '../../../lib/email';
import { limitar } from '../../../lib/rateLimit';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;
  if (!limitar(req, res, { chave: `suporte-email:${usuario.id}`, limite: 5, janelaMs: 60 * 60 * 1000 })) return;

  const { historico } = req.body || {};

  const mensagensValidas = Array.isArray(historico)
    ? historico
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .slice(-10)
        .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
    : [];

  if (mensagensValidas.length === 0) {
    return res.status(400).json({ erro: 'Nenhuma mensagem para enviar.' });
  }

  // Nome e e-mail vêm do banco (tabela "usuarios" — antes consultava
  // "usuario", que não existe, e o nome nunca era encontrado).
  let nomeUsuario = 'Usuário';
  let emailUsuario = null;
  try {
    const { data: usuarioRow } = await supabase
      .from('usuarios')
      .select('nome, email')
      .eq('id', usuario.id)
      .maybeSingle();
    if (usuarioRow?.nome) nomeUsuario = usuarioRow.nome;
    if (usuarioRow?.email) emailUsuario = usuarioRow.email;
  } catch (erroUsuario) {
    // não bloqueia o envio do e-mail por causa disso
    console.warn('Não foi possível buscar dados do usuário para o e-mail de suporte:', erroUsuario?.message);
  }

  try {
    await enviarEmailSuporte({
      usuarioNome: nomeUsuario,
      usuarioEmail: emailUsuario,
      historico: mensagensValidas,
    });

    return res.status(200).json({ ok: true });
  } catch (erro) {
    console.error('Erro ao enviar e-mail de suporte:', erro);
    return res.status(500).json({ erro: 'Não foi possível enviar o e-mail agora. Tente novamente.' });
  }
}