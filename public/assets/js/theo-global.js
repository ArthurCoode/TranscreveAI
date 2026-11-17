    // theo-global.js
    //
    // Chat global do Theo — "memória corporativa". Diferente do TheoChat
    // (theo.js), que responde SOBRE UMA reunião aberta num modal, este
    // componente vive na aba "Theo" do dashboard e conversa com o endpoint
    // /api/theo/agente, que tem acesso a TODAS as reuniões do usuário e
    // decide sozinho quais consultar via tool use.
    //
    // Autocontido de propósito: não depende de theo.js/theo-busca.js/
    // theo-insights.js (aquelas são as camadas 1-2-3 do chat por-reunião).
    // Usa classes CSS próprias (prefixo "theog-") para nunca colidir com o
    // chat do modal, que é montado/desmontado dinamicamente.
    //
    // Autenticação: usa localStorage.getItem('token') — o mesmo token que
    // o resto do dashboard usa (main.js, perfil.js etc.), diferente da
    // extensão Chrome, que guarda em chrome.storage.local separadamente.
    //
    // [redesign] Só o CSS (injetarEstilos) e o HTML estático (montar /
    // estado vazio) mudaram nesta revisão — toda a lógica de fetch,
    // histórico e tratamento de erro permanece intacta.
    //
    // [cota] processarPergunta() agora trata o status 403 retornado quando
    // o usuário atinge o limite de perguntas do ciclo (ver
    // verificar_cota_theo em pages/api/theo/agente.js), mostrando a mensagem
    // de limite em vez do erro genérico.

    (function () {
      const CONTAINER_ID = 'theoGlobalContainer';
      const MAX_HISTORICO_ENVIADO = 10;

      let containerEl = null;
      let mensagensEl = null;
      let inputEl = null;
      let botaoEnviarEl = null;
      let historico = []; // [{ role: 'user' | 'assistant', content: string }]
      let carregando = false;
      let jaMontado = false;

      function injetarEstilos() {
        if (document.getElementById('theo-global-styles')) return;
        const style = document.createElement('style');
        style.id = 'theo-global-styles';
        style.textContent = `
          #theoGlobalContainer {
            --theog-accent: var(--primary, #2563eb);
            --theog-accent-soft: color-mix(in srgb, var(--theog-accent) 12%, transparent);
            --theog-accent-softer: color-mix(in srgb, var(--theog-accent) 6%, transparent);
            --theog-surface: color-mix(in srgb, var(--bg-primary, #fff) 100%, transparent);
            --theog-card: var(--bg-secondary, #f4f4f6);
            --theog-radius-lg: 22px;
            --theog-radius-md: 14px;
            --theog-shadow: 0 1px 2px rgba(15, 15, 20, 0.04), 0 12px 28px -16px rgba(15, 15, 20, 0.18);
            height: 100%;
          }

          .theog-wrap {
            display: flex;
            flex-direction: column;
            height: calc(100vh - 200px);
            min-height: 520px;
            max-width: 860px;
            margin: 0 auto;
            border: 1px solid var(--border, #e2e2e2);
            border-radius: var(--theog-radius-lg);
            background: var(--theog-surface);
            box-shadow: var(--theog-shadow);
            overflow: hidden;
          }

          /* ---------- HEADER ---------- */
          .theog-header {
            position: relative;
            padding: 20px 24px;
            border-bottom: 1px solid var(--border, #eee);
            display: flex;
            align-items: center;
            gap: 14px;
            flex-shrink: 0;
            background:
              radial-gradient(var(--theog-accent-soft) 1px, transparent 1px),
              linear-gradient(180deg, var(--theog-accent-softer), transparent 70%);
            background-size: 16px 16px, 100% 100%;
            background-position: -4px -4px, 0 0;
            overflow: hidden;
          }
          .theog-header::after {
            content: '';
            position: absolute;
            inset: 0;
            background: linear-gradient(90deg, var(--theog-surface) 0%, transparent 18%, transparent 82%, var(--theog-surface) 100%);
            pointer-events: none;
          }
          .theog-avatar-ring {
            position: relative;
            width: 46px;
            height: 46px;
            flex-shrink: 0;
            z-index: 1;
          }
          .theog-avatar-ring img {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            object-fit: cover;
            border: 2px solid var(--theog-surface);
            box-shadow: 0 0 0 2px var(--theog-accent-soft);
            display: block;
          }
          .theog-status-dot {
            position: absolute;
            right: -1px;
            bottom: -1px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #22c55e;
            border: 2px solid var(--theog-surface);
          }
          .theog-status-dot::after {
            content: '';
            position: absolute;
            inset: 0;
            border-radius: 50%;
            background: #22c55e;
            animation: theogPulse 2.2s ease-out infinite;
          }
          @keyframes theogPulse {
            0% { transform: scale(1); opacity: .65; }
            100% { transform: scale(2.4); opacity: 0; }
          }
          .theog-header-text {
            z-index: 1;
            min-width: 0;
          }
          .theog-header-text h3 {
            margin: 0 0 2px 0;
            font-size: 15.5px;
            font-weight: 700;
            color: var(--text-primary, #1a1a1a);
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .theog-header-badge {
            font-size: 10.5px;
            font-weight: 600;
            letter-spacing: .03em;
            text-transform: uppercase;
            color: var(--theog-accent);
            background: var(--theog-accent-soft);
            border-radius: 999px;
            padding: 2px 8px;
          }
          .theog-header-text p {
            margin: 0;
            font-size: 12.5px;
            color: var(--text-secondary, #888);
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          /* ---------- MENSAGENS ---------- */
          .theog-mensagens {
            flex: 1;
            overflow-y: auto;
            padding: 22px 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            scrollbar-width: thin;
            scrollbar-color: var(--border, #ddd) transparent;
          }
          .theog-mensagens::-webkit-scrollbar { width: 8px; }
          .theog-mensagens::-webkit-scrollbar-track { background: transparent; }
          .theog-mensagens::-webkit-scrollbar-thumb {
            background: var(--border, #ddd);
            border-radius: 999px;
          }

          /* ---------- ESTADO VAZIO ---------- */
          .theog-vazio {
            margin: auto;
            text-align: center;
            max-width: 440px;
            padding: 8px 12px;
          }
          .theog-vazio-icon {
            width: 52px;
            height: 52px;
            margin: 0 auto 16px;
            border-radius: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--theog-accent-soft);
            color: var(--theog-accent);
            font-size: 20px;
          }
          .theog-vazio h4 {
            margin: 0 0 6px;
            font-size: 15px;
            font-weight: 700;
            color: var(--text-primary, #1a1a1a);
          }
          .theog-vazio-sub {
            color: var(--text-secondary, #999);
            font-size: 13.5px;
            line-height: 1.6;
            margin: 0;
          }
          .theog-exemplos {
            margin-top: 18px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
            text-align: left;
          }
          @media (max-width: 560px) {
            .theog-exemplos { grid-template-columns: 1fr; }
          }
          .theog-exemplo-btn {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            background: var(--theog-card);
            border: 1px solid var(--border, #e5e7eb);
            color: var(--text-primary, #333);
            border-radius: var(--theog-radius-md);
            padding: 10px 12px;
            font-size: 12.5px;
            line-height: 1.4;
            cursor: pointer;
            text-align: left;
            transition: transform .15s ease, border-color .15s ease, background .15s ease;
          }
          .theog-exemplo-btn i {
            color: var(--theog-accent);
            font-size: 11px;
            margin-top: 2px;
            flex-shrink: 0;
          }
          .theog-exemplo-btn:hover {
            border-color: var(--theog-accent);
            background: var(--theog-accent-soft);
            transform: translateY(-1px);
          }
          .theog-exemplo-btn:focus-visible,
          .theog-form input:focus-visible,
          .theog-form button:focus-visible {
            outline: 2px solid var(--theog-accent);
            outline-offset: 2px;
          }

          /* ---------- LINHAS / BOLHAS ---------- */
          .theog-linha { display: flex; align-items: flex-end; gap: 10px; width: 100%; }
          .theog-linha--user { justify-content: flex-end; }
          .theog-avatar {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            object-fit: cover;
            flex-shrink: 0;
            border: 1px solid var(--border, #e5e7eb);
          }
          .theog-msg {
            max-width: 76%;
            padding: 12px 16px;
            border-radius: 18px;
            font-size: 13.5px;
            line-height: 1.65;
            white-space: pre-wrap;
            word-break: break-word;
          }
          .theog-msg--assistant {
            background: var(--theog-card);
            color: var(--text-primary, #1f2937);
            border: 1px solid var(--border, #eee);
            border-bottom-left-radius: 6px;
          }
          .theog-msg--user {
            background: linear-gradient(135deg, var(--theog-accent), color-mix(in srgb, var(--theog-accent) 78%, #000 8%));
            color: #fff;
            border-bottom-right-radius: 6px;
            box-shadow: 0 6px 16px -8px var(--theog-accent);
          }
          .theog-fontes {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px dashed var(--border, #e5e7eb);
            font-size: 11px;
            color: var(--text-secondary, #999);
          }

          /* ---------- TYPING ---------- */
          .theog-typing {
            display: flex;
            align-items: center;
            gap: 4px;
            padding: 13px 16px;
            background: var(--theog-card);
            border: 1px solid var(--border, #eee);
            border-radius: 18px;
            border-bottom-left-radius: 6px;
            width: fit-content;
          }
          .theog-typing span {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--text-secondary, #9ca3af);
            animation: theogTyping 1.4s infinite;
          }
          .theog-typing span:nth-child(2) { animation-delay: .2s; }
          .theog-typing span:nth-child(3) { animation-delay: .4s; }
          @keyframes theogTyping {
            0%, 80%, 100% { transform: translateY(0); opacity: .4; }
            40% { transform: translateY(-4px); opacity: 1; }
          }

          /* ---------- FORM ---------- */
          .theog-form {
            display: flex;
            gap: 10px;
            padding: 16px 22px;
            border-top: 1px solid var(--border, #eee);
            flex-shrink: 0;
            background: var(--theog-surface);
          }
          .theog-form input {
            flex: 1;
            padding: 12px 16px;
            border-radius: 999px;
            border: 1px solid var(--border, #ddd);
            background: var(--bg-primary, #fff);
            color: var(--text-primary, #111);
            font-size: 13.5px;
            outline: none;
            transition: border-color .15s ease, box-shadow .15s ease;
          }
          .theog-form input:focus {
            border-color: var(--theog-accent);
            box-shadow: 0 0 0 3px var(--theog-accent-soft);
          }
          .theog-form button {
            display: flex;
            align-items: center;
            gap: 7px;
            padding: 0 20px;
            border: none;
            border-radius: 999px;
            background: var(--theog-accent);
            color: #fff;
            font-size: 13.5px;
            font-weight: 600;
            cursor: pointer;
            transition: filter .15s ease, transform .1s ease;
          }
          .theog-form button:hover:not(:disabled) { filter: brightness(1.06); }
          .theog-form button:active:not(:disabled) { transform: scale(.97); }
          .theog-form button:disabled { opacity: .5; cursor: default; }

          .theog-erro {
            font-size: 12px;
            color: var(--danger, #dc2626);
            padding: 8px 22px 0;
            display: flex;
            align-items: center;
            gap: 6px;
          }

          @media (prefers-reduced-motion: reduce) {
            .theog-status-dot::after,
            .theog-typing span { animation: none; }
          }
        `;
        document.head.appendChild(style);
      }

      const PERGUNTAS_EXEMPLO = [
        'Qual cliente reclamou do preço esse mês?',
        'Quais tarefas o João ficou responsável?',
        'Resuma todas as reuniões da última semana.',
        'Algum cliente ameaçou cancelar o contrato?'
      ];

      function montar() {
        containerEl = document.getElementById(CONTAINER_ID);
        if (!containerEl || jaMontado) return;
        jaMontado = true;

        injetarEstilos();

        containerEl.innerHTML = `
          <div class="theog-wrap">
            <div class="theog-header">
              <div class="theog-avatar-ring">
                <img src="assets/theo-1.png" alt="Theo">
                <span class="theog-status-dot" title="Disponível"></span>
              </div>
              <div class="theog-header-text">
                <h3>Theo <span class="theog-header-badge">memória corporativa</span></h3>
                <p>Pergunte sobre qualquer reunião já registrada, de qualquer cliente ou período.</p>
              </div>
            </div>
            <div class="theog-mensagens" id="theog-mensagens"></div>
            <div class="theog-erro" id="theog-erro" style="display:none"></div>
            <form class="theog-form" id="theog-form">
              <input type="text" id="theog-input" placeholder="Ex: quais reuniões falaram sobre contrato?" autocomplete="off" />
              <button type="submit" id="theog-enviar"><i class="fas fa-paper-plane"></i> Enviar</button>
            </form>
          </div>
        `;

        mensagensEl = containerEl.querySelector('#theog-mensagens');
        inputEl = containerEl.querySelector('#theog-input');
        botaoEnviarEl = containerEl.querySelector('#theog-enviar');

        containerEl.querySelector('#theog-form').addEventListener('submit', (e) => {
          e.preventDefault();
          processarPergunta();
        });

        renderizarMensagens();
      }

      function renderizarMensagens() {
        if (!mensagensEl) return;

        if (historico.length === 0) {
          mensagensEl.innerHTML = `
            <div class="theog-vazio">
              <div class="theog-vazio-icon"><i class="fas fa-diagram-project"></i></div>
              <h4>Comece uma conversa com o Theo</h4>
              <p class="theog-vazio-sub">Pergunte algo sobre suas reuniões — decisões, tarefas, clientes, temas, ou peça um resumo de período.</p>
              <div class="theog-exemplos">
                ${PERGUNTAS_EXEMPLO.map((p) => `<button type="button" class="theog-exemplo-btn" data-exemplo="${escaparHtml(p)}"><i class="fas fa-circle-question"></i><span>${escaparHtml(p)}</span></button>`).join('')}
              </div>
            </div>
          `;
          mensagensEl.querySelectorAll('.theog-exemplo-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
              inputEl.value = btn.dataset.exemplo;
              processarPergunta();
            });
          });
          return;
        }

        mensagensEl.innerHTML = historico.map((m) => {
          if (m.role === 'assistant') {
            return `
              <div class="theog-linha">
                <img class="theog-avatar" src="assets/theo-1.png" alt="Theo">
                <div class="theog-msg theog-msg--assistant">${formatarResposta(m.content)}</div>
              </div>
            `;
          }
          return `
            <div class="theog-linha theog-linha--user">
              <div class="theog-msg theog-msg--user">${escaparHtml(m.content)}</div>
            </div>
          `;
        }).join('');

        if (carregando) {
          mensagensEl.innerHTML += `
            <div class="theog-linha">
              <img class="theog-avatar" src="assets/theo-1.png" alt="Theo">
              <div class="theog-typing"><span></span><span></span><span></span></div>
            </div>
          `;
        }

        mensagensEl.scrollTop = mensagensEl.scrollHeight;
      }

      // formata a resposta do agente: escapa HTML primeiro (segurança), depois
      // converte "- item" em bullets visuais simples. Sem markdown pesado —
      // o system prompt do agente não gera markdown, só texto com quebras de linha.
      function formatarResposta(texto) {
        const escapado = escaparHtml(texto);
        return escapado
          .split('\n')
          .map((linha) => {
            const trimmed = linha.trim();
            if (trimmed.startsWith('- ')) {
              return '&nbsp;&nbsp;• ' + trimmed.slice(2);
            }
            return linha;
          })
          .join('\n');
      }

      function escaparHtml(texto) {
        const div = document.createElement('div');
        div.textContent = texto;
        return div.innerHTML;
      }

      function mostrarErro(msg) {
        const el = containerEl.querySelector('#theog-erro');
        if (!el) return;
        el.innerHTML = msg ? `<i class="fas fa-triangle-exclamation"></i> ${escaparHtml(msg)}` : '';
        el.style.display = msg ? 'flex' : 'none';
      }

      async function processarPergunta() {
        const pergunta = inputEl.value.trim();
        if (!pergunta || carregando) return;

        mostrarErro('');
        historico.push({ role: 'user', content: pergunta });
        inputEl.value = '';
        renderizarMensagens();

        const token = localStorage.getItem('token');
        if (!token) {
          historico.push({ role: 'assistant', content: 'Sua sessão expirou. Recarregue a página e faça login novamente.' });
          renderizarMensagens();
          return;
        }

        carregando = true;
        botaoEnviarEl.disabled = true;
        renderizarMensagens();

        try {
          const resposta = await fetch('/api/theo/agente', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + token
            },
            body: JSON.stringify({
              pergunta,
              // manda só role+content, sem metadados de ferramentas, e só as
              // últimas N mensagens — o backend também limita, isso é defesa dupla
              historico: historico.slice(0, -1).slice(-MAX_HISTORICO_ENVIADO)
            })
          });

          const dados = await resposta.json();

          if (!resposta.ok) {
            if (resposta.status === 429) {
              historico.push({ role: 'assistant', content: 'Muitas consultas agora — aguarde alguns segundos e tente de novo.' });
            } else if (resposta.status === 401) {
              historico.push({ role: 'assistant', content: 'Sua sessão expirou. Recarregue a página e faça login novamente.' });
            } else if (resposta.status === 403 && dados && typeof dados.perguntasLimite === 'number') {
              historico.push({
                role: 'assistant',
                content: `Você atingiu o limite de ${dados.perguntasLimite} perguntas ao Theo neste ciclo. Faça upgrade do seu plano para continuar.`
              });
            } else {
              historico.push({ role: 'assistant', content: (dados && dados.erro) || 'Não foi possível obter resposta do Theo agora.' });
            }
          } else {
            historico.push({ role: 'assistant', content: dados.resposta || 'Não foi possível obter resposta do Theo agora.' });
          }
        } catch (erro) {
          console.error('Erro ao consultar o Theo (global):', erro);
          historico.push({ role: 'assistant', content: 'Erro de conexão ao consultar o Theo. Tente novamente.' });
        } finally {
          carregando = false;
          botaoEnviarEl.disabled = false;
          renderizarMensagens();
          inputEl.focus();
        }
      }

      // monta assim que o DOM estiver pronto — o painel já existe no HTML
      // (só fica escondido via CSS .content-panel sem .active), então não
      // precisamos esperar o usuário abrir a aba pra montar a UI.
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', montar);
      } else {
        montar();
      }
    })();