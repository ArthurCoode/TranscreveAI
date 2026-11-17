// pages/api/admin/conteudo.js
// Gestão do banner global e da mídia de boas-vindas — só admin do site.
//   GET    ?tipo=banner|midia        → histórico (banner) / registros (mídia)
//   POST   { tipo, ...campos }       → publica (se ativo, desativa o anterior)
//   DELETE ?tipo=banner|midia        → desativa o item ativo
// Antes o painel gravava direto no banco com a anon key pública, o que
// permitia a qualquer pessoa publicar um banner com HTML para todos.
import supabase from '../../../lib/supabase';
import { exigirAdmin } from './_adminGuard';
import { TABELA_BANNER, TABELA_MIDIA, validarBanner, validarMidia } from '../../../lib/conteudo';

function tabelaDe(tipo) {
  if (tipo === 'banner') return TABELA_BANNER;
  if (tipo === 'midia') return TABELA_MIDIA;
  return null;
}

export default async function handler(req, res) {
  const admin = await exigirAdmin(req, res);
  if (!admin) return;

  const tipo = req.method === 'POST' ? req.body?.tipo : req.query.tipo;
  const tabela = tabelaDe(tipo);
  if (!tabela) return res.status(400).json({ erro: 'tipo deve ser "banner" ou "midia".' });

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from(tabela)
        .select('*')
        .order('criado_em', { ascending: false })
        .limit(20);
      if (error) throw error;
      return res.status(200).json({ ok: true, data });
    }

    if (req.method === 'POST') {
      const corpo = tipo === 'banner' ? req.body : { ...req.body, tipo: req.body?.tipo_midia };
      const { erro, dados } = tipo === 'banner' ? validarBanner(corpo) : validarMidia(corpo);
      if (erro) return res.status(400).json({ erro });

      if (dados.ativo) {
        const { error: erroDesativar } = await supabase.from(tabela).update({ ativo: false }).eq('ativo', true);
        if (erroDesativar) throw erroDesativar;
      }

      const { error } = await supabase.from(tabela).insert([dados]);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const { error } = await supabase.from(tabela).update({ ativo: false }).eq('ativo', true);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ erro: 'Método não permitido.' });
  } catch (err) {
    console.error('Erro em /api/admin/conteudo:', err);
    return res.status(500).json({ erro: 'Erro ao processar conteúdo.' });
  }
}
