// pages/api/salvar.js
// Transcritor | versão estável + correção JWT → UUID + update por id
// (evita duplicar a transcrição quando "Parar" salva um rascunho e
// depois "Exportar" reenvia com resumo/insights preenchidos)
//
// Fase 0 (memória corporativa do Theo): agora também recebe e persiste
// "metadados" (temas, cliente_mencionado, participantes, sentimento,
// tem_reclamacao, tem_risco_cancelamento, intencao_compra,
// nivel_urgencia, tipo_reuniao), vindos de /api/resumo.
// No "Parar" (auto-save de rascunho, antes do resumo existir), metadados
// vem ausente/null — isso é esperado e tratado como "ainda sem metadados".
//
// Fase 1 (Atividades): quando a transcrição chega com um resumo REAL (ou
// seja, veio do "Exportar", não do auto-save do "Parar") e o body traz
// "acoes" (próximos passos extraídos por /api/resumo via resumoIA.js),
// cria automaticamente atividades sugeridas (origem='auto') vinculadas a
// essa transcrição, aguardando confirmação do usuário no Kanban. Roda
// DEPOIS do save no banco ter sucesso e nunca derruba a resposta da API
// caso a criação falhe — o save da transcrição é a fonte da verdade.
//
// Fase 1 (e-mail): quando a transcrição chega com um resumo REAL, dispara
// um e-mail com resumo + insights + transcrição completa pro próprio
// e-mail do usuário logado. Mesma lógica de "best-effort, nunca bloqueia".
import supabase from '../../lib/supabase';
import { enviarEmailResumo } from '../../lib/email';
import { autenticarReq } from '../../lib/auth';
import { aplicarCors } from '../../lib/cors';

const SENTIMENTOS_VALIDOS = ['positivo', 'neutro', 'negativo'];
const NIVEIS_VALIDOS = ['alta', 'media', 'baixa']; // usado por intencao_compra e nivel_urgencia
const TIPOS_REUNIAO_VALIDOS = ['venda', 'suporte', 'alinhamento', 'interno', 'negociacao', 'outro'];

// limites de tamanho: evitam linhas gigantes no banco e e-mails abusivos
const MAX_TRANSCRICAO = 2_000_000;
const MAX_RESUMO = 50_000;
const MAX_NOME = 200;

function textoLimitado(valor, max) {
  return typeof valor === 'string' ? valor.slice(0, max) : '';
}

export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };

export default async function handler(req, res) {
  // CORS restrito (site + extensão do Chrome)
  if (aplicarCors(req, res, 'POST')) return;
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      erro: 'Método não permitido'
    });
  }
  // Autenticação com verificação de assinatura do JWT (antes o token era
  // só decodificado, o que permitia forjar qualquer usuário).
  const usuarioAuth = await autenticarReq(req, res);
  if (!usuarioAuth) return;
  const usuario = { id: usuarioAuth.id };
  try {
    // =========================
    // 📦 BODY
    // =========================
    const {
      id, // opcional: se vier, atualiza a transcrição já existente em vez de criar uma nova
      nome,
      data,
      horaInicio,
      horaFim,
      duracao,
      totalFalas,
      totalPalavras,
      transcricao,
      resumo,
      insights,
      metadados, // objeto vindo de /api/resumo, ou ausente/null no auto-save do "Parar"
      acoes // array vindo de /api/resumo (resumoIA.js), ou ausente/null no auto-save do "Parar"
    } = req.body || {};
    if (!transcricao || typeof transcricao !== 'string') {
      return res.status(400).json({
        ok: false,
        erro: 'Transcrição obrigatória'
      });
    }
    if (transcricao.length > MAX_TRANSCRICAO) {
      return res.status(413).json({ ok: false, erro: 'Transcrição grande demais.' });
    }
    const insightsLimpos = Array.isArray(insights)
      ? insights.filter((i) => typeof i === 'string').map((i) => i.slice(0, 500)).slice(0, 10)
      : [];
    const resumoLimpo = textoLimitado(resumo, MAX_RESUMO);
    const nomeLimpo = textoLimitado(nome, MAX_NOME).trim() || 'Sem título';
    // =========================
    // 📌 PAYLOAD SUPABASE
    // =========================
    const metadadosValidados = validarMetadados(metadados);
    const payloadDB = {
      usuario_id: usuario.id,
      nome: nomeLimpo,
      data: /^\d{4}-\d{2}-\d{2}$/.test(data || '') ? data : new Date().toISOString().split('T')[0],
      hora_inicio: textoLimitado(horaInicio, 20) || '--',
      hora_fim: textoLimitado(horaFim, 20) || '--',
      duracao: textoLimitado(String(duracao ?? ''), 30) || '--',
      total_falas: Number.parseInt(totalFalas, 10) || 0,
      total_palavras: Number.parseInt(totalPalavras, 10) || 0,
      transcricao,
      resumo: resumoLimpo,
      insights: insightsLimpos,
      temas: metadadosValidados.temas,
      cliente_mencionado: metadadosValidados.cliente_mencionado,
      participantes: metadadosValidados.participantes,
      sentimento: metadadosValidados.sentimento,
      tem_reclamacao: metadadosValidados.tem_reclamacao,
      tem_risco_cancelamento: metadadosValidados.tem_risco_cancelamento,
      intencao_compra: metadadosValidados.intencao_compra,
      nivel_urgencia: metadadosValidados.nivel_urgencia,
      tipo_reuniao: metadadosValidados.tipo_reuniao
    };
    // =========================
    // 💾 SALVAR (update se já existir, insert caso contrário)
    // =========================
    let resultado, error;
    if (id) {
      // já existe uma linha criada no "Parar" — atualiza ela em vez de duplicar
      ({ data: resultado, error } = await supabase
        .from('transcricoes')
        .update(payloadDB)
        .eq('id', id)
        .eq('usuario_id', usuario.id) // garante que só atualiza transcrição do próprio usuário
        .select()
        .maybeSingle());
      // id inválido, de ooutro usuário, ou já removido: nenhuma linha fi
      // atualizada — cai pro insert como fallback, pra não perder o salvamento
      if (!error && !resultado) {
        ({ data: resultado, error } = await supabase
          .from('transcricoes')
          .insert(payloadDB)
          .select()
          .maybeSingle());
      }
    } else {
      ({ data: resultado, error } = await supabase
        .from('transcricoes')
        .insert(payloadDB)
        .select()
        .maybeSingle());
    }
    if (error) {
      console.error('ERRO SUPABASE:', error);
      return res.status(500).json({
        ok: false,
        erro: 'Falha ao salvar a transcrição.'
      });
    }
    // =========================
    // 📧 E-MAIL DE RESUMO (só quando veio um resumo real do "Exportar")
    // =========================
    // O "Parar" salva com resumo: '' (rascunho), então cai fora daqui
    // automaticamente. Roda depois do save confirmado, e qualquer falha
    // no envio fica só logada — nunca muda a resposta 200 já garantida.
    let emailEnviado = false;
    if (resumoLimpo.trim()) {
      // O destino vem SEMPRE do Supabase Auth (nunca do token ou do body),
      // senão a rota viraria um disparador de e-mails para qualquer endereço.
      let emailDestino = null;
      try {
        const { data: authData, error: authError } = await supabase.auth.admin.getUserById(usuario.id);
        if (!authError && authData?.user?.email) emailDestino = authData.user.email;
      } catch (e) {
        console.warn('Não foi possível buscar e-mail do usuário para envio de resumo:', e.message);
      }
      try {
        await enviarEmailResumo({
          email: emailDestino,
          nomeReuniao: payloadDB.nome,
          data: payloadDB.data,
          duracao: payloadDB.duracao,
          totalFalas: payloadDB.total_falas,
          totalPalavras: payloadDB.total_palavras,
          resumo: resumoLimpo,
          insights: insightsLimpos,
          transcricao
        });
        emailEnviado = !!emailDestino;
      } catch (e) {
        console.warn('Falha ao enviar e-mail de resumo (não bloqueia o save):', e.message);
      }
    }
    // =========================
    // ✅ ATIVIDADES SUGERIDAS (só quando veio um resumo real + acoes)
    // =========================
    // Mesmo gate do e-mail: só roda quando é o "Exportar" de verdade
    // (resumo real), nunca no auto-save do "Parar". Best-effort: qualquer
    // falha aqui é só logada, não derruba a resposta 200 do save principal.
    let atividadesCriadas = 0;
    const acoesValidas = Array.isArray(acoes) ? acoes : [];
    if (resumo && resumo.trim() && acoesValidas.length > 0 && resultado?.id) {
      try {
        const { data: usuarioRow, error: erroUsuario } = await supabase
          .from('usuarios')
          .select('team_id')
          .eq('id', usuario.id)
          .single();

        if (!erroUsuario && usuarioRow?.team_id) {
          const linhasAtividades = acoesValidas
            .filter((a) => a && typeof a.titulo === 'string' && a.titulo.trim())
            .slice(0, 5)
            .map((a) => ({
              team_id: usuarioRow.team_id,
              titulo: a.titulo.trim().slice(0, 140),
              prazo: /^\d{4}-\d{2}-\d{2}$/.test(a.prazo_sugerido || '') ? a.prazo_sugerido : null,
              reuniao_id: null,
              transcricao_id: resultado.id,
              origem: 'auto',
              responsavel_id: usuario.id,
              criado_por: usuario.id,
              notificado: false
            }));

          if (linhasAtividades.length) {
            const { data: inseridas, error: erroAtividades } = await supabase
              .from('atividades')
              .insert(linhasAtividades)
              .select('id');

            if (erroAtividades) {
              console.warn('Falha ao criar atividades sugeridas (não bloqueia o save):', erroAtividades.message);
            } else {
              atividadesCriadas = inseridas?.length || 0;
            }
          }
        } else {
          console.warn('Usuário sem team_id — pulando criação de atividades sugeridas.');
        }
      } catch (e) {
        console.warn('Falha ao criar atividades sugeridas (não bloqueia o save):', e.message);
      }
    }
    // =========================
    // ✅ SUCCESS
    // =========================
    return res.status(200).json({
      ok: true,
      mensagem: 'Transcrição salva com sucesso',
      id: resultado?.id,
      dados: resultado,
      emailEnviado,
      atividadesCriadas
    });
  } catch (err) {
    console.error('ERRO FATAL:', err);
    return res.status(500).json({
      ok: false,
      fatal: true,
      erro: err.message || String(err)
    });
  }
}

// valida e normaliza "metadados" vindo do body — nunca confia cegamente,
// porque isso vira colunas tipadas (array, boolean, enum com CHECK) no
// Postgres. Se vier ausente/null (ex: auto-save do "Parar", antes do
// resumo existir) ou malformado, cai nos valores neutros de sempre.
function validarMetadados(m) {
  const base = {
    temas: [],
    cliente_mencionado: null,
    participantes: [],
    sentimento: null, // null aqui (não 'neutro') pra não afirmar um sentimento que ainda não foi analisado
    tem_reclamacao: false,
    tem_risco_cancelamento: false,
    intencao_compra: null,   // null = não avaliado; nunca inventa um valor
    nivel_urgencia: null,    // null = não avaliado; nunca inventa um valor
    tipo_reuniao: null       // null = não classificado; nunca inventa um valor
  };
  if (!m || typeof m !== 'object') return base;

  if (Array.isArray(m.temas)) {
    base.temas = m.temas
      .filter((t) => typeof t === 'string' && t.trim().length > 0)
      .map((t) => t.trim().toLowerCase().slice(0, 60))
      .slice(0, 6);
  }
  if (typeof m.cliente_mencionado === 'string' && m.cliente_mencionado.trim().length > 0) {
    base.cliente_mencionado = m.cliente_mencionado.trim().slice(0, 200);
  }
  if (Array.isArray(m.participantes)) {
    base.participantes = m.participantes
      .filter((p) => typeof p === 'string' && p.trim().length > 0)
      .map((p) => p.trim().slice(0, 100))
      .slice(0, 20);
  }
  if (SENTIMENTOS_VALIDOS.includes(m.sentimento)) {
    base.sentimento = m.sentimento;
  }
  base.tem_reclamacao = m.tem_reclamacao === true;
  base.tem_risco_cancelamento = m.tem_risco_cancelamento === true;

  if (NIVEIS_VALIDOS.includes(m.intencao_compra)) {
    base.intencao_compra = m.intencao_compra;
  }
  if (NIVEIS_VALIDOS.includes(m.nivel_urgencia)) {
    base.nivel_urgencia = m.nivel_urgencia;
  }
  if (TIPOS_REUNIAO_VALIDOS.includes(m.tipo_reuniao)) {
    base.tipo_reuniao = m.tipo_reuniao;
  }

  return base;
}