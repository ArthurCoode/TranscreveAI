// theo-floating.js
//
// Theo flutuante — assistente de SUPORTE DO SISTEMA, disponível em
// todas as páginas/abas do dashboard (diferente do Theo da navbar,
// que é sobre o conteúdo das reuniões).
//
// Escopo deste Theo:
//   - Tirar dúvidas de uso da plataforma ("como agendo uma reunião?",
//     "onde vejo os insights?", "como convido alguém pro time?")
//   - Receber sugestões/feedback sobre o produto
//   - Encaminhar a conversa por e-mail para o suporte, quando o
//     usuário pedir ("quero falar com o suporte" / botão "Enviar por
//     e-mail")
//
// Autocontido, no mesmo padrão de theo-global.js: injeta seu próprio
// CSS, monta seu próprio HTML (não depende de nada estar no index.html
// além do <script>), e usa o mesmo token de auth do resto do dashboard
// (localStorage 'token').
//
// ------------------------------------------------------------------
// DEPENDÊNCIA DE BACKEND (ainda não implementada — ver observação
// do usuário: "só o frontend por enquanto"):
//
//   POST /api/theo/suporte
//     body: { pergunta, historico }
//     -> resposta de IA focada em ajuda/suporte do sistema (prompt
//        diferente do /api/theo/agente, que é sobre reuniões).
//        Se esse endpoint ainda não existir, o widget cai num
//        fallback local (ver RESPOSTAS_RAPIDAS) e sempre oferece a
//        opção de enviar por e-mail.
//
//   POST /api/theo/suporte-email
//     body: { pergunta, historico, usuario: { nome, email } }
//     -> dispara e-mail via Resend para o endereço de suporte fixo
//        configurado no backend. Deve seguir o mesmo padrão de auth
//        (Authorization: Bearer <token>) usado em /api/team/invite.
// ------------------------------------------------------------------

(function () {
  const ENDPOINT_CHAT = '/api/theo/suporte';
  const ENDPOINT_EMAIL = '/api/theo/suporte-email';
  const MAX_HISTORICO_ENVIADO = 10;

  let wrapperEl = null;
  let bolhaEl = null;
  let painelEl = null;
  let mensagensEl = null;
  let inputEl = null;
  let botaoEnviarEl = null;
  let botaoEmailEl = null;
  let statusEmailEl = null;

  let historico = []; // [{ role: 'user' | 'assistant', content: string }]
  let carregando = false;
  let aberto = false;
  let jaMontado = false;

  function getToken() {
    return (
      localStorage.getItem('token') ||
      localStorage.getItem('tr_token') ||
      localStorage.getItem('authToken') ||
      ''
    );
  }

  function injetarEstilos() {
    if (document.getElementById('theo-floating-styles')) return;
    const style = document.createElement('style');
    style.id = 'theo-floating-styles';
    style.textContent = `
      #theoFloatingWrapper {
        --theof-accent: var(--primary, #2563eb);
        --theof-accent-soft: color-mix(in srgb, var(--theof-accent) 12%, transparent);
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 12px;
        font-family: inherit;
      }

      @media (max-width: 560px) {
        #theoFloatingWrapper { right: 14px; bottom: 14px; }
      }

      /* ---------- BOLHA / BOTÃO FLUTUANTE ---------- */
      .theof-bubble {
        display: flex;
        align-items: center;
        gap: 10px;
        border: none;
        cursor: pointer;
        background: var(--theof-accent);
        color: #fff;
        border-radius: 999px;
        padding: 10px 10px 10px 10px;
        box-shadow: 0 10px 24px -10px rgba(0,0,0,.35);
        transition: transform .15s ease, box-shadow .15s ease;
      }
      .theof-bubble:hover {
        transform: translateY(-2px);
        box-shadow: 0 14px 28px -10px rgba(0,0,0,.4);
      }
      .theof-bubble-avatar {
        position: relative;
        width: 40px;
        height: 40px;
        flex-shrink: 0;
      }
      .theof-bubble-avatar img {
        width: 100%;
        height: 100%;
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid rgba(255,255,255,.85);
        display: block;
      }
      .theof-bubble-avatar::after {
        content: '';
        position: absolute;
        inset: -4px;
        border-radius: 50%;
        border: 2px solid rgba(255,255,255,.55);
        animation: theofPulseRing 2.2s ease-out infinite;
      }
      @keyframes theofPulseRing {
        0% { transform: scale(.92); opacity: .9; }
        70% { transform: scale(1.35); opacity: 0; }
        100% { opacity: 0; }
      }
      .theof-bubble-text {
        font-size: 13px;
        font-weight: 600;
        line-height: 1.25;
        text-align: left;
        max-width: 150px;
        padding-right: 6px;
        white-space: normal;
      }
      .theof-bubble.is-open .theof-bubble-avatar::after { animation: none; display: none; }

      /* some o texto e vira só o círculo quando o painel está aberto */
      .theof-bubble.is-open .theof-bubble-text { display: none; }
      .theof-bubble.is-open { padding: 10px; }

      /* ---------- PAINEL DE CHAT ---------- */
      .theof-panel {
        display: none;
        flex-direction: column;
        width: 340px;
        max-width: calc(100vw - 28px);
        height: 460px;
        max-height: calc(100vh - 120px);
        background: var(--bg-primary, #fff);
        border: 1px solid var(--border, #e2e2e2);
        border-radius: 18px;
        box-shadow: 0 20px 44px -16px rgba(0,0,0,.35);
        overflow: hidden;
      }
      .theof-panel.is-open { display: flex; }

      .theof-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 16px;
        border-bottom: 1px solid var(--border, #eee);
        background: var(--theof-accent-soft);
        flex-shrink: 0;
      }
      .theof-header img {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        object-fit: cover;
        border: 1px solid var(--border, #e5e7eb);
      }
      .theof-header-text h4 {
        margin: 0;
        font-size: 13.5px;
        font-weight: 700;
        color: var(--text-primary, #1a1a1a);
      }
      .theof-header-text p {
        margin: 0;
        font-size: 11px;
        color: var(--text-secondary, #888);
      }
      .theof-close {
        margin-left: auto;
        border: none;
        background: transparent;
        color: var(--text-secondary, #888);
        font-size: 16px;
        cursor: pointer;
        line-height: 1;
        padding: 4px;
      }

      .theof-mensagens {
        flex: 1;
        overflow-y: auto;
        padding: 14px 14px;
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .theof-vazio {
        margin: auto;
        text-align: center;
        color: var(--text-secondary, #999);
        font-size: 12.5px;
        line-height: 1.6;
        padding: 8px 10px;
      }
      .theof-vazio strong { color: var(--text-primary, #333); display: block; margin-bottom: 4px; font-size: 13.5px; }

      .theof-linha { display: flex; align-items: flex-end; gap: 8px; }
      .theof-linha--user { justify-content: flex-end; }
      .theof-avatar {
        width: 22px;
        height: 22px;
        border-radius: 50%;
        object-fit: cover;
        flex-shrink: 0;
      }
      .theof-msg {
        max-width: 80%;
        padding: 9px 12px;
        border-radius: 14px;
        font-size: 12.5px;
        line-height: 1.55;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .theof-msg--assistant {
        background: var(--bg-secondary, #f4f4f6);
        color: var(--text-primary, #1f2937);
        border-bottom-left-radius: 4px;
      }
      .theof-msg--user {
        background: var(--theof-accent);
        color: #fff;
        border-bottom-right-radius: 4px;
      }

      .theof-typing {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 10px 12px;
        background: var(--bg-secondary, #f4f4f6);
        border-radius: 14px;
        border-bottom-left-radius: 4px;
        width: fit-content;
      }
      .theof-typing span {
        width: 5px; height: 5px; border-radius: 50%;
        background: var(--text-secondary, #9ca3af);
        animation: theofTyping 1.4s infinite;
      }
      .theof-typing span:nth-child(2) { animation-delay: .2s; }
      .theof-typing span:nth-child(3) { animation-delay: .4s; }
      @keyframes theofTyping {
        0%, 80%, 100% { transform: translateY(0); opacity: .4; }
        40% { transform: translateY(-3px); opacity: 1; }
      }

      /* ---------- AÇÃO: ENVIAR POR E-MAIL ---------- */
      .theof-email-row {
        padding: 8px 14px;
        border-top: 1px dashed var(--border, #eee);
        flex-shrink: 0;
      }
      .theof-email-btn {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        border: 1px solid var(--border, #ddd);
        background: transparent;
        color: var(--text-secondary, #555);
        border-radius: 10px;
        padding: 7px 10px;
        font-size: 11.5px;
        font-weight: 600;
        cursor: pointer;
        transition: background .15s ease, color .15s ease, border-color .15s ease;
      }
      .theof-email-btn:hover:not(:disabled) {
        background: var(--theof-accent-soft);
        color: var(--theof-accent);
        border-color: var(--theof-accent);
      }
      .theof-email-btn:disabled { opacity: .6; cursor: default; }
      .theof-email-status {
        font-size: 11px;
        text-align: center;
        margin-top: 6px;
        color: var(--text-secondary, #888);
      }
      .theof-email-status.ok { color: #16a34a; }
      .theof-email-status.erro { color: #dc2626; }

      /* ---------- FORM ---------- */
      .theof-form {
        display: flex;
        gap: 8px;
        padding: 10px 14px 14px;
        flex-shrink: 0;
      }
      .theof-form input {
        flex: 1;
        padding: 9px 12px;
        border-radius: 999px;
        border: 1px solid var(--border, #ddd);
        background: var(--bg-primary, #fff);
        color: var(--text-primary, #111);
        font-size: 12.5px;
        outline: none;
      }
      .theof-form input:focus {
        border-color: var(--theof-accent);
        box-shadow: 0 0 0 3px var(--theof-accent-soft);
      }
      .theof-form button {
        border: none;
        border-radius: 999px;
        background: var(--theof-accent);
        color: #fff;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        cursor: pointer;
        font-size: 13px;
      }
      .theof-form button:disabled { opacity: .5; cursor: default; }

      @media (prefers-reduced-motion: reduce) {
        .theof-bubble-avatar::after,
        .theof-typing span { animation: none; }
      }
    `;
    document.head.appendChild(style);
  }

  // ------------------------------------------------------------------
  // Guias passo a passo — cobrem as dúvidas manuais mais comuns da
  // plataforma. Rodam ANTES de chamar o Groq (custo zero, sempre
  // corretos porque o conteúdo é fixo e mantido por vocês). Se a
  // pergunta não bater com nenhum guia, cai pro backend de IA.
  //
  // Pra adicionar um novo guia, só incluir um objeto no array abaixo —
  // não precisa mexer em mais nada.
  // ------------------------------------------------------------------
  const GUIAS_PASSO_A_PASSO = [
    {
      termos: ['transcrever reuniao', 'transcrever ao vivo', 'gravar reuniao', 'transcricao ao vivo', 'reuniao no meet', 'transcrever no meet'],
      titulo: 'Como transcrever uma reunião ao vivo pelo Google Meet',
      passos: [
        'Instale a extensão do TranscreveAI no navegador (veja o guia "Como baixar a extensão").',
        'Acesse o Google Meet e faça login na sua conta.',
        'Clique em "Iniciar" na extensão.',
        'Vá em "Janelas" e selecione a aba do Google Meet.',
        'Marque a opção para compartilhar também o áudio da guia.',
        'Clique em "Compartilhar" — a partir daí, a extensão já está transcrevendo toda a reunião.',
      ],
    },
    {
      termos: ['extensao', 'chrome', 'plugin navegador', 'baixar extensao', 'instalar extensao'],
      titulo: 'Como baixar a extensão do Chrome',
      passos: [
        'Pelo dashboard: vá em "Configurações" > "Integrações" e clique em "Instalar extensão".',
        'Direto pela Chrome Web Store: abra a loja de extensões do Google, busque por "TranscreveAI" e clique em "Usar no Chrome".',
        'Pelo e-mail de redefinição de senha: o e-mail que você recebe para redefinir a senha do dashboard também tem o link da extensão no final.',
      ],
    },
    {
      termos: ['google calendar', 'calendario do google', 'sincronizar agendamento', 'agendamento no calendario'],
      titulo: 'Como agendar uma reunião direto para o Google Calendar',
      passos: [
        'Confirme que seu Google Calendar está conectado em "Configurações" > "Integrações" > "Google Calendar".',
        'Se ainda não estiver, clique em "Conectar" e autorize o acesso com sua conta Google.',
        'Com a conexão ativa, clique em "Novo Agendamento", no canto superior direito.',
        'Preencha todos os dados da reunião (título, data, convidados etc.).',
        'Clique em "Agendar Reunião" — ela é criada automaticamente no seu Google Calendar.',
      ],
    },
    {
      termos: ['agend', 'nova reuni', 'marcar reuni', 'criar reuni'],
      titulo: 'Como agendar uma reunião',
      passos: [
        'Clique em "Novo Agendamento", no canto superior direito do dashboard.',
        'Preencha o título e, se quiser, uma descrição/pauta.',
        'Defina a data e hora de início e término (ou use os botões de duração rápida, tipo "+1 hora").',
        'Se quiser, ative "Criar link do Google Meet" para gerar o link automaticamente.',
        'Adicione os convidados digitando o e-mail e pressionando Enter ou vírgula.',
        'Escolha a plataforma (Zoom, Google Meet ou Teams) e clique em "Agendar Reunião".',
      ],
    },
    {
      termos: ['transcrever audio', 'transcricao de audio', 'upload audio', 'enviar audio', 'subir audio', 'consigo transcrever'],
      titulo: 'Como transcrever um áudio',
      passos: [
        'Vá na aba "Transcrições", na navbar lateral.',
        'Clique no botão "Transcrever Áudio".',
        'Selecione o arquivo de áudio ou vídeo no seu computador.',
        'Acompanhe o progresso do envio na barra que aparece na tela.',
        'Quando o processamento terminar, a transcrição abre automaticamente (ou aparece na lista, se preferir abrir depois).',
      ],
    },
    {
      termos: ['convidar', 'convite', 'adicionar membro', 'novo membro'],
      titulo: 'Como convidar alguém para o time',
      passos: [
        'Vá na aba "Time", na navbar lateral.',
        'Clique no botão "Convidar", no topo da página.',
        'Digite o e-mail da pessoa.',
        'Escolha a permissão: Viewer (só visualiza), Editor ou Admin.',
        'Clique em "Enviar convite" — a pessoa recebe um e-mail para criar o acesso.',
      ],
    },
    {
      termos: ['plano', 'assinatura', 'upgrade', 'mudar plano', 'cancelar plano', 'cancelar assinatura'],
      titulo: 'Como ver ou mudar seu plano',
      passos: [
        'Vá em "Configurações", na navbar lateral.',
        'Na seção "Plano", você vê o plano atual e a descrição dele.',
        'Para trocar de plano, clique em "Mudar plano".',
        'Para cancelar, clique em "Cancelar assinatura" — você mantém o acesso até o fim do período já pago.',
        'Se cancelou por engano, um botão "Desfazer cancelamento" aparece no lugar, até a data de expiração.',
      ],
    },
    {
      termos: ['trocar senha', 'mudar senha', 'alterar senha', 'esqueci senha'],
      titulo: 'Como trocar sua senha',
      passos: [
        'Vá em "Configurações" > "Segurança".',
        'Digite sua senha atual.',
        'Digite a nova senha (mínimo de 8 caracteres) e repita no campo de confirmação.',
        'Clique em "Alterar senha".',
      ],
    },
    {
      termos: ['theo menu lateral', 'theo navbar', 'aba theo', 'agente de ia', 'memoria corporativa', 'como funciona o theo', 'o que o theo faz'],
      titulo: 'Como funciona o Theo na navbar lateral',
      passos: [
        'É um agente de IA com acesso a todas as reuniões já registradas na sua conta.',
        'Ajuda a identificar padrões entre reuniões — temas recorrentes, clientes mencionados, sinais de risco.',
        'Você pode pedir sínteses, como "resuma as últimas reuniões" ou "quais tarefas ficaram pendentes essa semana".',
        'É diferente deste chat aqui (Theo de suporte): aquele é sobre o conteúdo das suas reuniões, este é sobre como usar a plataforma.',
      ],
    },
  ];

  function normalizar(texto) {
    return String(texto).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function encontrarGuia(pergunta) {
    const perguntaNorm = normalizar(pergunta);
    return GUIAS_PASSO_A_PASSO.find((g) => g.termos.some((t) => perguntaNorm.includes(t))) || null;
  }

  function formatarGuia(guia) {
    const linhasPassos = guia.passos.map((p, i) => `${i + 1}. ${p}`).join('\n');
    return `**${guia.titulo}**\n\n${linhasPassos}`;
  }

  function montar() {
    if (jaMontado) return;
    jaMontado = true;

    injetarEstilos();

    wrapperEl = document.createElement('div');
    wrapperEl.id = 'theoFloatingWrapper';
    wrapperEl.innerHTML = `
      <div class="theof-panel" id="theofPanel">
        <div class="theof-header">
          <img src="assets/theo-1.png" alt="Theo">
          <div class="theof-header-text">
            <h4>Theo · Suporte</h4>
            <p>Dúvidas e sugestões sobre o sistema</p>
          </div>
          <button class="theof-close" id="theofClose" title="Fechar"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="theof-mensagens" id="theofMensagens"></div>
        <div class="theof-email-row">
          <button type="button" class="theof-email-btn" id="theofEmailBtn">
            <i class="fas fa-envelope"></i> Enviar essa conversa por e-mail ao suporte
          </button>
          <div class="theof-email-status" id="theofEmailStatus"></div>
        </div>
        <form class="theof-form" id="theofForm">
          <input type="text" id="theofInput" placeholder="Precisa de ajuda? Pergunte aqui..." autocomplete="off" />
          <button type="submit" id="theofEnviar"><i class="fas fa-paper-plane"></i></button>
        </form>
      </div>

      <button type="button" class="theof-bubble" id="theofBubble">
        <span class="theof-bubble-avatar"><img src="assets/theo-1.png" alt="Theo"></span>
        <span class="theof-bubble-text">Precisa de ajuda ou suporte?</span>
      </button>
    `;

    document.body.appendChild(wrapperEl);

    bolhaEl = wrapperEl.querySelector('#theofBubble');
    painelEl = wrapperEl.querySelector('#theofPanel');
    mensagensEl = wrapperEl.querySelector('#theofMensagens');
    inputEl = wrapperEl.querySelector('#theofInput');
    botaoEnviarEl = wrapperEl.querySelector('#theofEnviar');
    botaoEmailEl = wrapperEl.querySelector('#theofEmailBtn');
    statusEmailEl = wrapperEl.querySelector('#theofEmailStatus');

    bolhaEl.addEventListener('click', alternarPainel);
    wrapperEl.querySelector('#theofClose').addEventListener('click', alternarPainel);
    wrapperEl.querySelector('#theofForm').addEventListener('submit', (e) => {
      e.preventDefault();
      processarPergunta();
    });
    botaoEmailEl.addEventListener('click', enviarPorEmail);

    renderizarMensagens();
  }

  function alternarPainel() {
    aberto = !aberto;
    painelEl.classList.toggle('is-open', aberto);
    bolhaEl.classList.toggle('is-open', aberto);
    if (aberto) inputEl.focus();
  }

  function escaparHtml(texto) {
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
  }

  // Escapa primeiro (segurança), depois converte **negrito** — usado no
  // título dos guias passo a passo. As quebras de linha já viram \n
  // reais na string, e o CSS (.theof-msg { white-space: pre-wrap }) cuida
  // de exibi-las como linhas separadas.
  function formatarMsgAssistant(texto) {
    return escaparHtml(texto).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  }

  function renderizarMensagens() {
    if (!mensagensEl) return;

    if (historico.length === 0) {
      mensagensEl.innerHTML = `
        <div class="theof-vazio">
          <strong>Oi, eu sou o Theo 👋</strong>
          Posso te mostrar o passo a passo de várias tarefas (agendar, transcrever, convidar time, plano...), tirar outras dúvidas ou levar sua sugestão direto para o suporte.
        </div>
      `;
      return;
    }

    mensagensEl.innerHTML = historico.map((m) => {
      if (m.role === 'assistant') {
        return `
          <div class="theof-linha">
            <img class="theof-avatar" src="assets/theo-1.png" alt="Theo">
            <div class="theof-msg theof-msg--assistant">${formatarMsgAssistant(m.content)}</div>
          </div>
        `;
      }
      return `
        <div class="theof-linha theof-linha--user">
          <div class="theof-msg theof-msg--user">${escaparHtml(m.content)}</div>
        </div>
      `;
    }).join('');

    if (carregando) {
      mensagensEl.innerHTML += `
        <div class="theof-linha">
          <img class="theof-avatar" src="assets/theo-1.png" alt="Theo">
          <div class="theof-typing"><span></span><span></span><span></span></div>
        </div>
      `;
    }

    mensagensEl.scrollTop = mensagensEl.scrollHeight;
  }

  async function processarPergunta() {
    const pergunta = inputEl.value.trim();
    if (!pergunta || carregando) return;

    historico.push({ role: 'user', content: pergunta });
    inputEl.value = '';
    renderizarMensagens();

    // Camada de guia passo a passo (custo zero) — cobre as dúvidas
    // manuais mais comuns de navegação sem precisar chamar o backend.
    const guia = encontrarGuia(pergunta);
    if (guia) {
      historico.push({ role: 'assistant', content: formatarGuia(guia) });
      renderizarMensagens();
      inputEl.focus();
      return;
    }

    carregando = true;
    botaoEnviarEl.disabled = true;
    renderizarMensagens();

    const token = getToken();

    try {
      const resposta = await fetch(ENDPOINT_CHAT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          pergunta,
          historico: historico.slice(0, -1).slice(-MAX_HISTORICO_ENVIADO),
        }),
      });

      if (!resposta.ok) {
        // Endpoint ainda não existe no backend (404) ou outro erro:
        // não trava o usuário, oferece o caminho do e-mail.
        historico.push({
          role: 'assistant',
          content:
            resposta.status === 404
              ? 'Não encontrei essa resposta pronta. Quer que eu encaminhe sua pergunta por e-mail para o suporte?'
              : 'Não consegui responder agora. Você pode enviar sua dúvida por e-mail usando o botão abaixo.',
        });
      } else {
        const dados = await resposta.json();
        historico.push({ role: 'assistant', content: dados.resposta || 'Não consegui responder agora.' });
      }
    } catch (erro) {
      console.error('Erro ao consultar o Theo (suporte):', erro);
      historico.push({
        role: 'assistant',
        content: 'Erro de conexão. Você pode enviar sua dúvida por e-mail usando o botão abaixo.',
      });
    } finally {
      carregando = false;
      botaoEnviarEl.disabled = false;
      renderizarMensagens();
      inputEl.focus();
    }
  }

  async function enviarPorEmail() {
    if (historico.length === 0) {
      statusEmailEl.textContent = 'Escreva sua dúvida antes de enviar por e-mail.';
      statusEmailEl.className = 'theof-email-status erro';
      return;
    }

    const token = getToken();
    if (!token) {
      statusEmailEl.textContent = 'Sessão expirada — recarregue a página para enviar.';
      statusEmailEl.className = 'theof-email-status erro';
      return;
    }

    botaoEmailEl.disabled = true;
    statusEmailEl.textContent = 'Enviando...';
    statusEmailEl.className = 'theof-email-status';

    try {
      const resposta = await fetch(ENDPOINT_EMAIL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          historico: historico.slice(-MAX_HISTORICO_ENVIADO),
        }),
      });

      if (!resposta.ok) {
        throw new Error('Endpoint de e-mail de suporte ainda não disponível');
      }

      statusEmailEl.textContent = 'Enviado! O suporte vai te responder em breve.';
      statusEmailEl.className = 'theof-email-status ok';
    } catch (erro) {
      console.error('Erro ao enviar e-mail de suporte:', erro);
      statusEmailEl.textContent = 'Não foi possível enviar agora. Tente novamente em instantes.';
      statusEmailEl.className = 'theof-email-status erro';
    } finally {
      botaoEmailEl.disabled = false;
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();