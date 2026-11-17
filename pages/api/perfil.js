import { validarAtualizacaoPerfil } from '../../lib/perfil';
import { aplicarCors } from '../../lib/cors';
import { autenticarReq } from '../../lib/auth';
import supabase from '../../lib/supabase';

export default async function handler(req, res) {
  try {

    
    // impede cache do navegador/CDN — sem isso, depois de cancelar/reativar
    // assinatura, a tela pode continuar mostrando o estado antigo (visto com
    // /api/status-pagamento antes, mesmo problema aqui)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');

    if (aplicarCors(req, res, 'GET, PUT')) return;

    const usuario = await autenticarReq(req, res);
    if (!usuario) return;

    if (req.method === 'GET') {

      const { data, error } = await supabase
        .from('usuarios')
        .select(`
          id,
          nome,
          email,
          plano,
          plano_id,
          avatar_url,
          criado_em,
          role,
          fim_ciclo
        `)
        .eq('id', usuario.id)
        .single();

      if (error) {
        return res.status(500).json({ erro: error.message });
      }

      // status da assinatura paga (se houver) — usado pra decidir se mostra
      // "Cancelar assinatura" ou "Reativar assinatura" na tela de Configurações
      const { data: assinatura } = await supabase
        .from('assinaturas')
        .select('status')
        .eq('user_id', usuario.id)
        .in('status', ['ativa', 'cancelamento_agendado'])
        .maybeSingle();

      return res.status(200).json({
        ok: true,
        perfil: {
          ...data,
          totalTranscricoes: 0,
          percentualUso: 0,
          statusAssinatura: assinatura?.status || null, // 'ativa' | 'cancelamento_agendado' | null
        }
      });

    }

    if (req.method === 'PUT') {

      const { erro: erroValidacao, atualizacao } = validarAtualizacaoPerfil(req.body || {});
      if (erroValidacao) {
        return res.status(400).json({ erro: erroValidacao });
      }
      if (Object.keys(atualizacao).length === 0) {
        return res.status(400).json({ erro: 'Nada para atualizar.' });
      }

      const { error } = await supabase
        .from('usuarios')
        .update(atualizacao)
        .eq('id', usuario.id);

      if (error) {
        console.error('Erro ao atualizar perfil:', error);
        return res.status(500).json({ erro: 'Não foi possível atualizar o perfil.' });
      }

      return res.status(200).json({ ok: true });

    }

    return res.status(405).json({ erro: 'Método não permitido' });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ erro: err.message });
  }
}