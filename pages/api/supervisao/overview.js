import supabase from "../../../lib/supabase";
import { autenticarReq } from "../../../lib/auth";

/*
  Endpoint exclusivo pra admin. Devolve tudo que o painel de
  Supervisão precisa numa chamada só:
  - ranking de membros (health score simplificado)
  - alertas (atividades atrasadas, sem reunião recente)
  - reuniões recentes do time com sentimento do cliente
  - destaques (reconhecimento automático)
*/

function parseDuracaoParaSegundos(valor) {
  if (!valor) return 0;
  const str = String(valor).trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);

  let total = 0;
  const h = str.match(/(\d+(?:\.\d+)?)\s*h/);
  const min = str.match(/(\d+(?:\.\d+)?)\s*min/);
  const s = str.match(/(\d+(?:\.\d+)?)\s*(?:s|seg|segundos?)\b/);

  if (h) total += parseFloat(h[1]) * 3600;
  if (min) total += parseFloat(min[1]) * 60;
  if (s) total += parseFloat(s[1]);

  return total;
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ erro: "Método não permitido" });
  }

  try {
    const auth = await autenticarReq(req, res);
    if (!auth) return;

    const { data: me, error: meError } = await supabase
      .from("usuarios")
      .select("team_id, role")
      .eq("id", auth.id)
      .maybeSingle();

    if (meError) throw meError;

    if (!me?.team_id) {
      return res.status(200).json({
        ranking: [],
        alertas: [],
        reunioes_recentes: [],
        destaques: []
      });
    }

    // GATE DE ADMIN — nunca confiar em flag do frontend
    // comparação case-insensitive porque o banco guarda "Admin" (com A maiúsculo)
    if ((me.role || "").toLowerCase() !== "admin") {
      return res.status(403).json({ erro: "Acesso restrito a administradores" });
    }

    const { data: members, error: membersError } = await supabase
      .from("usuarios")
      .select("id, nome, email, avatar_url")
      .eq("team_id", me.team_id);

    if (membersError) throw membersError;

    const memberIds = members.map((m) => m.id);
    const memberMap = Object.fromEntries(members.map((m) => [m.id, m]));

    const seteDiasAtras = new Date();
    seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);

    const trintaDiasAtras = new Date();
    trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);

    /*
      ATIVIDADES do time inteiro (todas, pra calcular atrasadas e
      taxa de conclusão por membro)
    */
    const { data: atividades, error: atividadesError } = await supabase
      .from("atividades")
      .select("responsavel_id, status, prazo, criado_em, atualizado_em")
      .in("responsavel_id", memberIds);

    if (atividadesError) throw atividadesError;

    /*
      TRANSCRIÇÕES dos últimos 30 dias — base pra reuniões recentes,
      sentimento, e cálculo de "sem reunião há X dias"
    */
    const { data: transcricoes, error: transcricoesError } = await supabase
      .from("transcricoes")
      .select(
        "id, usuario_id, nome, duracao, criado_em, sentimento, tem_reclamacao, tem_risco_cancelamento, cliente_mencionado, resumo"
      )
      .in("usuario_id", memberIds)
      .gte("criado_em", trintaDiasAtras.toISOString())
      .order("criado_em", { ascending: false });

    if (transcricoesError) throw transcricoesError;

    const agora = new Date();
    const alertas = [];
    const ranking = [];

    for (const member of members) {
      const minhasAtividades = (atividades || []).filter(
        (a) => a.responsavel_id === member.id
      );
      const minhasTranscricoes = (transcricoes || []).filter(
        (t) => t.usuario_id === member.id
      );

      const concluidas = minhasAtividades.filter((a) => a.status === "concluido");
      const pendentes = minhasAtividades.filter((a) => a.status !== "concluido");
      const atrasadas = pendentes.filter(
        (a) => a.prazo && new Date(a.prazo) < agora
      );

      const totalComPrazo = minhasAtividades.filter((a) => a.prazo).length;
      const taxaConclusaoPrazo =
        totalComPrazo > 0
          ? Math.round(
              (concluidas.filter((a) => a.prazo && new Date(a.prazo) >= new Date(a.atualizado_em)).length /
                totalComPrazo) *
                100
            )
          : 100;

      const reunioesUltimos30d = minhasTranscricoes.length;

      const ultimaReuniao = minhasTranscricoes[0]; // já vem ordenado desc
      const diasSemReuniao = ultimaReuniao
        ? Math.floor((agora - new Date(ultimaReuniao.criado_em)) / (1000 * 60 * 60 * 24))
        : null;

      const totalSegundos = minhasTranscricoes.reduce(
        (acc, t) => acc + parseDuracaoParaSegundos(t.duracao),
        0
      );

      // health score simples: 50% taxa de prazo, 30% atividade em reuniões, 20% ausência de atrasos
      const scoreReunioes = Math.min(reunioesUltimos30d * 10, 100);
      const scorePenalidadeAtraso = Math.max(100 - atrasadas.length * 20, 0);
      const healthScore = Math.round(
        taxaConclusaoPrazo * 0.5 + scoreReunioes * 0.3 + scorePenalidadeAtraso * 0.2
      );

      ranking.push({
        id: member.id,
        name: member.nome,
        email: member.email,
        avatar_url: member.avatar_url,
        health_score: healthScore,
        reunioes_30d: reunioesUltimos30d,
        horas_30d: (totalSegundos / 3600).toFixed(1),
        atividades_concluidas: concluidas.length,
        atividades_pendentes: pendentes.length,
        atividades_atrasadas: atrasadas.length,
        taxa_conclusao_prazo: taxaConclusaoPrazo
      });

      // ALERTAS
      if (atrasadas.length > 0) {
        alertas.push({
          tipo: "atividade_atrasada",
          severidade: atrasadas.length > 3 ? "critico" : "atencao",
          membro_id: member.id,
          membro_nome: member.nome,
          detalhes: { quantidade: atrasadas.length }
        });
      }

      if (diasSemReuniao !== null && diasSemReuniao >= 7) {
        alertas.push({
          tipo: "sem_reuniao",
          severidade: "atencao",
          membro_id: member.id,
          membro_nome: member.nome,
          detalhes: { dias: diasSemReuniao }
        });
      }

      const reunioesComRisco = minhasTranscricoes.filter(
        (t) => t.tem_risco_cancelamento || t.sentimento === "negativo" || t.sentimento === "insatisfeito"
      );

      if (reunioesComRisco.length > 0) {
        alertas.push({
          tipo: "sentimento_negativo",
          severidade: reunioesComRisco.some((t) => t.tem_risco_cancelamento) ? "critico" : "atencao",
          membro_id: member.id,
          membro_nome: member.nome,
          detalhes: { quantidade: reunioesComRisco.length }
        });
      }
    }

    ranking.sort((a, b) => b.health_score - a.health_score);

    /*
      REUNIÕES RECENTES DO TIME (últimas 15, todo mundo, com sentimento)
    */
    const reunioesRecentes = (transcricoes || []).slice(0, 15).map((t) => ({
      id: t.id,
      titulo: t.nome,
      membro_nome: memberMap[t.usuario_id]?.nome || "—",
      criado_em: t.criado_em,
      duracao: t.duracao,
      sentimento: t.sentimento || "neutro",
      tem_reclamacao: !!t.tem_reclamacao,
      tem_risco_cancelamento: !!t.tem_risco_cancelamento,
      cliente_mencionado: t.cliente_mencionado || null
    }));

    /*
      DESTAQUES — regra simples por enquanto (sem chamada de IA):
      maior health score do time, e quem teve mais reuniões com
      sentimento positivo. Dá pra depois trocar por um texto gerado
      via Groq usando esses mesmos dados.
    */
    const destaques = [];

    const melhorScore = ranking[0];
    if (melhorScore && melhorScore.health_score >= 80) {
      destaques.push({
        membro_id: melhorScore.id,
        membro_nome: melhorScore.name,
        motivo: `${melhorScore.name} está com o melhor desempenho do time: score de ${melhorScore.health_score}, ${melhorScore.taxa_conclusao_prazo}% das atividades concluídas no prazo.`
      });
    }

    for (const member of members) {
      const positivas = (transcricoes || []).filter(
        (t) => t.usuario_id === member.id && t.sentimento === "positivo"
      );

      if (positivas.length >= 3) {
        destaques.push({
          membro_id: member.id,
          membro_nome: member.nome,
          motivo: `${member.nome} teve ${positivas.length} reuniões com sentimento positivo do cliente nos últimos 30 dias.`
        });
      }
    }

    return res.status(200).json({
      ranking,
      alertas,
      reunioes_recentes: reunioesRecentes,
      destaques
    });
  } catch (err) {
    console.error("SUPERVISAO OVERVIEW:", err);
    return res.status(500).json({ erro: err.message });
  }
}