// pages/api/login.js
import { limitar, ipDaReq } from '../../lib/rateLimit';
import { verificarCredenciais } from '../../lib/supabaseAuth';
import { aplicarCors } from '../../lib/cors';
import supabase from '../../lib/supabase';
import { gerarToken } from '../../lib/auth';
import { serialize } from 'cookie';

export default async function handler(req, res) {
  // suporte a CORS para a extensao do Chrome
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Método não permitido.' });

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const senha = typeof req.body?.senha === 'string' ? req.body.senha : '';
  if (!email || !senha) return res.status(400).json({ erro: 'Email e senha obrigatórios.' });

  // limita tentativas por IP e por conta (brute force)
  if (!limitar(req, res, { chave: `login-ip:${ipDaReq(req)}`, limite: 20, janelaMs: 15 * 60 * 1000 })) return;
  if (!limitar(req, res, { chave: `login-email:${email}`, limite: 10, janelaMs: 15 * 60 * 1000 })) return;

  // autentica no supabase
  const usuarioAuth = await verificarCredenciais(email, senha);
  const data = { user: usuarioAuth };

  if (!usuarioAuth) {
    return res.status(401).json({ erro: 'Email ou senha incorretos.' });
  }

  // busca o perfil do usuario
  const { data: perfil, error: perfilError } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', data.user.id)
    .single();


  // gera o token JWT proprio do site — agora incluindo plano_id e role
  const token = gerarToken({
    id:       data.user.id,
    email:    data.user.email,
    plano:    perfil?.plano || 'gratuito',
    plano_id: perfil?.plano_id || null,
    role:     (perfil?.role || 'viewer').trim().toLowerCase()
  });

  // seta o cookie httpOnly pra que o middleware consiga ler em navegacoes de pagina
  res.setHeader('Set-Cookie', serialize('tr_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7 // 7 dias, igual ao expiresIn do token
  }));

  return res.status(200).json({
    ok:       true,
    token,
    nome:     perfil?.nome || data.user.email,
    email:    data.user.email,
    plano:    perfil?.plano || 'gratuito',
    plano_id: perfil?.plano_id || null
  });
}