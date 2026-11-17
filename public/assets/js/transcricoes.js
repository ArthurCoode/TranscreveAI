    // ============================================
    // TRANSCRIÇÕES E INSIGHTS
    // ============================================

    // ---- Estado de paginação ----
    const TRANSCRIPTS_PAGE_SIZE = 8;
    let transcriptCurrentPage = 1;
    let transcriptsFiltrados = null; // null = usa `transcripts` direto (sem busca ativa)

    async function carregarTranscricoes() {
      try {
        const json = await api('/api/transcricoes');

        transcripts = json.data || [];
        transcriptsFiltrados = null;
        transcriptCurrentPage = 1;

        renderTranscripts();
        renderInsights();
        atualizarGraficos();
        atualizarInsightsDashboard();
      } catch (err) {
        console.error(err);

        showToast('Erro ao carregar transcrições');
      }
    }

    function templateTranscriptItem(t) {
      return `
        <div class="transcript-item" onclick="abrirTranscricao('${escHtml(t.id)}')">
          <div>
            <strong>${escHtml(t.nome || 'Sem título')}</strong><br>
            <small>${formatarBrasil(t.criado_em)} · ${t.total_palavras || 0} palavras</small>
          </div>
          <button onclick="event.stopPropagation(); abrirTranscricao('${t.id}')" style="background:none;border:none;cursor:pointer;color:#5B3B8C;">
            <i class="fas fa-eye"></i>
          </button>
        </div>
      `;
    }

    // Renderiza a lista de transcrições já paginada.
    // `lista` é opcional — por padrão usa a busca ativa (transcriptsFiltrados)
    // ou todas as transcrições.
    function renderTranscripts(lista, pagina) {
      const list = document.getElementById('transcriptsList');

      if (!list) return;

      const fonte = lista !== undefined ? lista : (transcriptsFiltrados !== null ? transcriptsFiltrados : transcripts);

      if (pagina !== undefined) transcriptCurrentPage = pagina;

      const totalPaginas = Math.max(1, Math.ceil(fonte.length / TRANSCRIPTS_PAGE_SIZE));
      if (transcriptCurrentPage > totalPaginas) transcriptCurrentPage = totalPaginas;
      if (transcriptCurrentPage < 1) transcriptCurrentPage = 1;

      const inicio = (transcriptCurrentPage - 1) * TRANSCRIPTS_PAGE_SIZE;
      const pageItems = fonte.slice(inicio, inicio + TRANSCRIPTS_PAGE_SIZE);

      list.innerHTML = pageItems.length
        ? pageItems.map(templateTranscriptItem).join('')
        : '<p style="color:#9ca3af;padding:1rem;">Nenhuma transcrição encontrada.</p>';

      renderPaginacaoTranscricoes(fonte.length, totalPaginas);
    }

    // Reaproveita as classes já existentes no dashboard.css:
    // .meeting-pagination (container), .page-btn (setas quadradas),
    // .page-btn.number (botões numerados), .page-ellipsis, .page-info
    function renderPaginacaoTranscricoes(totalItens, totalPaginas) {
      const el = document.getElementById('transcriptsPagination');
      if (!el) return;

      el.classList.add('meeting-pagination');

      if (totalItens === 0) {
        el.innerHTML = '';
        return;
      }

      const pagina = transcriptCurrentPage;

      // Gera lista de páginas a exibir com reticências para listas longas
      const paginasVisiveis = [];
      const janela = 1;

      for (let p = 1; p <= totalPaginas; p++) {
        if (p === 1 || p === totalPaginas || (p >= pagina - janela && p <= pagina + janela)) {
          paginasVisiveis.push(p);
        } else if (paginasVisiveis[paginasVisiveis.length - 1] !== '...') {
          paginasVisiveis.push('...');
        }
      }

      const inicioItem = (pagina - 1) * TRANSCRIPTS_PAGE_SIZE + 1;
      const fimItem = Math.min(pagina * TRANSCRIPTS_PAGE_SIZE, totalItens);

      const botoesPaginas = paginasVisiveis.map(p =>
        p === '...'
          ? `<span class="page-ellipsis">…</span>`
          : `<button type="button" class="page-btn number ${p === pagina ? 'active' : ''}" data-page="${p}">${p}</button>`
      ).join('');

      el.innerHTML = `
        <span class="page-info">${inicioItem}–${fimItem} de ${totalItens}</span>
        <button type="button" class="page-btn" id="transcriptPrevPage" ${pagina === 1 ? 'disabled' : ''}>
          <i class="fas fa-chevron-left"></i>
        </button>
        ${botoesPaginas}
        <button type="button" class="page-btn" id="transcriptNextPage" ${pagina === totalPaginas ? 'disabled' : ''}>
          <i class="fas fa-chevron-right"></i>
        </button>
      `;

      el.querySelectorAll('button[data-page]').forEach(btn => {
        btn.onclick = () => renderTranscripts(undefined, parseInt(btn.dataset.page, 10));
      });

      const prevBtn = document.getElementById('transcriptPrevPage');
      const nextBtn = document.getElementById('transcriptNextPage');

      if (prevBtn) prevBtn.onclick = () => renderTranscripts(undefined, transcriptCurrentPage - 1);
      if (nextBtn) nextBtn.onclick = () => renderTranscripts(undefined, transcriptCurrentPage + 1);
    }

    // ------------------------------------------------------------------
    // Formatação do resumo: detecta os tópicos e monta um cartão
    // (.summary-section) por tópico, com ícone próprio, parágrafos e
    // bullets — em vez de jogar o texto cru na tela.
    //
    // Suporta três formatos que a Groq pode devolver:
    //   1) **Título** seguido de conteúdo
    //   2) Um dos 5 headers fixos do prompt (VISÃO GERAL, PRINCIPAIS TÓPICOS
    //      DISCUTIDOS, VALORES E CONDIÇÕES COMERCIAIS, DECISÕES TOMADAS,
    //      PRÓXIMOS PASSOS) — reconhecido mesmo se vier em Title Case,
    //      lowercase ou sem acento, já que o modelo 8B nem sempre respeita
    //      a instrução de maiúsculas à risca.
    //   3) Qualquer outra linha curta em CAIXA ALTA (fallback genérico
    //      para formatos antigos/imprevistos)
    // Se nada for detectado, o texto inteiro vira um único bloco "Resumo".
    // ------------------------------------------------------------------

    const ICONES_TOPICO = [
      { match: /resumo\s*geral|vis(a|ã)o\s*geral|overview/i, icon: 'fa-circle-info', cor: '#5B3B8C' },
      { match: /decis(a|õ)es|decis(ã|a)o/i, icon: 'fa-gavel', cor: '#b45309' },
      { match: /a(c|ç)(a|õ)es|pr(o|ó)ximos\s*passos|next\s*steps|tarefas/i, icon: 'fa-list-check', cor: '#15803d' },
      { match: /participantes|presentes/i, icon: 'fa-users', cor: '#0e7490' },
      { match: /valores?|condi(c|ç)(o|õ)es\s*comerciais|pre(c|ç)os?|or(c|ç)amento/i, icon: 'fa-sack-dollar', cor: '#047857' },
      { match: /pontos?\s*de\s*aten(c|ç)(a|ã)o|riscos?|alertas?/i, icon: 'fa-triangle-exclamation', cor: '#b91c1c' },
      { match: /pauta|t(o|ó)picos?\s*discutidos|assuntos/i, icon: 'fa-list-ul', cor: '#7c3aed' },
    ];

    function iconeParaTopico(titulo = '') {
      const achou = ICONES_TOPICO.find(i => i.match.test(titulo));
      return achou || { icon: 'fa-square', cor: '#5B3B8C' };
    }

    // converte "#rrggbb" em "rgba(r,g,b,.14)" para o fundo do ícone
    function corFundoSuave(hex, alpha = 0.14) {
      const h = hex.replace('#', '');
      const r = parseInt(h.substring(0, 2), 16);
      const g = parseInt(h.substring(2, 4), 16);
      const b = parseInt(h.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    // Lista fixa das seções que o backend (pages/api/resumo.js) sempre pede
    // no prompt. Usada para reconhecer cabeçalhos mesmo que o modelo devolva
    // em Title Case, lowercase, ou sem acento.
    const SECOES_CONHECIDAS = [
      'VISÃO GERAL',
      'PRINCIPAIS TÓPICOS DISCUTIDOS',
      'VALORES E CONDIÇÕES COMERCIAIS',
      'DECISÕES TOMADAS',
      'PRÓXIMOS PASSOS'
    ];

    function normalizarTitulo(str) {
      return str
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[^a-zA-Z ]/g, '')
        .trim()
        .toUpperCase();
    }

    const SECOES_NORMALIZADAS = SECOES_CONHECIDAS.map(normalizarTitulo);

    // ------------------------------------------------------------------
    // Extrai os blocos [titulo, conteudo] do texto do resumo.
    // ------------------------------------------------------------------
    function extrairBlocosResumo(texto) {
      // 1) Formato **Título**
      const porAsteriscos = texto.split(/\*\*(.*?)\*\*/).filter(Boolean);
      if (porAsteriscos.length > 1) {
        const blocos = [];
        for (let i = 0; i < porAsteriscos.length; i += 2) {
          const titulo = (porAsteriscos[i] || '').trim();
          const conteudo = porAsteriscos[i + 1] || '';
          if (titulo) blocos.push([titulo, conteudo]);
        }
        if (blocos.length) return blocos;
      }

      // 2) Cabeçalhos: reconhece tanto os 5 headers fixos conhecidos
      // quanto outras linhas genéricas em CAIXA ALTA (fallback)
      const linhas = texto.split('\n').map(l => l.trim()).filter(Boolean);

      const ehCabecalhoConhecido = (linha) => SECOES_NORMALIZADAS.includes(normalizarTitulo(linha));

      const ehCabecalhoGenerico = (linha) => {
        if (/^[*\-•]/.test(linha)) return false; // é bullet, não título
        const letras = linha.replace(/[^A-Za-zÀ-ÖØ-öø-ÿ]/g, '');
        if (letras.length < 3 || linha.length > 60) return false;
        const maiusculas = linha.replace(/[^A-ZÀ-Ö]/g, '');
        return maiusculas.length === letras.length; // só tem maiúsculas
      };

      const ehCabecalho = (linha) => ehCabecalhoConhecido(linha) || ehCabecalhoGenerico(linha);

      if (linhas.some(ehCabecalho)) {
        const blocos = [];
        let atual = null;

        linhas.forEach(linha => {
          if (ehCabecalho(linha)) {
            atual = [linha, []];
            blocos.push(atual);
          } else if (atual) {
            atual[1].push(linha);
          } else {
            // texto solto antes do primeiro cabeçalho
            atual = ['Resumo', [linha]];
            blocos.push(atual);
          }
        });

        return blocos.map(([titulo, arr]) => [titulo, arr.join('\n')]);
      }

      // 3) Fallback: nenhum cabeçalho detectado, texto inteiro em um bloco
      return [['Resumo', texto]];
    }

    // ------------------------------------------------------------------
    // Renderiza o resumo em texto simples e direto — sem letra capitular,
    // sem bullets numerados em círculo, sem gradientes. Cada seção vira
    // um bloco com barrinha lateral colorida, título discreto e conteúdo
    // em texto corrido ou lista simples.
    // ------------------------------------------------------------------
    function formatarResumo(texto = '') {
      if (!texto || !texto.trim()) {
        return '<div class="summary-empty"><i class="fas fa-inbox"></i><p>Sem resumo disponível</p></div>';
      }

      // escapa antes de montar o HTML — o resumo vem da IA e do banco
      const blocos = extrairBlocosResumo(escHtml(texto));

      return `<div class="summary-container">${blocos.map(([titulo, conteudo]) => {
        const linhas = conteudo.trim().split('\n').map(l => l.trim()).filter(Boolean);

        const bullets = linhas.filter(l => /^[*\-•]/.test(l));
        const paragrafos = linhas.filter(l => !/^[*\-•]/.test(l));

        const { icon, cor } = iconeParaTopico(titulo);

        return `
          <div class="summary-section" style="--topic-color:${cor};">
            <h3><i class="fas ${icon}"></i> ${titulo}</h3>
            ${paragrafos.length ? `<div class="summary-text">${paragrafos.join('<br>')}</div>` : ''}
            ${
              bullets.length
                ? `<ul class="summary-list">${bullets.map(l => `<li>${l.replace(/^[*\-•]\s?/, '')}</li>`).join('')}</ul>`
                : ''
            }
          </div>
        `;
      }).join('')}</div>`;
    }

    // ------------------------------------------------------------------
    // BARRA DE METADADOS (sentimento, tipo, intenção de compra, urgência,
    // risco de cancelamento, cliente, participantes, temas)
    // ------------------------------------------------------------------

    const SENTIMENTO_INFO = {
      positivo: { icon: 'fa-face-smile', label: 'Positivo', cor: '#10b981' },
      neutro:   { icon: 'fa-face-meh',   label: 'Neutro',   cor: '#6b7280' },
      negativo: { icon: 'fa-face-frown', label: 'Negativo', cor: '#ef4444' },
    };

    const NIVEL_INFO = {
      alta:  { label: 'Alta',  cor: '#ef4444' },
      media: { label: 'Média', cor: '#f59e0b' },
      baixa: { label: 'Baixa', cor: '#10b981' },
    };

    const TIPO_REUNIAO_INFO = {
      venda:       { icon: 'fa-handshake',       label: 'Venda' },
      suporte:     { icon: 'fa-headset',         label: 'Suporte' },
      alinhamento: { icon: 'fa-people-arrows',   label: 'Alinhamento' },
      interno:     { icon: 'fa-building',        label: 'Interno' },
      negociacao:  { icon: 'fa-comments-dollar', label: 'Negociação' },
      outro:       { icon: 'fa-circle-question', label: 'Outro' },
    };

    function badgeHTML({ icon, label, cor, destaque }) {
      const corTexto = cor || '#5B3B8C';
      const corFundo = corFundoSuave(corTexto);
      return `
        <span class="meta-badge ${destaque ? 'meta-badge-alert' : ''}" style="--badge-color:${corTexto}; --badge-bg:${corFundo};">
          ${icon ? `<i class="fas ${icon}"></i>` : ''}${escHtml(label)}
        </span>
      `;
    }

    function formatarMetadadosBar(m) {
      if (!m) return '';

      const badges = [];

      if (m.tipo_reuniao && TIPO_REUNIAO_INFO[m.tipo_reuniao]) {
        const t = TIPO_REUNIAO_INFO[m.tipo_reuniao];
        badges.push(badgeHTML({ icon: t.icon, label: t.label }));
      }

      if (m.sentimento && SENTIMENTO_INFO[m.sentimento]) {
        const s = SENTIMENTO_INFO[m.sentimento];
        badges.push(badgeHTML({ icon: s.icon, label: s.label, cor: s.cor }));
      }

      if (m.intencao_compra && NIVEL_INFO[m.intencao_compra]) {
        const n = NIVEL_INFO[m.intencao_compra];
        badges.push(badgeHTML({ icon: 'fa-cart-shopping', label: `Compra: ${n.label}`, cor: n.cor }));
      }

      if (m.nivel_urgencia && NIVEL_INFO[m.nivel_urgencia]) {
        const n = NIVEL_INFO[m.nivel_urgencia];
        badges.push(badgeHTML({ icon: 'fa-stopwatch', label: `Urgência: ${n.label}`, cor: n.cor }));
      }

      if (m.tem_risco_cancelamento) {
        badges.push(badgeHTML({ icon: 'fa-triangle-exclamation', label: 'Risco de cancelamento', cor: '#ef4444', destaque: true }));
      }

      if (m.tem_reclamacao) {
        badges.push(badgeHTML({ icon: 'fa-circle-exclamation', label: 'Reclamação', cor: '#f59e0b' }));
      }

      if (m.cliente_mencionado) {
        badges.push(badgeHTML({ icon: 'fa-building-user', label: m.cliente_mencionado }));
      }

      if (Array.isArray(m.participantes) && m.participantes.length) {
        badges.push(badgeHTML({ icon: 'fa-users', label: m.participantes.join(', ') }));
      }

      if (!badges.length) return '';

      const temas = (Array.isArray(m.temas) && m.temas.length)
        ? `<div class="meta-temas-row">${m.temas.map(t => `<span class="meta-tema-chip">#${escHtml(t)}</span>`).join('')}</div>`
        : '';

      return `<div class="meta-badges-bar">${badges.join('')}</div>${temas}`;
    }

    // ------------------------------------------------------------------
    // Insights: cada card ganha ícone/cor conforme o prefixo
    // (Oportunidade, Risco, Alerta, Objeção, Intenção de compra,
    // Melhoria, Valor comercial), extraído em texto simples.
    // ------------------------------------------------------------------

    const INSIGHT_PREFIXOS = [
      { chave: 'oportunidade',       icon: 'fa-arrow-trend-up',       cor: '#10b981' },
      { chave: 'risco',              icon: 'fa-triangle-exclamation', cor: '#ef4444' },
      { chave: 'alerta',             icon: 'fa-bell',                 cor: '#f59e0b' },
      { chave: 'objecao',            icon: 'fa-hand',                 cor: '#ef4444' },
      { chave: 'intencao de compra', icon: 'fa-cart-shopping',        cor: '#5B3B8C' },
      { chave: 'melhoria',           icon: 'fa-wrench',               cor: '#3b82f6' },
      { chave: 'valor comercial',    icon: 'fa-sack-dollar',          cor: '#15803d' },
    ];

    function normalizarChave(str) {
      return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    function estiloInsight(texto = '') {
      const m = texto.match(/^([^:]{2,30}):\s*/);
      if (!m) return { icon: 'fa-lightbulb', cor: '#f59e0b', label: null, corpo: texto };

      const chaveNorm = normalizarChave(m[1].trim());
      const achou = INSIGHT_PREFIXOS.find(p => normalizarChave(p.chave) === chaveNorm);

      return {
        icon: achou ? achou.icon : 'fa-lightbulb',
        cor: achou ? achou.cor : '#f59e0b',
        label: m[1].trim(),
        corpo: texto.slice(m[0].length),
      };
    }

    function formatarInsights(insights = []) {
      if (!insights || !insights.length) {
        return '<div class="summary-empty"><i class="fas fa-lightbulb"></i><p>Nenhum insight foi gerado para esta reunião.</p></div>';
      }

      return `
        <div class="insights-grid">
          ${insights.map(i => {
            const { icon, cor, label, corpo } = estiloInsight(escHtml(i));
            const fundo = corFundoSuave(cor);
            return `
              <div class="insight-card" style="--topic-color:${cor}; --topic-color-bg:${fundo};">
                <span class="insight-card-icon"><i class="fas ${icon}"></i></span>
                <div>
                  ${label ? `<span class="insight-card-label">${label}</span>` : ''}
                  <p>${corpo}</p>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    // ------------------------------------------------------------------
    // EDIÇÃO DE TÍTULO (inline, dentro do modal de transcrição)
    // ------------------------------------------------------------------
    function iniciarEdicaoTitulo(modal) {
      const span = modal.querySelector('#transcricaoTituloTexto');
      const input = modal.querySelector('#transcricaoTituloInput');
      const btnEditar = modal.querySelector('#btnEditarTitulo');
      const btnSalvar = modal.querySelector('#btnSalvarTitulo');
      const btnCancelar = modal.querySelector('#btnCancelarTitulo');

      span.style.display = 'none';
      btnEditar.style.display = 'none';
      input.style.display = 'inline-block';
      input.value = span.textContent.trim();
      btnSalvar.style.display = 'inline-flex';
      btnCancelar.style.display = 'inline-flex';
      input.focus();
      input.select();
    }

    function cancelarEdicaoTitulo(modal) {
      const span = modal.querySelector('#transcricaoTituloTexto');
      const input = modal.querySelector('#transcricaoTituloInput');
      const btnEditar = modal.querySelector('#btnEditarTitulo');
      const btnSalvar = modal.querySelector('#btnSalvarTitulo');
      const btnCancelar = modal.querySelector('#btnCancelarTitulo');

      span.style.display = 'inline';
      btnEditar.style.display = 'inline-flex';
      input.style.display = 'none';
      btnSalvar.style.display = 'none';
      btnCancelar.style.display = 'none';
    }

    async function salvarTituloTranscricao(modal, dados) {
      const input = modal.querySelector('#transcricaoTituloInput');
      const novoTitulo = input.value.trim();

      if (!novoTitulo) {
        showToast('O título não pode ficar vazio');
        return;
      }

      if (novoTitulo === (dados.nome || '').trim()) {
        cancelarEdicaoTitulo(modal);
        return;
      }

      const btnSalvar = modal.querySelector('#btnSalvarTitulo');
      const textoOriginal = btnSalvar.innerHTML;

      try {
        btnSalvar.disabled = true;
        btnSalvar.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        const json = await api(`/api/transcricoes/${dados.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ nome: novoTitulo })
        });

        dados.nome = json.data?.nome || novoTitulo;

        modal.querySelector('#transcricaoTituloTexto').textContent = dados.nome;

        // sincroniza com a lista/estado local sem precisar recarregar tudo
        const item = transcripts.find(t => t.id === dados.id);
        if (item) item.nome = dados.nome;

        renderTranscripts();
        renderInsights();
        if (typeof renderMeetings === 'function') renderMeetings();

        cancelarEdicaoTitulo(modal);
        showToast('Título atualizado');
      } catch (err) {
        console.error(err);
        showToast('Erro ao atualizar título');
      } finally {
        btnSalvar.disabled = false;
        btnSalvar.innerHTML = textoOriginal;
      }
    }

    // ------------------------------------------------------------------
    // DOWNLOAD EM PDF (via window.print(), sem lib externa)
    //
    // [correção 3] As duas tentativas anteriores com html2pdf/html2canvas
    // resultavam em PDF em branco: o html2canvas clona a página inteira
    // num iframe invisível para "fotografar" o DOM, e nesse clone os
    // elementos com position:fixed nem sempre são posicionados/pintados
    // corretamente — o canvas final saía vazio mesmo sem erro no console.
    //
    // Trocado por uma abordagem sem dependência de canvas: abrir uma
    // janela nova só com o HTML do relatório (mesmo template usado antes)
    // e deixar o próprio motor de impressão do navegador renderizar e
    // gerar o PDF via window.print() — é o mesmo caminho usado por Gmail,
    // bancos etc. O usuário escolhe "Salvar como PDF" no diálogo de
    // impressão (opção padrão no Chrome/Edge/Firefox).
    // ------------------------------------------------------------------

    function montarHtmlRelatorioTranscricao(dados) {
      return `
        <div class="doc">
          <div class="doc-header">
            <div class="doc-brand">TranscreveAI</div>
            <h1>${escHtml(dados.nome || 'Transcrição')}</h1>
            <div class="doc-meta">${formatarBrasil(dados.criado_em)} · ${dados.total_palavras || 0} palavras${dados.duracao ? ' · ' + dados.duracao : ''}</div>
          </div>

          <h2>Resumo</h2>
          ${formatarResumo(dados.resumo)}

          <h2>Insights</h2>
          ${formatarInsights(dados.insights)}

          <h2>Transcrição completa</h2>
          <div class="doc-transcricao">${escHtml(dados.transcricao || 'Sem transcrição').replace(/\n/g, '<br>')}</div>
        </div>
      `;
    }

    // CSS auto-contido para a janela de impressão — não depende do
    // dashboard.css (que pode ter regras de layout/flex incompatíveis
    // com o modo de impressão), só reaproveita as cores/ícones que os
    // templates de resumo/insights já embutem via style inline.
    function montarCssRelatorioTranscricao() {
      return `
        <style>
          @page { margin: 18mm 15mm; }
          * { box-sizing: border-box; }
          body {
            font-family: Arial, Helvetica, sans-serif;
            color: #1f2937;
            margin: 0;
            padding: 24px;
          }
          .doc-header {
            border-bottom: 3px solid #7c3aed;
            padding-bottom: 12px;
            margin-bottom: 20px;
          }
          .doc-brand {
            font-size: 12px;
            font-weight: 700;
            color: #7c3aed;
            text-transform: uppercase;
            letter-spacing: 1px;
          }
          .doc-header h1 { font-size: 20px; margin: 6px 0 4px; }
          .doc-meta { font-size: 12px; color: #6b7280; }
          h2 { font-size: 15px; color: #111827; margin: 24px 0 10px; }
          .doc-transcricao {
            font-size: 11.5px;
            line-height: 1.7;
            white-space: pre-wrap;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 14px;
            page-break-inside: auto;
          }

          /* estilos usados pelos templates gerados por formatarResumo/formatarInsights */
          .summary-section {
            border-left: 3px solid var(--topic-color, #5B3B8C);
            padding: 4px 0 4px 12px;
            margin-bottom: 14px;
            page-break-inside: avoid;
          }
          .summary-section h3 {
            font-size: 13px;
            margin: 0 0 6px;
            color: #111827;
          }
          .summary-section h3 i { color: var(--topic-color, #5B3B8C); margin-right: 6px; }
          .summary-text { font-size: 12px; line-height: 1.6; color: #374151; }
          .summary-list { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: #374151; }
          .summary-empty { color: #9ca3af; font-size: 12px; padding: 8px 0; }

          .insights-grid { display: block; }
          .insight-card {
            border-left: 3px solid var(--topic-color, #f59e0b);
            background: var(--topic-color-bg, #fff7ed);
            border-radius: 6px;
            padding: 10px 12px;
            margin-bottom: 10px;
            font-size: 12px;
            page-break-inside: avoid;
          }
          .insight-card-icon { color: var(--topic-color, #f59e0b); margin-right: 6px; }
          .insight-card-label { font-weight: 700; display: block; margin-bottom: 2px; color: #111827; }

          .meta-badges-bar { display: none; } /* barra de badges não entra no PDF, é só contexto de tela */

          @media print {
            body { padding: 0; }
          }
        </style>
      `;
    }

    // Abre a transcrição formatada em uma nova aba e já dispara o diálogo
    // de impressão do navegador assim que o conteúdo termina de carregar —
    // o usuário escolhe "Salvar como PDF" ali (opção padrão no Chrome/Edge).
    function baixarTranscricaoPDF(dados) {
      const btn = document.getElementById('btnBaixarPdf');
      const textoOriginal = btn?.innerHTML;

      try {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        const janela = window.open('', '_blank', 'width=900,height=1000');

        if (!janela) {
          showToast('Não foi possível abrir a janela de impressão. Verifique o bloqueador de pop-ups.');
          return;
        }

        const nomeArquivo = (dados.nome || 'Transcrição').trim();

        janela.document.open();
        janela.document.write(`
          <!DOCTYPE html>
          <html lang="pt-BR">
          <head>
            <meta charset="UTF-8">
            <title>${escHtml(nomeArquivo)}</title>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
            ${montarCssRelatorioTranscricao()}
          </head>
          <body>
            ${montarHtmlRelatorioTranscricao(dados)}
          </body>
          </html>
        `);
        janela.document.close();

        // Espera o documento (e os ícones via CDN) carregarem antes de
        // chamar print() — senão o diálogo abre com a página ainda em branco.
        const dispararImpressao = () => {
          janela.focus();
          janela.print();
        };

        if (janela.document.readyState === 'complete') {
          // pequeno atraso extra para dar tempo do CSS do font-awesome aplicar
          setTimeout(dispararImpressao, 400);
        } else {
          janela.addEventListener('load', () => setTimeout(dispararImpressao, 400));
        }

        // Fecha a aba sozinha depois que o usuário terminar de imprimir/cancelar
        // (onafterprint só dispara de forma confiável no Chrome/Edge; em outros
        // navegadores a aba simplesmente fica aberta para o usuário fechar).
        janela.addEventListener('afterprint', () => janela.close());

      } catch (err) {
        console.error(err);
        showToast('Erro ao gerar PDF');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = textoOriginal;
        }
      }
    }

    // Pede ao backend uma URL assinada (expira em 1h) e dispara o download
    // do áudio bruto (.webm) da reunião.
    async function baixarAudioTranscricao(dados) {
      const btn = document.getElementById('btnBaixarAudio');
      const textoOriginal = btn?.innerHTML;

      try {
        if (btn) {
          btn.disabled = true;
          btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        }

        const json = await api(`/api/audio/${dados.id}`);

        if (!json?.ok || !json.url) {
          showToast('Não foi possível gerar o link do áudio');
          return;
        }

        // A signed URL é de outro domínio (Supabase Storage), então o atributo
        // "download" do <a> é ignorado pelo navegador nesse caso — ele abre o
        // player nativo em vez de baixar. Por isso baixamos o arquivo via fetch
        // e criamos um blob local: aí sim o "download" funciona (mesma origem).
        const resposta = await fetch(json.url);
        if (!resposta.ok) {
          showToast('Erro ao baixar o arquivo de áudio');
          return;
        }

        const blob = await resposta.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `${(dados.nome || 'reuniao').trim()}.webm`;
        a.click();

        URL.revokeObjectURL(blobUrl);
      } catch (err) {
        console.error(err);
        showToast('Erro ao baixar áudio');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = textoOriginal;
        }
      }
    }

    // ------------------------------------------------------------------
    // Modal de transcrição
    //
    // [alteração] O Theo NÃO faz mais parte deste modal. A partir de agora
    // ele vive só em dois lugares:
    //   1. Aba "Theo" da navbar lateral (theo-global.js) — memória corporativa
    //   2. Widget flutuante de suporte (theo-floating.js) — dúvidas de uso
    //      do sistema, em todas as telas do dashboard.
    // Isso elimina TheoChat.montar()/abrir()/fechar(), o painel lateral
    // #theoPanel, o botão #theoToggleBtn e a lógica de recolher/expandir
    // (alternarTheo). O modal agora só tem as 3 abas: Resumo, Insights,
    // Transcrição — sem o layout de duas colunas que existia por causa
    // do painel do Theo.
    //
    // [alteração] Título agora é editável inline (lápis → input → salvar),
    // e o cabeçalho ganhou um botão de download em PDF.
    // ------------------------------------------------------------------
    async function abrirTranscricao(id) {
      try {
        const json = await api(`/api/transcricoes/${id}`);

        const dados = json.data;

        window.notifications?.add({
          title: "Transcrição aberta",
          message: dados.nome || "Transcrição visualizada",
          icon: "fa-file-alt",
          type: "info"
        });

        const modal = document.createElement('div');

        modal.className = 'transcricao-modal active';

        modal.innerHTML = `
          <div class="transcricao-box" id="transcricaoBox">

            <div class="transcricao-sidebar">
              <button class="tab-btn active" data-tab="resumo"><i class="fas fa-file-lines"></i> Resumo</button>
              <button class="tab-btn" data-tab="insights"><i class="fas fa-lightbulb"></i> Insights</button>
              <button class="tab-btn" data-tab="transcricao"><i class="fas fa-align-left"></i> Transcrição</button>
            </div>

            <div class="transcricao-content">
              <div class="transcricao-header">
                <div class="transcricao-header-info">
                  <h3>
                    <i class="fas fa-file-alt"></i>
                    <span id="transcricaoTituloTexto">${escHtml(dados.nome || 'Transcrição')}</span>
                    <input
                      type="text"
                      id="transcricaoTituloInput"
                      maxlength="200"
                      style="display:none; font-size:1rem; font-weight:600; border:1px solid #d1d5db; border-radius:6px; padding:2px 8px; width:min(320px, 55vw); vertical-align:middle;"
                    >
                    <button id="btnEditarTitulo" title="Editar título" style="background:none; border:none; cursor:pointer; color:#9ca3af; margin-left:4px; vertical-align:middle;">
                      <i class="fas fa-pen"></i>
                    </button>
                    <button id="btnSalvarTitulo" title="Salvar" style="display:none; background:none; border:none; cursor:pointer; color:#10b981; margin-left:4px; vertical-align:middle;">
                      <i class="fas fa-check"></i>
                    </button>
                    <button id="btnCancelarTitulo" title="Cancelar" style="display:none; background:none; border:none; cursor:pointer; color:#ef4444; margin-left:2px; vertical-align:middle;">
                      <i class="fas fa-xmark"></i>
                    </button>
                  </h3>
                  <p class="transcricao-meta"><i class="fas fa-font"></i> ${dados.total_palavras || 0} palavras</p>
                </div>
                <div class="transcricao-header-actions">
                  <button id="btnBaixarPdf" title="Baixar PDF" style="background:#5B3B8C;border:none;border-radius:6px;cursor:pointer;color:#fff;font-size:0.85rem;font-weight:600;padding:7px 14px;margin-right:8px;display:inline-flex;align-items:center;gap:6px;">
                    <i class="fas fa-file-pdf"></i> Baixar PDF
                  </button>
                  ${dados.audio_path ? `
                  <button id="btnBaixarAudio" title="Baixar áudio da reunião" style="background:#0e7490;border:none;border-radius:6px;cursor:pointer;color:#fff;font-size:0.85rem;font-weight:600;padding:7px 14px;margin-right:8px;display:inline-flex;align-items:center;gap:6px;">
                    <i class="fas fa-file-audio"></i> Baixar Áudio
                  </button>
                  ` : ''}
                  <button class="close-modal" title="Fechar">×</button>
                </div>
              </div>

              <div id="resumo" class="tab-content active">
                ${formatarMetadadosBar(dados.metadados)}
                ${formatarResumo(dados.resumo)}
              </div>

              <div id="insights" class="tab-content">
                ${formatarInsights(dados.insights)}
              </div>

              <div id="transcricao" class="tab-content">
                <div class="transcription-box">
                  ${escHtml(dados.transcricao || 'Sem transcrição').replace(/\n/g, '<br>')}
                </div>
              </div>
            </div>

          </div>
        `;

        document.body.appendChild(modal);

        const fecharModal = () => {
          modal.remove();
        };

        modal.querySelector('.close-modal').onclick = fecharModal;

        modal.onclick = e => {
          if (e.target === modal) fecharModal();
        };

        modal.querySelectorAll('.tab-btn').forEach(btn => {
          btn.onclick = () => {
            modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            modal.querySelectorAll('.tab-content').forEach(b => b.classList.remove('active'));

            btn.classList.add('active');
            modal.querySelector('#' + btn.dataset.tab).classList.add('active');
          };
        });

        // --- edição de título ---
        modal.querySelector('#btnEditarTitulo').onclick = () => iniciarEdicaoTitulo(modal);
        modal.querySelector('#btnCancelarTitulo').onclick = () => cancelarEdicaoTitulo(modal);
        modal.querySelector('#btnSalvarTitulo').onclick = () => salvarTituloTranscricao(modal, dados);

        modal.querySelector('#transcricaoTituloInput').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            salvarTituloTranscricao(modal, dados);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            cancelarEdicaoTitulo(modal);
          }
        });

        // --- download em PDF ---
        modal.querySelector('#btnBaixarPdf').onclick = () => baixarTranscricaoPDF(dados);
        const btnAudio = modal.querySelector('#btnBaixarAudio');
        if (btnAudio) btnAudio.onclick = () => baixarAudioTranscricao(dados);

      } catch (err) {
        console.error(err);

        showToast('Erro ao abrir transcrição');
      }
    }

    function renderInsights() {
      const el = document.getElementById('insightsList');

      if (!el) return;

      // achata os insights de todas as reuniões numa lista única, mais recentes primeiro
      const todosInsights = [];

      transcripts.forEach(t => {
        (t.insights || []).forEach(texto => {
          todosInsights.push({ texto, reuniao: t.nome || 'Sem título', data: t.criado_em, id: t.id });
        });
      });

      el.innerHTML = todosInsights.length
        ? todosInsights.map(i => `
            <div class="meeting-item" onclick="abrirTranscricao('${i.id}')" style="cursor:pointer;">
              <div>
                <i class="fas fa-lightbulb" style="color:#f59e0b;margin-right:6px;"></i>
                ${escHtml(i.texto)}<br>
                <small>${escHtml(i.reuniao)} · ${formatarBrasil(i.data)}</small>
              </div>
            </div>
          `).join('')
        : '<p style="color:#9ca3af;padding:1rem;">Nenhum insight ainda.</p>';
    }

    /* Busca em tempo real na lista de transcrições (agora integrada à paginação) */
    document.getElementById('searchTranscript')?.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();

      transcriptsFiltrados = q
        ? transcripts.filter(t =>
            (t.nome || '').toLowerCase().includes(q) ||
            (t.resumo || '').toLowerCase().includes(q)
          )
        : null;

      renderTranscripts(undefined, 1);
    });

    // ============================================
    // TRANSCREVER ÁUDIO (upload)
    // ============================================
    //
    // OBS: ajuste ENDPOINT_UPLOAD_AUDIO para o endpoint real do seu backend
    // caso não seja '/api/transcricoes/upload'. O envio usa XMLHttpRequest
    // (em vez de fetch) para conseguir mostrar o progresso do upload.

    const ENDPOINT_UPLOAD_AUDIO = '/api/transcricoes/upload';

    function getAudioUploadEls() {
      return {
        status: document.getElementById('audioUploadStatus'),
        fill: document.getElementById('audioUploadFill'),
        percent: document.getElementById('audioUploadPercent'),
        fileName: document.getElementById('audioUploadFileName'),
      };
    }

    function setAudioUploadProgress(percent, texto) {
      const { status, fill, percent: percentEl, fileName } = getAudioUploadEls();
      if (!status) return;

      status.style.display = 'block';
      fill.style.width = `${percent}%`;
      percentEl.textContent = `${percent}%`;
      if (texto) fileName.textContent = texto;
    }

    function esconderAudioUploadProgress() {
      const { status } = getAudioUploadEls();
      if (status) status.style.display = 'none';
    }

    async function obterTokenAuth() {
      // Ajuste conforme o cliente Supabase usado no projeto (assets/js/supabaseClient.js)
      try {
        const { data } = await window.supabase.auth.getSession();
        return data?.session?.access_token || null;
      } catch {
        return null;
      }
    }

    async function enviarAudioParaTranscricao(file) {
      const token = await obterTokenAuth();

      const formData = new FormData();
      formData.append('audio', file, file.name);

      setAudioUploadProgress(0, `Enviando: ${file.name}`);

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.open('POST', ENDPOINT_UPLOAD_AUDIO, true);
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            setAudioUploadProgress(percent, `Enviando: ${file.name}`);
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch {
              resolve({});
            }
          } else {
            reject(new Error(`Falha no upload (status ${xhr.status})`));
          }
        };

        xhr.onerror = () => reject(new Error('Erro de rede ao enviar áudio'));

        xhr.send(formData);
      });
    }

    async function handleAudioFileSelecionado(e) {
      const file = e.target.files?.[0];
      if (!file) return;

      const btn = document.getElementById('transcribeAudioBtn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Transcrevendo...';
      }

      try {
        setAudioUploadProgress(0, `Enviando: ${file.name}`);

        const resultado = await enviarAudioParaTranscricao(file);

        setAudioUploadProgress(100, 'Processando transcrição...');

        showToast('Áudio enviado! A transcrição foi iniciada.');

        window.notifications?.add({
          title: 'Transcrição em andamento',
          message: file.name,
          icon: 'fa-microphone-lines',
          type: 'info'
        });

        // Recarrega a lista para já mostrar a nova transcrição (ou o status "processando")
        await carregarTranscricoes();

        // Se o backend já devolver o id pronto, abre direto
        if (resultado?.data?.id) {
          abrirTranscricao(resultado.data.id);
        }
      } catch (err) {
        console.error(err);
        showToast('Erro ao transcrever áudio');
      } finally {
        esconderAudioUploadProgress();

        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-microphone-lines"></i> Transcrever Áudio';
        }

        // limpa o input para permitir selecionar o mesmo arquivo de novo
        e.target.value = '';
      }
    }

    document.getElementById('transcribeAudioBtn')?.addEventListener('click', () => {
      document.getElementById('audioFileInput')?.click();
    });

    document.getElementById('audioFileInput')?.addEventListener('change', handleAudioFileSelecionado);

    window.abrirTranscricao = abrirTranscricao;