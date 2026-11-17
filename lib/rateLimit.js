// lib/rateLimit.js
// Rate limit em memória (janela fixa), por chave (IP ou usuário).
//
// LIMITAÇÃO: em serverless (Vercel) cada instância tem sua própria memória,
// então isto é uma barreira "best-effort" contra abuso casual e brute force
// simples. Para um limite global de verdade, troque a implementação por
// Upstash Redis (@upstash/ratelimit) mantendo a mesma assinatura.
const baldes = new Map();
const MAX_CHAVES = 10000;

export function ipDaReq(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket?.remoteAddress || 'desconhecido';
}

// Retorna true se a requisição pode seguir; caso contrário já responde 429.
export function limitar(req, res, { chave, limite, janelaMs }) {
  const agora = Date.now();
  const k = `${chave}`;
  let balde = baldes.get(k);

  if (!balde || balde.reiniciaEm <= agora) {
    if (baldes.size >= MAX_CHAVES) {
      for (const [chaveAntiga, b] of baldes) {
        if (b.reiniciaEm <= agora) baldes.delete(chaveAntiga);
      }
      if (baldes.size >= MAX_CHAVES) baldes.clear();
    }
    balde = { contagem: 0, reiniciaEm: agora + janelaMs };
    baldes.set(k, balde);
  }

  balde.contagem++;
  if (balde.contagem > limite) {
    const segundos = Math.ceil((balde.reiniciaEm - agora) / 1000);
    res.setHeader('Retry-After', String(segundos));
    res.status(429).json({ erro: 'Muitas requisições. Tente novamente em instantes.' });
    return false;
  }
  return true;
}
