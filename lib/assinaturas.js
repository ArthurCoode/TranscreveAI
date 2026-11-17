// lib/assinaturas.js
// Ativação de plano compartilhada entre /api/checkout (cartão aprovado na
// hora e plano gratuito) e /api/webhooks/mercadopago (Pix/Boleto).
import crypto from 'crypto';
import supabase from './supabase';
import { enviarEmailDeAcesso } from './email';

export function urlBase() {
  return (process.env.PUBLIC_BASE_URL || 'https://www.transcreveia.com').replace(/\/+$/, '');
}

export function normalizarEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function buscarUsuarioPorEmail(email) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id, plano_id')
    .ilike('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function gerarSenhaTemporaria() {
  // Senha aleatória interna (o Supabase exige uma). O usuário nunca a vê:
  // ele define a própria senha pelo link enviado por e-mail.
  return crypto.randomBytes(24).toString('base64url');
}

// Ativa o plano para o e-mail informado. Se a conta não existir, cria e
// envia o link de definição de senha. IMPORTANTE: quem chama é responsável
// por garantir que, se a conta já existe, a requisição veio do próprio dono.
export async function ativarPlano({ email, plano, ciclo, quantidadeUsuarios, mpPaymentId }) {
  const usuarioExistente = await buscarUsuarioPorEmail(email);

  let userId;
  let linkAcesso = null;
  const contaNova = !usuarioExistente;

  if (usuarioExistente) {
    userId = usuarioExistente.id;
    const { error } = await supabase
      .from('usuarios')
      .update({ plano: plano.nome, plano_id: plano.id })
      .eq('id', userId);
    if (error) throw error;
  } else {
    const { data: novoUsuario, error: authError } = await supabase.auth.admin.createUser({
      email,
      password: gerarSenhaTemporaria(),
      email_confirm: true,
    });
    if (authError) throw authError;
    userId = novoUsuario.user.id;

    const { error: upsertError } = await supabase
      .from('usuarios')
      .upsert(
        { id: userId, email, nome: email.split('@')[0], plano: plano.nome, plano_id: plano.id },
        { onConflict: 'id' }
      );
    if (upsertError) throw upsertError;

    try {
      const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email,
        options: { redirectTo: `${urlBase()}/resetpassword.html` },
      });
      if (linkError) throw linkError;
      linkAcesso = linkData.properties?.action_link || null;
    } catch (linkErr) {
      console.warn('Não foi possível gerar magic link:', linkErr.message);
    }
  }

  // expira assinaturas anteriores para não acumular várias "ativa"
  await supabase
    .from('assinaturas')
    .update({ status: 'expirada' })
    .eq('user_id', userId)
    .in('status', ['ativa', 'cancelamento_agendado']);

  const { error: assinaturaError } = await supabase.from('assinaturas').insert({
    user_id: userId,
    plano_id: plano.id,
    ciclo,
    quantidade_usuarios: quantidadeUsuarios || 1,
    status: 'ativa',
    mp_payment_id: mpPaymentId,
  });
  if (assinaturaError) throw assinaturaError;

  if (contaNova && linkAcesso) {
    await enviarEmailDeAcesso({ email, linkAcesso, novoUsuario: true });
  }

  return { userId, contaNova };
}
