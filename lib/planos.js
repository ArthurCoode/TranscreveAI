// lib/planos.js
// Regras de preço e de período de assinatura — SEMPRE calculadas no
// servidor a partir da tabela "planos". O valor enviado pelo navegador
// nunca é usado para cobrar.
import supabase from './supabase';

export const CICLOS_VALIDOS = ['monthly', 'yearly'];
const MAX_USUARIOS_POR_PLANO = 500;

export function idPlanoAdmin() {
  return process.env.ADMIN_PLANO_ID || null;
}

export async function buscarPlano(planoId) {
  if (typeof planoId !== 'string' || !planoId) return null;
  const { data, error } = await supabase
    .from('planos')
    .select('id, nome, ativo, preco_mensal, preco_anual, por_usuario')
    .eq('id', planoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Valida plano/ciclo/quantidade e devolve o valor real a cobrar.
// Lança Error com .status = 400 para entradas inválidas.
export function calcularCobranca(plano, ciclo, quantidadeUsuarios) {
  const erro = (msg) => Object.assign(new Error(msg), { status: 400 });

  if (!plano || plano.ativo !== true) throw erro('Plano inválido.');
  if (idPlanoAdmin() && plano.id === idPlanoAdmin()) throw erro('Plano inválido.');
  if (plano.nome === 'Enterprise') throw erro('O plano Enterprise é contratado via contato comercial.');
  if (!CICLOS_VALIDOS.includes(ciclo)) throw erro('Ciclo de cobrança inválido.');

  const precoBase = Number(ciclo === 'yearly' ? plano.preco_anual : plano.preco_mensal);
  if (!Number.isFinite(precoBase) || precoBase < 0) throw erro('Plano sem preço configurado.');

  let quantidade = 1;
  const cobraPorUsuario = plano.por_usuario === true && Number(plano.preco_mensal) > 0;
  if (cobraPorUsuario) {
    quantidade = Number.parseInt(quantidadeUsuarios, 10);
    if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_USUARIOS_POR_PLANO) {
      throw erro('Quantidade de usuários inválida.');
    }
  }

  const valor = Math.round(precoBase * quantidade * 100) / 100;
  return { valor, quantidade, gratuito: valor === 0 };
}

// Duração do período pago, usada para expirar assinaturas sem renovação.
export function duracaoCicloMs(ciclo) {
  const dia = 24 * 60 * 60 * 1000;
  return ciclo === 'yearly' ? 365 * dia : 30 * dia;
}

export function fimDoPeriodo(assinatura) {
  const inicio = new Date(assinatura.criado_em).getTime();
  return new Date(inicio + duracaoCicloMs(assinatura.ciclo));
}
