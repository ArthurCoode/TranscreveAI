// lib/perfil.js
// Validação dos campos de perfil editáveis pelo próprio usuário. O nome e o
// avatar aparecem para outras pessoas (painel do time, supervisão, admin),
// então são validados aqui além de escapados no front.

const MAX_NOME = 80;

export function validarAtualizacaoPerfil({ nome, avatar_url }) {
  const atualizacao = {};

  if (nome !== undefined) {
    if (typeof nome !== 'string') return { erro: 'Nome inválido.' };
    const limpo = nome.replace(/[<>]/g, '').trim();
    if (!limpo || limpo.length > MAX_NOME) return { erro: `O nome deve ter entre 1 e ${MAX_NOME} caracteres.` };
    atualizacao.nome = limpo;
  }

  if (avatar_url !== undefined && avatar_url !== null && avatar_url !== '') {
    if (typeof avatar_url !== 'string' || avatar_url.length > 1000) return { erro: 'Avatar inválido.' };
    let url;
    try {
      url = new URL(avatar_url);
    } catch {
      return { erro: 'Avatar inválido.' };
    }
    const hostSupabase = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null;
    // só aceita imagens servidas pelo Storage do próprio projeto
    if (url.protocol !== 'https:' || !hostSupabase || url.host !== hostSupabase ||
        !url.pathname.startsWith('/storage/v1/object/public/avatars/')) {
      return { erro: 'Avatar inválido.' };
    }
    atualizacao.avatar_url = url.toString();
  }

  return { atualizacao };
}
