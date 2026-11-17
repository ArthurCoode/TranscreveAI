// theo.js
//
// Módulo completo do Theo para o dashboard do TranscreveAI.
// Orquestra 3 camadas, NESTA ORDEM, parando na primeira que conseguir responder:
//
//   1) TheoInsights  -> lê os insights já extraídos no upload (custo zero)
//   2) TheoBusca     -> busca por palavra-chave na transcrição (custo zero)
//   3) IA via Groq   -> só entra se as duas anteriores não acharem nada
//                        (chama /api/theo/chat — tem custo, ver theo-chat-api)
//
// Script plain JS, sem build step, segue o padrão dos outros módulos
// (estado.js, ui.js, reunioes.js...).
//
// COMO INTEGRAR (já adaptado para o seu transcricoes.js):
//
// 1. Inclua os scripts no HTML do dashboard, NESSA ORDEM, depois dos outros
//    módulos e antes do main.js (você já fez isso):
//      <script src="assets/js/theo-busca.js"></script>
//      <script src="assets/js/theo-insights.js"></script>
//      <script src="assets/js/theo.js"></script>
//
// 2. Como o modal de transcrição é criado dinamicamente (document.createElement)
//    a cada vez que abrirTranscricao() roda, o TheoChat.montar() e o
//    TheoChat.abrir() são chamados DENTRO de abrirTranscricao(), depois que
//    o modal é inserido no DOM — não precisa de inicialização no main.js.
//    Veja o transcricoes.js atualizado para o ponto exato de integração.
//      TheoChat.abrir({
//        id: dados.id,
//        titulo: dados.nome,
//        textoTranscricao: dados.transcricao,
//        resumo: dados.resumo,         // string com seções "**Título**"
//        insightsLista: dados.insights, // array de strings
//      });
//
//    Se `resumo`/`insightsLista` não existirem ainda para aquela reunião,
//    passe `null` — o Theo simplesmente pula a camada 1 e vai pra busca local.

const TheoChat = (() => {
  // Liga/desliga a camada de IA (3). Com false, o Theo nunca gera custo,
  // mas também não responde perguntas de síntese que não estejam nos
  // insights pré-computados.
  const IA_FALLBACK_ATIVADO = true;

  let containerEl = null;
  let mensagensEl = null;
  let inputEl = null;
  let botaoEnviarEl = null;

  let transcricaoAtual = null; // { id, titulo, textoTranscricao, insights }
  let historico = []; // [{ role: 'user' | 'assistant', content: string }]
  let carregando = false;

  function injetarEstilos() {
    if (document.getElementById('theo-chat-styles')) return;
    const style = document.createElement('style');
    style.id = 'theo-chat-styles';
    style.textContent = `
      .theo-chat { display: flex; flex-direction: column; height: 100%; min-height: 360px;
        border: 1px solid #e2e2e2; border-radius: 8px; background: #fff; font-family: inherit; }
      .theo-chat__header { padding: 10px 14px; border-bottom: 1px solid #eee; font-weight: 600;
        font-size: 14px; display: flex; align-items: center; gap: 8px; }
      .theo-chat__header span.status { font-size: 11px; font-weight: 400; color: #888; }
      .theo-chat__mensagens { flex: 1; overflow-y: auto; padding: 12px 14px; display: flex;
        flex-direction: column; gap: 10px; }
        line-height: 1.45; white-space: pre-wrap; }
      .theo-chat__msg--user { align-self: flex-end; background: #2563eb; color: #fff; }
      .theo-chat__msg--assistant { align-self: flex-start; background: #f1f3f5; color: #1a1a1a; }
      .theo-chat__msg--vazio { align-self: center; color: #999; font-size: 13px; padding: 24px 0; }
      .theo-chat__form { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #eee; }
      .theo-chat__form input { flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px;
        font-size: 13.5px; }
      .theo-chat__form button { padding: 8px 14px; border: none; border-radius: 6px; background: #2563eb;
        color: #fff; font-size: 13.5px; cursor: pointer; }
      .theo-chat__form button:disabled { background: #aac1ef; cursor: default; }
      .theo-chat__digitando { align-self: flex-start; color: #999; font-size: 12.5px; font-style: italic; }
      .theo-chat__linha{
        display:flex;
        align-items:flex-start;
        gap:12px;
         width:100%;
      }

      .theo-chat__avatar{
          width:36px;
          height:36px;
          border-radius:50%;
          object-fit:cover;
          flex-shrink:0;
          border:1px solid #e5e7eb;
          background:#fff;
      }

        .theo-chat__msg{
            flex:1;
            max-width:calc(100% - 48px);
            padding:18px;
            border-radius:18px;
            font-size:14px;
            line-height:1.7;
            white-space:normal;
            word-break:break-word;
        }


        .theo-chat__msg--assistant{
            background:#f8fafc;
            color:#1f2937;
        }


      .theo-chat__typing{
          display:flex;
          align-items:center;
          gap:4px;
          padding:12px 14px;
          background:#f3f4f6;
          border-radius:16px;
      }

      .theo-chat__typing span{
          width:6px;
          height:6px;
          border-radius:50%;
          background:#9ca3af;
          animation:theoTyping 1.4s infinite;
      }

      .theo-chat__typing span:nth-child(2){
          animation-delay:.2s;
      }

      .theo-chat__typing span:nth-child(3){
          animation-delay:.4s;
      }

      @keyframes theoTyping{
          0%,80%,100%{
              transform:translateY(0);
              opacity:.4;
          }
          40%{
              transform:translateY(-4px);
              opacity:1;
          }
      }
    `;
    document.head.appendChild(style);
  }

  function montar(elementoContainer) {
    if (!elementoContainer) return;
    injetarEstilos();
    containerEl = elementoContainer;

    containerEl.innerHTML = `
      <div class="theo-chat">
        <div class="theo-chat__header">
        <img src="assets/theo-1.png" class="theo-chat__avatar-header">Theo<span class="status" id="theo-status">nenhuma transcrição aberta</span>
        </div>
        <div class="theo-chat__mensagens" id="theo-mensagens">
          <div class="theo-chat__msg--vazio">Abra uma reunião para conversar com o Theo sobre ela.</div>
        </div>
        <form class="theo-chat__form" id="theo-form">
          <input type="text" id="theo-input" placeholder="Pergunte algo sobre essa reunião..." disabled />
          <button type="submit" id="theo-enviar" disabled>Enviar</button>
        </form>
      </div>
    `;

    mensagensEl = containerEl.querySelector('#theo-mensagens');
    inputEl = containerEl.querySelector('#theo-input');
    botaoEnviarEl = containerEl.querySelector('#theo-enviar');

    containerEl.querySelector('#theo-form').addEventListener('submit', (e) => {
      e.preventDefault();
      processarPergunta();
    });
  }

  function abrir({ id, titulo, textoTranscricao, resumo, insightsLista }) {
    if (!containerEl) {
      console.warn('TheoChat.abrir() chamado antes de TheoChat.montar()');
      return;
    }
    transcricaoAtual = { id, titulo, textoTranscricao, resumo: resumo || null, insightsLista: insightsLista || null };
    historico = [];
    mostrarBoasVindasTheo();

    containerEl.querySelector('#theo-status').textContent = titulo ? `sobre: ${titulo}` : 'transcrição carregada';
    inputEl.disabled = false;
    botaoEnviarEl.disabled = false;
    inputEl.focus();
  }

  function fechar() {
    transcricaoAtual = null;
    historico = [];
    renderizarMensagens();
    if (containerEl) {
      containerEl.querySelector('#theo-status').textContent = 'nenhuma transcrição aberta';
      inputEl.disabled = true;
      botaoEnviarEl.disabled = true;
    }
  }

  function renderizarMensagens() {
    if (!mensagensEl) return;

    if (historico.length === 0) {
      mensagensEl.innerHTML =
        '<div class="theo-chat__msg--vazio">Pergunte sobre a reunião — resumo, decisões, tarefas, riscos, ou um assunto específico.</div>';
      return;
    }

    mensagensEl.innerHTML = historico
      .map((m) => {
        if (m.role === "assistant") {
          return `
            <div class="theo-chat__linha">
              <img class="theo-chat__avatar" src="assets/theo-1.png" alt="Theo">

              <div class="theo-chat__msg theo-chat__msg--assistant">
                ${m.content}
              </div>
            </div>
          `;
        }

        return `
          <div class="theo-chat__msg theo-chat__msg--user">
            ${escaparHtml(m.content)}
          </div>
        `;
      })
      .join('');

    if (carregando) {
        mensagensEl.innerHTML += `
            <div class="theo-chat__linha">
               <img class="theo-chat__avatar" src="assets/theo-1.png" alt="Theo">

                <div class="theo-chat__typing">
                <span></span>
                <span></span>
                <span></span>
                </div>
            </div>
        `;
    }

    mensagensEl.scrollTop = mensagensEl.scrollHeight;
  }

  function mostrarBoasVindasTheo() {
    mensagensEl.innerHTML = `
      <div class="theo-chat__linha">
        <img class="theo-chat__avatar" src="assets/theo-1.png" alt="Theo">

        <div class="theo-chat__typing">
          <span></span>
          <span></span>
          <span></span>
        </div>
      </div>
    `;

    mensagensEl.scrollTop = mensagensEl.scrollHeight;

    setTimeout(() => {
    historico.push({
      role: "assistant",
      content: `
        <div class="theo-chat__welcome">

          <h3>Olá! Eu sou o Theo 👋</h3>

          <p>
            Vou ajudar você a explorar tudo o que foi discutido nesta reunião.
            Basta fazer uma pergunta e encontrarei a resposta rapidamente.
          </p>

          <ul>
            <li>✅ Mostrar decisões tomadas</li>
            <li>📋 Encontrar tarefas e responsáveis</li>
            <li>📅 Localizar datas, prazos e compromissos</li>
            <li>🔍 Buscar qualquer assunto mencionado</li>
          </ul>

          <p class="theo-chat__welcome-footer">
            💬 Digite sua pergunta abaixo para começarmos.
          </p>

        </div>
      `
    });

      renderizarMensagens();
    }, 1800);
  }

  function escaparHtml(texto) {
    const div = document.createElement('div');
    div.textContent = texto;
    return div.innerHTML;
  }

  async function processarPergunta() {
    const pergunta = inputEl.value.trim();
    if (!pergunta || !transcricaoAtual || carregando) return;

    historico.push({ role: 'user', content: pergunta });
    inputEl.value = '';
    renderizarMensagens();

    // --- Camada 1: insights pré-computados (custo zero) ---
    if (typeof TheoInsights !== 'undefined' && (transcricaoAtual.resumo || transcricaoAtual.insightsLista)) {
      const intencao = TheoInsights.detectarIntencao(pergunta);
      if (intencao) {
        const respostaInsight = TheoInsights.responder(
          { resumo: transcricaoAtual.resumo, insightsLista: transcricaoAtual.insightsLista },
          intencao
        );
        if (respostaInsight) {
          historico.push({ role: 'assistant', content: respostaInsight });
          renderizarMensagens();
          inputEl.focus();
          return;
        }
      }
    }

    // --- Camada 2: busca por palavra-chave na transcrição (custo zero) ---
    // Excepção: se a pergunta for de OPINIÃO/JULGAMENTO (detectado por
    // ehPerguntaInterpretativa), a busca literal é ignorada mesmo que ache
    // alguma palavra batendo — esse tipo de pergunta precisa de IA, não de
    // um trecho literal da transcrição.
    let resultadoBusca = null;
    if (typeof TheoBusca !== 'undefined') {
      resultadoBusca = TheoBusca.buscar(transcricaoAtual.textoTranscricao, pergunta);

      if (!resultadoBusca.ehInterpretativa) {
        if (resultadoBusca.encontrouAlgo) {
          historico.push({
            role: 'assistant',
            content: TheoBusca.responder(transcricaoAtual.textoTranscricao, pergunta),
          });
          renderizarMensagens();
          inputEl.focus();
          return;
        }
        // Termo buscável existia, não achou nada, e o fallback de IA está
        // desligado: encerra aqui mesmo, sem custo.
        if (!resultadoBusca.semTermoBuscavel && !IA_FALLBACK_ATIVADO) {
          historico.push({ role: 'assistant', content: 'Não encontrei essa informação na transcrição.' });
          renderizarMensagens();
          inputEl.focus();
          return;
        }
      }
    }

    // --- Camada 3: fallback de IA via Groq (tem custo, só chega aqui se 1 e 2 falharem) ---
    if (!IA_FALLBACK_ATIVADO) {
      historico.push({
        role: 'assistant',
        content:
          'Não consegui responder com os dados já disponíveis (insights ou busca direta) e o fallback de IA está desativado.',
      });
      renderizarMensagens();
      inputEl.focus();
      return;
    }

    carregando = true;
    botaoEnviarEl.disabled = true;
    renderizarMensagens();

    try {
      const tokenTheo = localStorage.getItem('token');
      const resposta = await fetch('/api/theo/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tokenTheo ? { Authorization: 'Bearer ' + tokenTheo } : {})
        },
        body: JSON.stringify({
          // Não envia a transcrição completa — só resumo e insights.
          // Isso mantém o consumo de tokens baixo e evita o erro de TPM
          // do Free Tier do Groq em reuniões longas (ver chat.js).
          insights: { resumo: transcricaoAtual.resumo, insightsLista: transcricaoAtual.insightsLista },
          pergunta,
          historico: historico.slice(0, -1),
        }),
      });

      const dados = await resposta.json();
      historico.push({
        role: 'assistant',
        content: resposta.ok ? dados.resposta : dados.erro || 'Não foi possível obter resposta do Theo agora.',
      });
    } catch (erro) {
      console.error('Erro ao consultar o Theo (fallback IA):', erro);
      historico.push({ role: 'assistant', content: 'Erro de conexão ao consultar o Theo. Tente novamente.' });
    } finally {
      carregando = false;
      botaoEnviarEl.disabled = false;
      renderizarMensagens();
      inputEl.focus();
    }
  }

  return { montar, abrir, fechar };
})();