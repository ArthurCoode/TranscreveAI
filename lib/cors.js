// lib/cors.js
// CORS restrito: só o site e a extensão do Chrome podem chamar a API a
// partir do navegador. Antes era "*" em todas as rotas.
//
// Para sobrescrever, defina ALLOWED_ORIGINS (separado por vírgula).
const ORIGENS_PADRAO = [
  'https://www.transcreveia.com',
  'https://transcreveia.com',
  'chrome-extension://pgcllgiibjbikdcgbjepilfhaimcehpc',
];

function origensPermitidas() {
  const env = process.env.ALLOWED_ORIGINS;
  const lista = env
    ? env.split(',').map((o) => o.trim()).filter(Boolean)
    : [...ORIGENS_PADRAO];
  if (process.env.NODE_ENV !== 'production') {
    lista.push('http://localhost:3000');
  }
  return lista;
}

// Uso:
//   if (aplicarCors(req, res, 'GET, POST')) return;
// Retorna true quando a requisição era um preflight (OPTIONS) e já foi respondida.
export function aplicarCors(req, res, metodos = 'GET, POST') {
  const origin = req.headers.origin;
  res.setHeader('Vary', 'Origin');

  if (origin && origensPermitidas().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', `${metodos}, OPTIONS`);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '600');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
