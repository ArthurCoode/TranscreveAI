// lib/auth.js
// Autenticação única do projeto: JWT próprio assinado com JWT_SECRET.
// Toda rota autenticada deve usar autenticarReq() — nunca decodificar o
// token "na mão" (decodificar sem verificar a assinatura permite forjar
// qualquer usuário).
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

let avisoSegredoCurto = false;

function obterSegredo() {
  const secret = process.env.JWT_SECRET;
  // Sem fallback: se a variável sumir, falha fechado em vez de aceitar
  // tokens assinados com um segredo conhecido.
  if (!secret) {
    throw new Error('JWT_SECRET não configurado.');
  }
  if (secret.length < 32 && !avisoSegredoCurto) {
    avisoSegredoCurto = true;
    console.warn('JWT_SECRET tem menos de 32 caracteres — gere um maior (ex: openssl rand -base64 48).');
  }
  return secret;
}

export function gerarToken(payload) {
  return jwt.sign(payload, obterSegredo(), { expiresIn: '7d', algorithm: 'HS256' });
}

export function verificarToken(token) {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, obterSegredo(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

export function pegarTokenDaReq(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = req.headers['cookie'] || '';
  const match = cookie.match(/(?:^|;\s*)tr_token=([^;]+)/);
  return match ? match[1] : null;
}

export async function autenticarReq(req, res) {
  const token = pegarTokenDaReq(req);
  if (!token) { res.status(401).json({ erro: 'Não autenticado.' }); return null; }
  const payload = verificarToken(token);
  if (!payload?.id) { res.status(401).json({ erro: 'Token inválido.' }); return null; }
  return payload;
}

// Versão silenciosa (sem escrever resposta), para fluxos que fazem redirect
// ou em que o login é opcional (ex: checkout de quem já tem conta).
export function pegarUsuarioOpcional(req) {
  const token = pegarTokenDaReq(req);
  if (!token) return null;
  const payload = verificarToken(token);
  return payload?.id ? payload : null;
}

export function pegarUserIdDaReq(req) {
  return pegarUsuarioOpcional(req)?.id || null;
}

// "state" assinado e com validade curta para fluxos OAuth — impede que
// alguém monte um state com o userId de outra pessoa (CSRF / vinculação
// de conta indevida).
export function assinarState(dados) {
  return jwt.sign({ ...dados, nonce: crypto.randomBytes(8).toString('hex') }, obterSegredo(), {
    expiresIn: '10m',
    algorithm: 'HS256',
  });
}

export function verificarState(state) {
  return verificarToken(state);
}

// Só aceita caminhos relativos do próprio site ("/dashboard.html"),
// nunca URLs absolutas ou "//evil.com" (open redirect).
export function caminhoRedirectSeguro(valor, padrao = '/dashboard.html') {
  if (typeof valor !== 'string') return padrao;
  if (!/^\/[A-Za-z0-9\-._~/?=&#%]*$/.test(valor)) return padrao;
  if (valor.startsWith('//')) return padrao;
  return valor;
}

export function compararSeguro(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
