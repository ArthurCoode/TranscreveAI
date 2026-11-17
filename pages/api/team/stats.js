import supabase from "../../../lib/supabase";
import { autenticarReq } from "../../../lib/auth";

/*
  duracao vem como texto em formatos variados — mesma função
  já usada no team/stats original, mantida igual.
*/
function parseDuracaoParaSegundos(valor) {
  if (!valor) return 0;

  const str = String(valor).trim().toLowerCase();

  if (/^\d+(\.\d+)?$/.test(str)) {
    return parseFloat(str);
  }

  let totalSegundos = 0;

  const horasMatch = str.match(/(\d+(?:\.\d+)?)\s*h/);
  const minutosMatch = str.match(/(\d+(?:\.\d+)?)\s*min/);
  const segundosMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:s|seg|segundos?)\b/);

  if (horasMatch) totalSegundos += parseFloat(horasMatch[1]) * 3600;
  if (minutosMatch) totalSegundos += parseFloat(minutosMatch[1]) * 60;
  if (segundosMatch) totalSegundos += parseFloat(segundosMatch[1]);

  return totalSegundos;
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
      .select("team_id")
      .eq("id", auth.id)
      .maybeSingle();

    if (meError) throw meError;

    if (!me?.team_id) {
      return res.status(200).json([]);
    }

    const { data: members, error: membersError } = await supabase
      .from("usuarios")
      .select("id, nome, email, role, avatar_url")
      .eq("team_id", me.team_id);

    if (membersError) throw membersError;

    if (!members || members.length === 0) {
      return res.status(200).json([]);
    }

    const memberIds = members.map((m) => m.id);

    /*
      TRANSCRIÇÕES de todos os membros do time, numa query só
      (em vez de N queries dentro do loop, como na versão original).
      Também trazemos sentimento pra já deixar pronto pro drawer
      mostrar "última reunião: sentimento X" se quiser depois.
    */
    const { data: transcricoes, error: transcricoesError } = await supabase
      .from("transcricoes")
      .select("usuario_id, duracao, sentimento, criado_em")
      .in("usuario_id", memberIds);

    if (transcricoesError) throw transcricoesError;

    /*
      ATIVIDADES de todos os membros, também numa query só.
    */
    const { data: atividades, error: atividadesError } = await supabase
      .from("atividades")
      .select("responsavel_id, status, prazo")
      .in("responsavel_id", memberIds);

    if (atividadesError) throw atividadesError;

    const agora = new Date();

    const result = members.map((member) => {
      const minhasTranscricoes = (transcricoes || []).filter(
        (t) => t.usuario_id === member.id
      );

      const totalSegundos = minhasTranscricoes.reduce(
        (acc, t) => acc + parseDuracaoParaSegundos(t.duracao),
        0
      );

      const minhasAtividades = (atividades || []).filter(
        (a) => a.responsavel_id === member.id
      );

      const atividadesConcluidas = minhasAtividades.filter(
        (a) => a.status === "concluido"
      ).length;

      const atividadesPendentes = minhasAtividades.filter(
        (a) => a.status !== "concluido"
      ).length;

      const atividadesAtrasadas = minhasAtividades.filter(
        (a) =>
          a.status !== "concluido" &&
          a.prazo &&
          new Date(a.prazo) < agora
      ).length;

      const ultimaReuniao = minhasTranscricoes
        .filter((t) => t.criado_em)
        .sort((a, b) => new Date(b.criado_em) - new Date(a.criado_em))[0];

      return {
        id: member.id,
        name: member.nome,
        email: member.email,
        role: member.role,
        avatar_url: member.avatar_url,
        meetings: minhasTranscricoes.length,
        hours: (totalSegundos / 3600).toFixed(1),
        insights: minhasTranscricoes.length,
        atividades_concluidas: atividadesConcluidas,
        atividades_pendentes: atividadesPendentes,
        atividades_atrasadas: atividadesAtrasadas,
        ultima_reuniao_em: ultimaReuniao?.criado_em || null
      };
    });

    return res.status(200).json(result);
  } catch (err) {
    console.error("TEAM STATS:", err);

    return res.status(500).json({
      erro: err.message
    });
  }
}