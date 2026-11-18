import { limitar, ipDaReq } from '../../lib/rateLimit';
import { cadastrarUsuario } from '../../lib/supabaseAuth';
import { aplicarCors } from '../../lib/cors';
import { gerarToken } from '../../lib/auth';

export default async function handler(req, res) {
  // CORS (mesmo padrão do login)
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ erro: 'Método não permitido.' });
  }

  if (!limitar(req, res, { chave: `register:${ipDaReq(req)}`, limite: 5, janelaMs: 60 * 60 * 1000 })) return;

  // aceita os dois formatos: a página register.html envia name/password,
  // outros clientes (ex: extensão) usam nome/senha
  const body = req.body || {};
  const nomeBruto = typeof body.nome === 'string' ? body.nome : body.name;
  const senhaBruta = typeof body.senha === 'string' ? body.senha : body.password;
  const nome = typeof nomeBruto === 'string' ? nomeBruto.replace(/[<>]/g, '').trim().slice(0, 80) : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const senha = typeof senhaBruta === 'string' ? senhaBruta : '';

  if (!nome || !email || !senha) {
    return res.status(400).json({ erro: 'Nome, email e senha são obrigatórios.' });
  }

  try {
    if (senha.length < 8) {
      return res.status(400).json({ erro: 'A senha precisa ter pelo menos 8 caracteres.' });
    }

    // 1. Cria usuário no Supabase Auth (client descartável)
    const { data, error } = await cadastrarUsuario({ email, senha, nome });
    if (error || !data.user) {
      return res.status(400).json({
        erro: error?.message || 'Erro ao criar usuário.'
      });
    }

    // 2. Sem sessão = o projeto exige confirmação de e-mail. Nesse caso NÃO
    //    entregamos token: antes, qualquer pessoa podia se cadastrar com o
    //    e-mail de outra e usar o sistema sem nunca provar que é dona dele.
    if (!data.session) {
      return res.status(201).json({
        ok: true,
        confirmacaoPendente: true,
        mensagem: 'Conta criada! Enviamos um link de confirmação para o seu e-mail. Confirme para poder entrar.'
      });
    }

    // 3. Confirmação automática habilitada: já entra logado (igual login)
    const token = gerarToken({
      id: data.user.id,
      email,
      plano: 'gratuito'
    });

    return res.status(201).json({
      ok: true,
      token,
      nome,
      email,
      plano: 'gratuito'
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      erro: 'Erro interno no servidor.'
    });
  }
}