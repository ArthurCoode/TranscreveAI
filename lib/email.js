// lib/email.js

import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM_EMAIL = 'TranscreveAI <contato@transcreveia.com>';
const LINK_EXTENSAO = 'https://chromewebstore.google.com/detail/transcreveai-reuni%C3%B5es-em/pgcllgiibjbikdcgbjepilfhaimcehpc?hl=pt-br';

export async function enviarEmailDeAcesso({ email, linkAcesso, novoUsuario }) {
  if (!linkAcesso) {
    console.warn('Sem link de acesso para enviar — pulando envio de e-mail.');
    return;
  }

  const assunto = novoUsuario
    ? '🎉 Seja muito bem-vindo ao TranscreveAI!'
    : 'Acesse sua conta TranscreveAI';

  const blocoExtensao = `
    <div style="margin-top: 32px; padding-top: 24px; border-top: 1px solid #e5e5e5;">
      <p style="font-size: 14px; color: #333;">📌 Não esqueça de instalar nossa extensão para o Chrome e transcrever suas reuniões diretamente do navegador:</p>
      <p style="text-align: center; margin: 16px 0;"><a href="${LINK_EXTENSAO}" style="background-color: #ffffff; color: #4f46e5; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; display: inline-block; border: 2px solid #4f46e5;">🧩 Instalar extensão do Chrome</a></p>
      <p style="font-size: 12px; color: #777; word-break: break-all;"><a href="${LINK_EXTENSAO}" style="color: #777;">${LINK_EXTENSAO}</a></p>
    </div>
  `;

  const corpoHtml = novoUsuario
    ? `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
        <h2 style="margin-bottom: 4px;">🎉 Seja muito bem-vindo ao TranscreveAI!</h2>
        <p>Olá!</p>
        <p>É um prazer ter você conosco.</p>
        <p>Sua conta foi criada com sucesso e, a partir de agora, você poderá transformar reuniões, chamadas e conversas em transcrições organizadas, resumos inteligentes e insights gerados por IA.</p>
        <p>Para concluir seu cadastro, basta definir sua senha clicando no botão abaixo.</p>
        <p style="text-align: center; margin: 32px 0;"><a href="${linkAcesso}" style="background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">➡️ Definir minha senha</a></p>
        <p style="font-size: 13px; color: #555;">Caso o botão não funcione, copie e cole este link em seu navegador:<br /><a href="${linkAcesso}" style="color: #4f46e5; word-break: break-all;">${linkAcesso}</a></p>
        ${blocoExtensao}
      </div>
    `
    : `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
        <p>Use o link abaixo para acessar sua conta no TranscreveAI:</p>
        <p style="text-align: center; margin: 32px 0;"><a href="${linkAcesso}" style="background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">Acessar minha conta</a></p>
        <p style="font-size: 13px; color: #555;">Caso o botão não funcione, copie e cole este link em seu navegador:<br /><a href="${linkAcesso}" style="color: #4f46e5; word-break: break-all;">${linkAcesso}</a></p>
        ${blocoExtensao}
      </div>
    `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: assunto,
      html: corpoHtml,
    });
    if (error) console.error('Erro ao enviar e-mail via Resend:', error);
  } catch (emailErr) {
    console.error('Falha inesperada ao enviar e-mail de acesso:', emailErr.message);
  }
}

// =========================================================
// 📄 E-MAIL DE RESUMO + INSIGHTS + TRANSCRIÇÃO (disparado pelo "Exportar")
// =========================================================
//
// Reaproveita as mesmas 5 seções ALL-CAPS que /api/resumo.js gera
// (VISÃO GERAL, PRINCIPAIS TÓPICOS DISCUTIDOS, VALORES E CONDIÇÕES
// COMERCIAIS, DECISÕES TOMADAS, PRÓXIMOS PASSOS). Se essa lista mudar
// lá, precisa espelhar aqui também — são strings simples, não vale a
// pena criar um módulo compartilhado só por isso.
const SECOES_RESUMO = [
  'VISÃO GERAL',
  'PRINCIPAIS TÓPICOS DISCUTIDOS',
  'VALORES E CONDIÇÕES COMERCIAIS',
  'DECISÕES TOMADAS',
  'PRÓXIMOS PASSOS'
];

// ícone por seção — só estética, cai pro genérico se a seção mudar de nome lá em resumo.js
const ICONE_SECAO = {
  'VISÃO GERAL': '🔎',
  'PRINCIPAIS TÓPICOS DISCUTIDOS': '💬',
  'VALORES E CONDIÇÕES COMERCIAIS': '💰',
  'DECISÕES TOMADAS': '✅',
  'PRÓXIMOS PASSOS': '🚀'
};

// limite de tamanho da transcrição dentro do e-mail — e-mails muito
// grandes (>~100kb de HTML) podem ser cortados por alguns provedores
// (Gmail corta acima de 102kb e mostra "Ver mensagem inteira"), então
// truncamos com o mesmo padrão de "trecho omitido" usado no resumo.
const MAX_CHARS_TRANSCRICAO_EMAIL = 15000;

function escaparHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Transforma o texto plano do resumo (headers ALL-CAPS + bullets "- ")
// em cards separados por seção, cada um com ícone e um friso lateral colorido.
function formatarResumoHtml(resumo) {
  const linhas = (resumo || '').split('\n');
  const secoes = [];
  let atual = null;

  linhas.forEach((linhaBruta) => {
    const linha = linhaBruta.trim();
    if (!linha) return;

    if (SECOES_RESUMO.includes(linha)) {
      atual = { titulo: linha, itens: [], paragrafos: [] };
      secoes.push(atual);
      return;
    }
    if (!atual) return; // ignora qualquer conteúdo antes do primeiro header

    if (linha.startsWith('- ')) {
      atual.itens.push(linha.slice(2));
    } else {
      atual.paragrafos.push(linha);
    }
  });

  return secoes.map((s) => {
    const icone = ICONE_SECAO[s.titulo] || '📌';
    const paragrafosHtml = s.paragrafos
      .map((p) => `<p style="margin:0 0 8px; font-size:13.5px; line-height:1.6; color:#374151;">${escaparHtml(p)}</p>`)
      .join('');
    const itensHtml = s.itens.length
      ? `<ul style="margin:0; padding-left:18px;">${s.itens.map((i) => `<li style="font-size:13.5px; line-height:1.7; color:#374151; margin-bottom:3px;">${escaparHtml(i)}</li>`).join('')}</ul>`
      : '';

    return `
      <div style="margin-bottom:16px; background:#ffffff; border:1px solid #ede9fe; border-left:4px solid #7c3aed; border-radius:10px; padding:16px 18px;">
        <div style="font-size:13px; font-weight:700; color:#5b21b6; letter-spacing:0.3px; margin-bottom:8px; text-transform:uppercase;">${icone} ${s.titulo}</div>
        ${paragrafosHtml}
        ${itensHtml}
      </div>
    `;
  }).join('');
}

function formatarInsightsHtml(insights) {
  if (!Array.isArray(insights) || !insights.length) return '';
  const itens = insights
    .map((i) => `
      <div style="display:flex; align-items:flex-start; gap:8px; margin-bottom:10px;">
        <span style="flex-shrink:0; font-size:13px;">💡</span>
        <span style="font-size:13.5px; line-height:1.6; color:#065f46;">${escaparHtml(i)}</span>
      </div>
    `)
    .join('');
  return `
    <div style="margin:24px 0; padding:18px 20px; background:linear-gradient(135deg,#ecfdf5,#f0fdf4); border:1px solid #a7f3d0; border-radius:12px;">
      <div style="font-size:13.5px; font-weight:700; color:#059669; letter-spacing:0.3px; margin-bottom:12px; text-transform:uppercase;">✨ Insights da reunião</div>
      ${itens}
    </div>
  `;
}

// Renderiza a transcrição bruta (formato "[10:32] texto da fala") como
// blocos de linha, dentro de uma caixa com fonte monoespaçada — dá pra
// ler igual ao .txt exportado, sem precisar abrir o arquivo em anexo.
function formatarTranscricaoHtml(transcricao) {
  if (!transcricao || !transcricao.trim()) {
    return '<p style="font-size:13px; color:#9ca3af;">Nenhuma fala registrada.</p>';
  }

  let texto = transcricao;
  let truncada = false;
  if (texto.length > MAX_CHARS_TRANSCRICAO_EMAIL) {
    texto = texto.substring(0, MAX_CHARS_TRANSCRICAO_EMAIL);
    truncada = true;
  }

  const linhasHtml = texto
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      // separa "[10:32]" do resto da fala pra estilizar o horário em cinza,
      // mantendo tudo em uma div só (evita depender de regex complexa)
      const m = l.match(/^(\[\d{1,2}:\d{2}\])\s*(.*)$/);
      if (m) {
        return `<div style="margin-bottom:6px;"><span style="color:#9ca3af;">${escaparHtml(m[1])}</span> <span style="color:#1f2937;">${escaparHtml(m[2])}</span></div>`;
      }
      return `<div style="margin-bottom:6px; color:#1f2937;">${escaparHtml(l)}</div>`;
    })
    .join('');

  const avisoTruncado = truncada
    ? '<p style="font-size:11.5px; color:#9ca3af; margin-top:10px; font-style:italic;">Transcrição truncada neste e-mail por tamanho — o texto completo está salvo no seu histórico no site.</p>'
    : '';

  return `
    <div style="margin-top:10px; padding:16px 18px; background:#f9fafb; border:1px solid #e5e7eb; border-radius:10px; max-height:420px; overflow-y:auto; font-family:'Courier New', Courier, monospace; font-size:12px; line-height:1.6;">
      ${linhasHtml}
    </div>
    ${avisoTruncado}
  `;
}

function formatarEstatisticasHtml({ duracao, totalFalas, totalPalavras }) {
  const item = (valor, label) => `
    <td style="text-align:center; padding:14px 10px;">
      <div style="font-size:18px; font-weight:700; color:#4f46e5;">${escaparHtml(String(valor ?? '--'))}</div>
      <div style="font-size:10.5px; color:#9ca3af; text-transform:uppercase; letter-spacing:0.3px; margin-top:2px;">${label}</div>
    </td>
  `;
  return `
    <table role="presentation" width="100%" style="border-collapse:collapse; margin:20px 0; background:#faf5ff; border:1px solid #ede9fe; border-radius:12px;">
      <tr>
        ${item(duracao, 'Duração')}
        ${item(totalFalas, 'Falas')}
        ${item(totalPalavras, 'Palavras')}
      </tr>
    </table>
  `;
}

export async function enviarEmailResumo({ email, nomeReuniao, data, duracao, totalFalas, totalPalavras, resumo, insights, transcricao }) {
  if (!email) {
    console.warn('Sem e-mail de destino — pulando envio de resumo por e-mail.');
    return;
  }
  if (!resumo || resumo.toLowerCase().includes('não foi possível gerar o resumo')) {
    // não faz sentido mandar e-mail de um resumo que falhou
    return;
  }

  const tituloReuniao = nomeReuniao && nomeReuniao !== 'Sem título' ? nomeReuniao : 'Sua reunião';
  const dataFormatada = formatarDataExtensa(data);

  const corpoHtml = `
    <div style="background:#f3f4f6; padding:24px 12px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
      <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06);">

        <!-- Cabeçalho com gradiente, no mesmo tom da extensão -->
        <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6); padding:32px 28px 28px;">
          <div style="font-size:12px; font-weight:700; color:#d8b4fe; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px;">TranscreveAI</div>
          <div style="font-size:21px; font-weight:700; color:#ffffff; margin-bottom:4px;">📋 ${escaparHtml(tituloReuniao)}</div>
          <div style="font-size:13px; color:#e9d5ff;">${dataFormatada}</div>
        </div>

        <!-- Corpo -->
        <div style="padding:28px;">
          <p style="font-size:14px; color:#374151; margin:0 0 4px;">Olá! 👋</p>
          <p style="font-size:14px; color:#374151; margin:0 0 18px; line-height:1.6;">Sua reunião já foi transcrita e analisada por IA. Aqui está tudo organizado pra você revisar rapidinho:</p>

          ${formatarEstatisticasHtml({ duracao, totalFalas, totalPalavras })}

          <div style="font-size:13px; font-weight:700; color:#111827; letter-spacing:0.3px; margin:24px 0 12px; text-transform:uppercase;">📝 Resumo da reunião</div>
          ${formatarResumoHtml(resumo)}

          ${formatarInsightsHtml(insights)}

          <div style="margin-top:8px;">
            <div style="font-size:13px; font-weight:700; color:#111827; letter-spacing:0.3px; margin-bottom:4px; text-transform:uppercase;">🗒️ Transcrição completa</div>
            ${formatarTranscricaoHtml(transcricao)}
          </div>
        </div>

        <!-- Rodapé -->
        <div style="padding:20px 28px; background:#f9fafb; border-top:1px solid #eef0f3; text-align:center;">
          <p style="font-size:11.5px; color:#9ca3af; margin:0;">Enviado automaticamente pelo TranscreveAI ao exportar esta reunião.</p>
        </div>
      </div>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: email,
      subject: `📋 Resumo: ${tituloReuniao}`,
      html: corpoHtml,
    });
    if (error) console.error('Erro ao enviar e-mail de resumo via Resend:', error);
  } catch (emailErr) {
    console.error('Falha inesperada ao enviar e-mail de resumo:', emailErr.message);
  }
}

// converte "2026-07-26" (formato que o salvar.js já usa) numa data por
// extenso em pt-BR; se vier em outro formato ou vazio, devolve como veio
function formatarDataExtensa(dataISO) {
  if (!dataISO) return '';
  try {
    const [ano, mes, dia] = dataISO.split('-').map(Number);
    if (!ano || !mes || !dia) return dataISO;
    const d = new Date(ano, mes - 1, dia);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch (e) {
    return dataISO;
  }
}

// =========================================================
// 🆘 E-MAIL DE SUPORTE (disparado pelo Theo flutuante)
// =========================================================
//
// Destino fixo (não configurável pelo usuário, por design), definido em
// SUPPORT_EMAIL na Vercel — fica fora do código porque o repositório é
// público. O reply-to é o e-mail de quem abriu o chat.
const EMAIL_SUPORTE_DESTINO = process.env.SUPPORT_EMAIL || 'contato@transcreveia.com';

function formatarHistoricoSuporteHtml(historico) {
  return historico
    .map((m) => {
      const ehUsuario = m.role === 'user';
      const label = ehUsuario ? 'Usuário' : 'Theo';
      const corFundo = ehUsuario ? '#eef2ff' : '#f9fafb';
      const corLabel = ehUsuario ? '#4338ca' : '#6b7280';
      return `
        <div style="margin-bottom:10px; padding:12px 14px; background:${corFundo}; border-radius:10px;">
          <div style="font-size:11px; font-weight:700; color:${corLabel}; text-transform:uppercase; letter-spacing:0.3px; margin-bottom:4px;">${label}</div>
          <div style="font-size:13.5px; line-height:1.6; color:#1f2937; white-space:pre-wrap;">${escaparHtml(m.content)}</div>
        </div>
      `;
    })
    .join('');
}

// `historico` = [{ role: 'user' | 'assistant', content: string }, ...],
// já validado e limitado pelo endpoint (pages/api/theo/suporte-email.js).
export async function enviarEmailSuporte({ usuarioNome, usuarioEmail, historico }) {
  if (!Array.isArray(historico) || historico.length === 0) {
    console.warn('Sem histórico para enviar — pulando envio de e-mail de suporte.');
    return;
  }

  const primeiraPergunta = historico.find((m) => m.role === 'user')?.content || '(sem pergunta identificada)';
  const assuntoResumido = primeiraPergunta.length > 70 ? `${primeiraPergunta.slice(0, 70)}…` : primeiraPergunta;

  const corpoHtml = `
    <div style="background:#f3f4f6; padding:24px 12px; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
      <div style="max-width:600px; margin:0 auto; background:#ffffff; border-radius:16px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.06);">

        <div style="background:linear-gradient(135deg,#7c3aed,#5b21b6); padding:28px 28px 24px;">
          <div style="font-size:12px; font-weight:700; color:#d8b4fe; letter-spacing:1px; text-transform:uppercase; margin-bottom:6px;">TranscreveAI · Suporte</div>
          <div style="font-size:19px; font-weight:700; color:#ffffff;">🆘 Nova conversa encaminhada pelo Theo</div>
        </div>

        <div style="padding:28px;">
          <table role="presentation" width="100%" style="margin-bottom:20px; font-size:13.5px; color:#374151;">
            <tr>
              <td style="padding:4px 0; color:#9ca3af; width:70px;">Nome:</td>
              <td style="padding:4px 0; font-weight:600;">${escaparHtml(usuarioNome || 'Não informado')}</td>
            </tr>
            <tr>
              <td style="padding:4px 0; color:#9ca3af;">E-mail:</td>
              <td style="padding:4px 0; font-weight:600;">${escaparHtml(usuarioEmail || 'Não informado')}</td>
            </tr>
          </table>

          <div style="font-size:13px; font-weight:700; color:#111827; letter-spacing:0.3px; margin-bottom:12px; text-transform:uppercase;">💬 Conversa</div>
          ${formatarHistoricoSuporteHtml(historico)}
        </div>

        <div style="padding:18px 28px; background:#f9fafb; border-top:1px solid #eef0f3; text-align:center;">
          <p style="font-size:11.5px; color:#9ca3af; margin:0;">Responda este e-mail para falar diretamente com o usuário.</p>
        </div>
      </div>
    </div>
  `;

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: EMAIL_SUPORTE_DESTINO,
      replyTo: usuarioEmail || undefined,
      subject: `🆘 Suporte via Theo: ${assuntoResumido}`,
      html: corpoHtml,
    });
    if (error) {
      console.error('Erro ao enviar e-mail de suporte via Resend:', error);
      throw new Error(error.message || 'Falha ao enviar e-mail de suporte');
    }
  } catch (emailErr) {
    console.error('Falha inesperada ao enviar e-mail de suporte:', emailErr.message);
    throw emailErr;
  }
}

// =========================================================
// 👥 E-MAIL DE CONVITE PARA TIME
// =========================================================
export async function enviarEmailConviteTime({ email, nomeQuemConvidou, linkAceite }) {
  const quem = escaparHtml(nomeQuemConvidou || 'Um administrador');
  const corpoHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
      <h2 style="margin-bottom: 4px;">Você foi convidado para um time no TranscreveAI</h2>
      <p><strong>${quem}</strong> convidou você para participar do time dele no TranscreveAI.</p>
      <p>Ao aceitar, os administradores do time poderão ver as reuniões que você registrar no TranscreveAI.</p>
      <p style="text-align: center; margin: 32px 0;"><a href="${linkAceite}" style="background-color: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-weight: bold; display: inline-block;">Ver convite</a></p>
      <p style="font-size: 13px; color: #555;">Se você ainda não tem conta, crie uma com este mesmo e-mail e depois abra o link novamente. O convite expira em 7 dias.</p>
      <p style="font-size: 12px; color: #777;">Se você não esperava este convite, pode ignorar este e-mail.</p>
    </div>
  `;

  const { error } = await resend.emails.send({
    from: FROM_EMAIL,
    to: email,
    subject: 'Convite para um time no TranscreveAI',
    html: corpoHtml,
  });
  if (error) {
    console.error('Erro ao enviar convite de time via Resend:', error);
    throw new Error('Falha ao enviar convite');
  }
}