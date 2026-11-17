// pages/api/conteudo-ativo.js
// GET (público) → banner e mídia de boas-vindas ativos no dashboard.
// Substitui a leitura direta das tabelas pelo navegador com a anon key,
// permitindo bloquear essas tabelas via RLS.
import supabase from '../../lib/supabase';
import { TABELA_BANNER, TABELA_MIDIA } from '../../lib/conteudo';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ erro: 'Método não permitido' });

  try {
    const [banner, midia] = await Promise.all([
      supabase
        .from(TABELA_BANNER)
        .select('id, message, bg_color, text_color, icon, link, type')
        .eq('ativo', true)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from(TABELA_MIDIA)
        .select('id, tipo, url')
        .eq('ativo', true)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.status(200).json({ ok: true, banner: banner.data || null, midia: midia.data || null });
  } catch (err) {
    console.error('Erro ao carregar conteúdo ativo:', err);
    return res.status(200).json({ ok: true, banner: null, midia: null });
  }
}
