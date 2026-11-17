// pages/api/team/member/[id].js
//
// Detalhe de UM membro do time, usado pelo drawer do painel "Time"
// (assets/js/team.js). Só devolve dados de quem pertence ao MESMO
// team_id de quem está pedindo — qualquer membro do time pode ver o
// drawer de qualquer colega (não é exclusivo de admin; é o mesmo nível
// de acesso que a lista geral do time já tem).
import supabase from '../../../../lib/supabase';
import { autenticarReq } from '../../../../lib/auth';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ erro: 'Método não permitido' });
  }

  const usuario = await autenticarReq(req, res);
  if (!usuario) return;

  const { id } = req.query;

  try {
    const { data: me, error: meError } = await supabase
      .from('usuarios')
      .select('team_id')
      .eq('id', usuario.id)
      .maybeSingle();

    if (meError) throw meError;

    if (!me?.team_id) {
      return res.status(403).json({ erro: 'Você não pertence a nenhum time' });
    }

    const { data: membro, error: membroError } = await supabase
      .from('usuarios')
      .select('id, nome, email, role, avatar_url, team_id')
      .eq('id', id)
      .maybeSingle();

    if (membroError) throw membroError;

    if (!membro || membro.team_id !== me.team_id) {
      return res.status(404).json({ erro: 'Membro não encontrado' });
    }

    const seisSemanasAtras = new Date();
    seisSemanasAtras.setDate(seisSemanasAtras.getDate() - 42);

    const { data: transcricoes, error: transcricoesError } = await supabase
      .from('transcricoes')
      .select('id, nome, criado_em')
      .eq('usuario_id', id)
      .gte('criado_em', seisSemanasAtras.toISOString())
      .order('criado_em', { ascending: false });

    if (transcricoesError) throw transcricoesError;

    const { data: atividades, error: atividadesError } = await supabase
      .from('atividades')
      .select('id, titulo, status, prazo, criado_em')
      .eq('responsavel_id', id)
      .order('criado_em', { ascending: false })
      .limit(3);

    if (atividadesError) throw atividadesError;

    /*
      Agrupa as transcrições dos últimos 42 dias em 6 baldes semanais
      (semana mais antiga primeiro, semana atual por último), pro
      mini-gráfico do drawer.
    */
    const hoje = new Date();
    const semanas = [];

    for (let i = 5; i >= 0; i--) {
      const inicioBalde = new Date(hoje);
      inicioBalde.setDate(inicioBalde.getDate() - (i * 7 + 6));
      inicioBalde.setHours(0, 0, 0, 0);

      const fimBalde = new Date(hoje);
      fimBalde.setDate(fimBalde.getDate() - i * 7);
      fimBalde.setHours(23, 59, 59, 999);

      const quantidade = (transcricoes || []).filter((t) => {
        const d = new Date(t.criado_em);
        return d >= inicioBalde && d <= fimBalde;
      }).length;

      semanas.push({ label: `S${6 - i}`, reunioes: quantidade });
    }

    return res.status(200).json({
      membro: {
        id: membro.id,
        nome: membro.nome,
        email: membro.email,
        role: membro.role,
        avatar_url: membro.avatar_url
      },
      reunioes_por_semana: semanas,
      ultimas_reunioes: (transcricoes || []).slice(0, 5).map((t) => ({
        id: t.id,
        nome: t.nome,
        criado_em: t.criado_em
      })),
      ultimas_atividades: atividades || []
    });
  } catch (err) {
    console.error('TEAM MEMBER DETAILS:', err);
    return res.status(500).json({ erro: err.message });
  }
}