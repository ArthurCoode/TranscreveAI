import supabase from '../../lib/supabase';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Método não permitido' });
  }

  // impede qualquer cache (navegador, CDN da Vercel, etc.) — sem isso, respostas
  // GET idênticas voltam como 304 e o polling nunca vê o status mudar de verdade.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { paymentId } = req.query;
  if (!paymentId) {
    return res.status(400).json({ error: 'paymentId é obrigatório' });
  }

  // só expõe o campo status — nada de e-mail, senha temporária ou outros dados
  // sensíveis desse registro, já que esse endpoint não exige autenticação
  // (é consultado antes da pessoa ter uma sessão logada).
  const { data, error } = await supabase
    .from('checkouts_pendentes')
    .select('status')
    .eq('mp_payment_id', String(paymentId))
    .maybeSingle();

  if (error) {
    console.error('Erro ao consultar status do checkout:', error);
    return res.status(500).json({ error: 'Erro ao consultar status' });
  }

  if (!data) {
    return res.status(404).json({ error: 'Pagamento não encontrado' });
  }

  return res.status(200).json({ status: data.status });
}