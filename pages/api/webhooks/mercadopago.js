import crypto from 'crypto';
import { MercadoPagoConfig, Payment } from 'mercadopago';
import supabase from '../../../lib/supabase';
import { compararSeguro } from '../../../lib/auth';
import { buscarPlano, calcularCobranca } from '../../../lib/planos';
import { ativarPlano } from '../../../lib/assinaturas';

// MP manda notificações v1 com corpo vazio/mínimo — type e data.id vêm na
// query string. Desligamos o bodyParser e lemos o corpo manualmente.
export const config = { api: { bodyParser: false } };

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(mpClient);

const MAX_BODY_BYTES = 64 * 1024;

function lerBuffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error('Corpo grande demais'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function validarAssinatura(req, dataId) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  const signature = req.headers['x-signature'];
  const requestId = req.headers['x-request-id'];

  if (!secret || !signature || !requestId || !dataId) return false;

  const partes = String(signature).split(',').reduce((acc, parte) => {
    const [chave, valor] = parte.split('=');
    if (chave) acc[chave.trim()] = valor?.trim();
    return acc;
  }, {});

  const { ts, v1 } = partes;
  if (!ts || !v1) return false;

  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const hashCalculado = crypto.createHmac('sha256', secret).update(manifest).digest('hex');

  return compararSeguro(hashCalculado, v1);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let body = {};
  try {
    const rawBuffer = await lerBuffer(req);
    if (rawBuffer.length) body = JSON.parse(rawBuffer.toString('utf-8'));
  } catch {
    // corpo vazio ou não-JSON é normal nas notificações v1
  }

  const tipo = req.query.type || body.type;
  const dataId = req.query['data.id'] || body.data?.id;

  if (!validarAssinatura(req, dataId)) {
    console.warn('Webhook com assinatura inválida');
    return res.status(401).send('assinatura inválida');
  }

  try {
    if (tipo !== 'payment' || !dataId) return res.status(200).send('ignorado');

    const resultado = await payment.get({ id: dataId });
    if (resultado.status !== 'approved') return res.status(200).send('ainda não aprovado');

    // Claim atômico: só uma notificação duplicada consegue a linha.
    const { data: pendente, error: claimError } = await supabase
      .from('checkouts_pendentes')
      .update({ status: 'processando' })
      .eq('mp_payment_id', String(dataId))
      .eq('status', 'pendente')
      .select()
      .maybeSingle();

    if (claimError) throw claimError;
    if (!pendente) return res.status(200).send('checkout pendente não encontrado ou já processado');

    // Confere se o valor pago corresponde ao preço do plano.
    let plano = null;
    let valorEsperado = null;
    try {
      plano = await buscarPlano(pendente.plano_id);
      ({ valor: valorEsperado } = calcularCobranca(plano, pendente.ciclo, pendente.quantidade_usuarios));
    } catch {
      valorEsperado = null;
    }

    const valorPago = Number(resultado.transaction_amount);
    if (valorEsperado === null || resultado.currency_id !== 'BRL' || valorPago + 0.009 < valorEsperado) {
      console.error('Pagamento com valor divergente — revisão manual necessária', {
        mp_payment_id: String(dataId), valorEsperado, valorPago, moeda: resultado.currency_id,
      });
      await supabase.from('checkouts_pendentes').update({ status: 'revisao_manual' }).eq('id', pendente.id);
      return res.status(200).send('pagamento enviado para revisão');
    }

    try {
      const { contaNova } = await ativarPlano({
        email: pendente.email,
        plano,
        ciclo: pendente.ciclo,
        quantidadeUsuarios: pendente.quantidade_usuarios,
        mpPaymentId: String(dataId),
      });

      await supabase.from('checkouts_pendentes').update({ status: 'concluido' }).eq('id', pendente.id);

      console.log(contaNova ? 'Conta nova criada e plano ativado' : 'Plano atualizado (upgrade)', { checkout: pendente.id });
      return res.status(200).send('plano ativado com sucesso');
    } catch (ativarErr) {
      await supabase.from('checkouts_pendentes').update({ status: 'pendente' }).eq('id', pendente.id);
      throw ativarErr;
    }
  } catch (err) {
    console.error('Erro no webhook Mercado Pago:', err);
    // 500 faz o Mercado Pago reenviar a notificação mais tarde
    return res.status(500).send('erro ao processar');
  }
}
