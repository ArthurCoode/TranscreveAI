import { limitar } from '../../lib/rateLimit';
import { verificarCredenciais } from '../../lib/supabaseAuth';
import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import supabase from '../../lib/supabase';

export default async function handler(req, res) {
  if (aplicarCors(req, res, 'PUT')) return;
  if (req.method !== 'PUT') return res.status(405).json({ erro: 'Método não permitido.' });

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  if (!limitar(req, res, { chave: `trocar-senha:${usuario.id}`, limite: 5, janelaMs: 15 * 60 * 1000 })) return;

  const { senhaAtual, novaSenha } = req.body || {};

  if (!senhaAtual || !novaSenha) {
    return res.status(400).json({ erro: 'Preencha a senha atual e a nova senha.' });
  }
  if (novaSenha.length < 8) {
    return res.status(400).json({ erro: 'A nova senha precisa ter pelo menos 8 caracteres.' });
  }
  if (senhaAtual === novaSenha) {
    return res.status(400).json({ erro: 'A nova senha precisa ser diferente da atual.' });
  }

  try {
    // busca o e-mail real na tabela — não confia em nada que veio do token pra isso
    const { data: perfil, error: perfilError } = await supabase
      .from('usuarios')
      .select('email')
      .eq('id', usuario.id)
      .single();

    if (perfilError || !perfil) {
      return res.status(404).json({ erro: 'Usuário não encontrado.' });
    }

    // confirma a senha atual tentando autenticar de verdade com ela —
    // é a forma correta de validar sem guardar/comparar senha manualmente
    const credenciaisOk = await verificarCredenciais(perfil.email, senhaAtual);

    if (!credenciaisOk) {
      return res.status(401).json({ erro: 'Senha atual incorreta.' });
    }

    // troca a senha de verdade via admin API (service key, ignora RLS/sessão)
    const { error: updateError } = await supabase.auth.admin.updateUserById(usuario.id, {
      password: novaSenha,
    });

    if (updateError) {
      return res.status(500).json({ erro: updateError.message });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('Erro ao trocar senha:', err);
    return res.status(500).json({ erro: 'Erro interno ao trocar a senha.' });
  }
}