// pages/api/checkout.js
// Regras de segurança:
// - O valor cobrado é SEMPRE calculado no servidor (lib/planos.js). O campo
//   "valor" do navegador só serve para detectar preço desatualizado na tela.
// - Se o e-mail já tem conta, só o próprio dono (logado) pode alterar o plano.
import { MercadoPagoConfig, Payment } from 'mercadopago';
import supabase from '../../lib/supabase';
import { pegarUsuarioOpcional } from '../../lib/auth';
import { limitar, ipDaReq } from '../../lib/rateLimit';
import { buscarPlano, calcularCobranca } from '../../lib/planos';
import {
  ativarPlano, buscarUsuarioPorEmail, normalizarEmail, EMAIL_RE, urlBase,
} from '../../lib/assinaturas';

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(mpClient);

const METODOS_PAGOS = ['card', 'pix', 'bolbradesco'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método não permitido' });
  }
  if (!limitar(req, res, { chave: `checkout:${ipDaReq(req)}`, limite: 10, janelaMs: 60000 })) return;

  const {
    token, method, paymentMethodId, issuerId, installments,
    documento, firstName, lastName, endereco,
    planoId, ciclo, quantidadeUsuarios, valor: valorExibido,
  } = req.body || {};
  const email = normalizarEmail(req.body?.email);

  if (!EMAIL_RE.test(email) || !planoId || !ciclo) {
    return res.status(400).json({ error: 'Dados incompletos' });
  }

  try {
    const plano = await buscarPlano(planoId);
    const { valor, quantidade, gratuito } = calcularCobranca(plano, ciclo, quantidadeUsuarios);

    if (valorExibido !== undefined && valorExibido !== null &&
        Math.abs(Number(valorExibido) - valor) > 0.009) {
      return res.status(409).json({ error: 'O preço do plano mudou. Recarregue a página e tente novamente.' });
    }

    // Conta existente: exige que a requisição venha do próprio dono.
    const usuarioExistente = await buscarUsuarioPorEmail(email);
    if (usuarioExistente) {
      const logado = pegarUsuarioOpcional(req);
      if (!logado || logado.id !== usuarioExistente.id) {
        return res.status(409).json({
          error: 'Já existe uma conta com este e-mail. Entre na sua conta para alterar o plano.',
          redirect: '/login.html',
        });
      }
    }

    // --- PLANO GRATUITO: sem Mercado Pago ---
    if (gratuito) {
      if (usuarioExistente && usuarioExistente.plano_id === plano.id) {
        return res.status(200).json({
          status: 'ja_ativo',
          redirect: '/login.html',
          mensagem: 'Você já está nesse plano — nada mudou.',
        });
      }
      await ativarPlano({ email, plano, ciclo, quantidadeUsuarios: quantidade, mpPaymentId: null });
      return res.status(200).json({
        status: 'aprovado',
        redirect: '/login.html',
        mensagem: usuarioExistente
          ? 'Plano atualizado!'
          : 'Conta criada! Verifique seu e-mail para definir sua senha.',
      });
    }

    // --- PLANOS PAGOS ---
    if (!METODOS_PAGOS.includes(method)) {
      return res.status(400).json({ error: 'Forma de pagamento inválida' });
    }
    if (!firstName || !lastName) {
      return res.status(400).json({ error: 'Nome completo é obrigatório' });
    }
    const doc = String(documento || '').replace(/\D/g, '');
    if (doc.length !== 11 && doc.length !== 14) {
      return res.status(400).json({ error: 'CPF/CNPJ é obrigatório' });
    }

    const paymentPayload = {
      transaction_amount: valor,
      description: `Assinatura TranscreveAI - ${plano.nome}`,
      payment_method_id: method === 'card' ? paymentMethodId : method,
      notification_url: `${urlBase()}/api/webhooks/mercadopago`,
      metadata: { plano_id: plano.id, ciclo, quantidade_usuarios: quantidade },
      payer: {
        email,
        first_name: String(firstName).slice(0, 100),
        last_name: String(lastName).slice(0, 100),
        identification: { type: doc.length === 14 ? 'CNPJ' : 'CPF', number: doc },
      },
    };

    if (method === 'card') {
      if (!token || !paymentMethodId) return res.status(400).json({ error: 'Dados do cartão ausentes' });
      paymentPayload.token = token;
      const parcelas = Number.parseInt(installments, 10);
      paymentPayload.installments = Number.isInteger(parcelas) && parcelas >= 1 && parcelas <= 12 ? parcelas : 1;
      if (issuerId) paymentPayload.issuer_id = issuerId;
    }

    if (method === 'bolbradesco') {
      if (!endereco || !endereco.cep || !endereco.rua || !endereco.numero || !endereco.bairro || !endereco.cidade || !endereco.uf) {
        return res.status(400).json({ error: 'Endereço completo é obrigatório para boleto' });
      }
      paymentPayload.payer.address = {
        zip_code: endereco.cep,
        street_name: endereco.rua,
        street_number: endereco.numero,
        neighborhood: endereco.bairro,
        city: endereco.cidade,
        federal_unit: endereco.uf,
      };
    }

    const resultado = await payment.create({ body: paymentPayload });

    if (resultado.status === 'approved') {
      if (Math.abs(Number(resultado.transaction_amount) - valor) > 0.009) {
        console.error('Valor aprovado diverge do esperado', { id: resultado.id, valor, recebido: resultado.transaction_amount });
        return res.status(500).json({ error: 'Pagamento em análise. Entre em contato com o suporte.' });
      }
      await ativarPlano({ email, plano, ciclo, quantidadeUsuarios: quantidade, mpPaymentId: String(resultado.id) });
      return res.status(200).json({
        status: 'aprovado',
        redirect: '/login.html',
        mensagem: usuarioExistente
          ? 'Pagamento aprovado! Seu plano já está ativo.'
          : 'Pagamento aprovado! Verifique seu e-mail para definir sua senha.',
      });
    }

    if (resultado.status === 'rejected') {
      return res.status(400).json({ status: 'recusado', error: 'Pagamento recusado. Verifique os dados do cartão.' });
    }

    // --- PIX / BOLETO: pendente até o webhook confirmar ---
    const { error: pendenteError } = await supabase.from('checkouts_pendentes').insert({
      email,
      plano_id: plano.id,
      ciclo,
      quantidade_usuarios: quantidade,
      mp_payment_id: String(resultado.id),
      status: 'pendente',
    });
    if (pendenteError) throw pendenteError;

    return res.status(200).json({
      status: 'pendente',
      paymentId: String(resultado.id),
      qrCode: resultado.point_of_interaction?.transaction_data?.qr_code,
      qrCodeBase64: resultado.point_of_interaction?.transaction_data?.qr_code_base64,
      ticketUrl: resultado.transaction_details?.external_resource_url,
    });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Erro no checkout:', err);
    const status = err.statusCode && err.statusCode < 500 ? 400 : 500;
    return res.status(status).json({ error: 'Não foi possível processar o pagamento. Verifique os dados e tente novamente.' });
  }
}
