// lib/conteudo.js
// Validação do conteúdo global exibido no dashboard (banner e mídia de
// boas-vindas). Esse conteúdo aparece para TODOS os usuários, então só
// formatos estritos são aceitos.

export const TABELA_BANNER = 'dashboard_banner';
export const TABELA_MIDIA = 'dashboard_media';

const TIPOS_BANNER = ['info', 'warning', 'success', 'danger'];
const TIPOS_MIDIA = ['video', 'foto'];
const COR_RE = /^#[0-9a-fA-F]{6}$/;
const ICONE_RE = /^fa-[a-z0-9-]{1,40}$/;

export function urlHttpsValida(valor) {
  if (typeof valor !== 'string' || valor.length > 1000) return null;
  try {
    const url = new URL(valor);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function validarBanner(body) {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 300) return { erro: 'A mensagem deve ter entre 1 e 300 caracteres.' };

  const bg_color = COR_RE.test(body.bg_color || '') ? body.bg_color : '#4f46e5';
  const text_color = COR_RE.test(body.text_color || '') ? body.text_color : '#ffffff';
  const icon = ICONE_RE.test(body.icon || '') ? body.icon : 'fa-bell';
  const type = TIPOS_BANNER.includes(body.type) ? body.type : 'info';

  let link = null;
  if (body.link) {
    link = urlHttpsValida(body.link);
    if (!link) return { erro: 'O link precisa ser uma URL https válida.' };
  }

  return { dados: { message, bg_color, text_color, icon, link, type, ativo: body.ativo === true } };
}

export function validarMidia(body) {
  const tipo = TIPOS_MIDIA.includes(body.tipo) ? body.tipo : null;
  if (!tipo) return { erro: 'Tipo de mídia inválido.' };
  const url = urlHttpsValida(body.url);
  if (!url) return { erro: 'A URL da mídia precisa ser https.' };
  return { dados: { tipo, url, ativo: body.ativo === true } };
}
