// assets/js/atividades.js
// Módulo do painel Kanban de Atividades (Pendente / Em andamento / Concluído)
// Fala com /api/atividades.js (JWT via cookie tr_token), não com supabase-js
// direto no browser — mesmo padrão de reunioes.js/transcricoes.js.

(function () {
  let atividades = [];
  let atividadeArrastada = null; // guarda o id durante o drag
  let membros = [];
  let membrosPorId = {};

  const STATUS_TO_COL = {
    pendente: 'colPendente',
    em_andamento: 'colEmAndamento',
    concluido: 'colConcluido',
  };

  const STATUS_TO_COUNT = {
    pendente: 'countPendente',
    em_andamento: 'countEmAndamento',
    concluido: 'countConcluido',
  };

  // ---------- Helper de fetch ----------
  async function apiFetch(url, options = {}) {
    const resp = await fetch(url, {
      ...options,
      credentials: 'same-origin', // envia o cookie tr_token automaticamente
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    const json = await resp.json().catch(() => ({}));

    if (!resp.ok || json.ok === false) {
      throw new Error(json.erro || `Erro na requisição (${resp.status})`);
    }

    return json;
  }

  // ---------- Carregar dados ----------
  async function carregarMembros() {
    try {
      const resp = await fetch('/api/team/members', { credentials: 'same-origin' });
      const data = await resp.json().catch(() => []);
      membros = Array.isArray(data) ? data : [];
      membrosPorId = Object.fromEntries(membros.map((m) => [m.id, m]));
    } catch (err) {
      console.error('Erro ao carregar membros do time:', err);
      membros = [];
      membrosPorId = {};
    }
  }

  async function carregarAtividades() {
    try {
      const { data } = await apiFetch('/api/atividades');
      atividades = data || [];
      renderizarKanban();
    } catch (err) {
      console.error('Erro ao carregar atividades:', err);
    }
  }

  // ---------- Render ----------
  function renderizarKanban() {
    Object.values(STATUS_TO_COL).forEach((colId) => {
      const col = document.getElementById(colId);
      if (col) col.innerHTML = '';
    });

    const contagem = { pendente: 0, em_andamento: 0, concluido: 0 };

    atividades.forEach((atividade) => {
      contagem[atividade.status] = (contagem[atividade.status] || 0) + 1;
      const card = criarCardElement(atividade);
      const col = document.getElementById(STATUS_TO_COL[atividade.status]);
      if (col) col.appendChild(card);
    });

    Object.entries(STATUS_TO_COUNT).forEach(([status, countId]) => {
      const el = document.getElementById(countId);
      if (el) el.textContent = contagem[status] || 0;
    });
  }

  function criarCardElement(atividade) {
    const card = document.createElement('div');
    card.className = 'kanban-card';
    card.draggable = true;
    card.dataset.id = atividade.id;

    const prazoInfo = formatarPrazo(atividade.prazo);
    const responsavel = membrosPorId[atividade.responsavel_id];

    card.innerHTML = `
      <div class="kanban-card-title">${escapeHtml(atividade.titulo)}</div>
      <div class="kanban-card-meta">
        ${atividade.origem === 'auto' ? '<span class="kanban-card-badge-auto">IA</span>' : ''}
        ${responsavel ? `<span><i class="fas fa-user"></i> ${escapeHtml(responsavel.name)}</span>` : ''}
        ${prazoInfo ? `<span class="${prazoInfo.vencido ? 'kanban-card-overdue' : ''}"><i class="fas fa-clock"></i> ${prazoInfo.texto}</span>` : ''}
      </div>
    `;

    card.addEventListener('dragstart', () => {
      atividadeArrastada = atividade.id;
      card.classList.add('dragging');
    });

    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      atividadeArrastada = null;
    });

    card.addEventListener('click', () => {
      abrirModalEdicao(atividade);
    });

    return card;
  }

  function formatarPrazo(prazo) {
    if (!prazo) return null;
    const data = new Date(prazo);
    const agora = new Date();
    const vencido = data < agora;
    const texto = data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    return { texto, vencido };
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }

  // ---------- Drag & Drop nas colunas ----------
  function configurarDragDrop() {
    document.querySelectorAll('.kanban-column').forEach((coluna) => {
      coluna.addEventListener('dragover', (e) => {
        e.preventDefault();
        coluna.classList.add('drag-over');
      });

      coluna.addEventListener('dragleave', () => {
        coluna.classList.remove('drag-over');
      });

      coluna.addEventListener('drop', async (e) => {
        e.preventDefault();
        coluna.classList.remove('drag-over');

        if (!atividadeArrastada) return;

        const novoStatus = coluna.dataset.status;
        await moverStatus(atividadeArrastada, novoStatus);
      });
    });
  }

  async function moverStatus(id, novoStatus) {
    const atividade = atividades.find((a) => a.id === id);
    if (!atividade || atividade.status === novoStatus) return;

    // otimista: atualiza local antes de confirmar na API
    const statusAnterior = atividade.status;
    atividade.status = novoStatus;
    renderizarKanban();

    try {
      await apiFetch(`/api/atividades?id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: novoStatus }),
      });
    } catch (err) {
      console.error('Erro ao mover atividade:', err);
      atividade.status = statusAnterior; // rollback
      renderizarKanban();
      alert('Não foi possível mover a atividade. Tente novamente.');
    }
  }

  // ---------- Criar atividade ----------
  async function criarAtividade({ titulo, descricao, prazo, reuniaoId, transcricaoId, origem, responsavelId }) {
    try {
      const { data } = await apiFetch('/api/atividades', {
        method: 'POST',
        body: JSON.stringify({
          titulo,
          descricao: descricao || null,
          prazo: prazo || null,
          reuniao_id: reuniaoId || null,
          transcricao_id: transcricaoId || null,
          origem: origem || 'manual',
          responsavel_id: responsavelId || null,
        }),
      });

      atividades.unshift(data);
      renderizarKanban();
      return data;
    } catch (err) {
      console.error('Erro ao criar atividade:', err);
      alert('Não foi possível criar a atividade.');
      return null;
    }
  }

  async function editarAtividade(id, { titulo, descricao, prazo, responsavelId }) {
    try {
      const { data } = await apiFetch(`/api/atividades?id=${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ titulo, descricao, prazo, responsavel_id: responsavelId || null }),
      });

      const idx = atividades.findIndex((a) => a.id === id);
      if (idx !== -1) atividades[idx] = data;
      renderizarKanban();
      return data;
    } catch (err) {
      console.error('Erro ao editar atividade:', err);
      alert('Não foi possível salvar as alterações.');
      return null;
    }
  }

  async function excluirAtividade(id) {
    try {
      await apiFetch(`/api/atividades?id=${id}`, { method: 'DELETE' });
      atividades = atividades.filter((a) => a.id !== id);
      renderizarKanban();
    } catch (err) {
      console.error('Erro ao excluir atividade:', err);
      alert('Não foi possível excluir a atividade.');
    }
  }

  // ---------- Lembretes (verificação simples no load) ----------
  // Usa a API real do notifications.js (window.notifications.add) e persiste
  // lembrete_enviado=true via PATCH pra não notificar de novo nos próximos loads.
  async function verificarLembretes() {
    if (!window.notifications) return; // notifications.js ainda não carregou

    const agora = new Date();
    const em24h = new Date(agora.getTime() + 24 * 60 * 60 * 1000);

    const proximasDoVencimento = atividades.filter((a) => {
      if (!a.prazo || a.lembrete_enviado || a.status === 'concluido') return false;
      const prazo = new Date(a.prazo);
      return prazo <= em24h;
    });

    for (const a of proximasDoVencimento) {
      const prazo = new Date(a.prazo);
      const vencida = prazo < agora;

      window.notifications.add({
        title: vencida ? 'Atividade atrasada' : 'Atividade vencendo em breve',
        message: a.titulo,
        icon: vencida ? 'fa-triangle-exclamation' : 'fa-clock',
        type: vencida ? 'warning' : 'info',
      });

      try {
        await apiFetch(`/api/atividades?id=${a.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ lembrete_enviado: true }),
        });
        a.lembrete_enviado = true;
      } catch (err) {
        console.error('Erro ao marcar lembrete_enviado:', err);
      }
    }
  }

  // ---------- Sugestões da IA (origem='auto') ainda não notificadas ----------
  // Roda junto com verificarLembretes no load: agrupa em uma única
  // notificação (em vez de uma por atividade) e marca notificado=true
  // pra não repetir o aviso nos próximos loads.
  async function verificarSugestoesIA() {
    if (!window.notifications) return;

    const novasSugestoes = atividades.filter((a) => a.origem === 'auto' && !a.notificado);
    if (!novasSugestoes.length) return;

    window.notifications.add({
      title: 'Novas atividades sugeridas',
      message: `A IA sugeriu ${novasSugestoes.length} atividade(s) a partir de reuniões recentes. Revise no quadro.`,
      icon: 'fa-wand-magic-sparkles',
      type: 'info',
    });

    for (const a of novasSugestoes) {
      try {
        await apiFetch(`/api/atividades?id=${a.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notificado: true }),
        });
        a.notificado = true;
      } catch (err) {
        console.error('Erro ao marcar notificado:', err);
      }
    }
  }

  // ---------- Modal ----------
  function popularSelectResponsavel(selecionadoId) {
    const select = document.getElementById('atividadeResponsavel');
    select.innerHTML = '<option value="">Eu mesmo</option>';
    membros.forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name || m.email;
      select.appendChild(opt);
    });
    select.value = selecionadoId || '';
  }

  function abrirModalCriacao() {
    const modal = document.getElementById('atividadeModal');
    document.getElementById('atividadeModalTitulo').innerHTML = '<i class="fas fa-list-check"></i> Nova Atividade';
    document.getElementById('atividadeId').value = '';
    document.getElementById('atividadeTitulo').value = '';
    document.getElementById('atividadeDescricao').value = '';
    document.getElementById('atividadePrazo').value = '';
    popularSelectResponsavel('');
    document.getElementById('saveAtividade').innerHTML = '<i class="fas fa-check"></i> Criar Atividade';
    document.getElementById('deleteAtividadeBtn').style.display = 'none';
    modal.classList.add('active');
  }

  function abrirModalEdicao(atividade) {
    const modal = document.getElementById('atividadeModal');
    document.getElementById('atividadeModalTitulo').innerHTML = '<i class="fas fa-list-check"></i> Editar Atividade';
    document.getElementById('atividadeId').value = atividade.id;
    document.getElementById('atividadeTitulo').value = atividade.titulo || '';
    document.getElementById('atividadeDescricao').value = atividade.descricao || '';
    popularSelectResponsavel(atividade.responsavel_id || '');

    // datetime-local espera "YYYY-MM-DDTHH:mm" em horário local
    if (atividade.prazo) {
      const d = new Date(atividade.prazo);
      const pad = (n) => String(n).padStart(2, '0');
      const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      document.getElementById('atividadePrazo').value = local;
    } else {
      document.getElementById('atividadePrazo').value = '';
    }

    document.getElementById('saveAtividade').innerHTML = '<i class="fas fa-check"></i> Salvar alterações';
    document.getElementById('deleteAtividadeBtn').style.display = 'inline-flex';
    modal.classList.add('active');
  }

  function configurarModal() {
    const modal = document.getElementById('atividadeModal');
    const btnAbrir = document.getElementById('novaAtividadeBtn');
    const btnCancelar = document.getElementById('cancelAtividadeModal');
    const btnSalvar = document.getElementById('saveAtividade');
    const btnExcluir = document.getElementById('deleteAtividadeBtn');

    if (!modal || !btnAbrir) return;

    btnAbrir.addEventListener('click', abrirModalCriacao);

    btnCancelar.addEventListener('click', () => {
      modal.classList.remove('active');
    });

    btnExcluir.addEventListener('click', async () => {
      const id = document.getElementById('atividadeId').value;
      const titulo = document.getElementById('atividadeTitulo').value.trim();
      if (!id) return;

      if (confirm(`Excluir atividade "${titulo}"?`)) {
        await excluirAtividade(id);
        modal.classList.remove('active');
      }
    });

    btnSalvar.addEventListener('click', async () => {
      const id = document.getElementById('atividadeId').value;
      const titulo = document.getElementById('atividadeTitulo').value.trim();
      const descricao = document.getElementById('atividadeDescricao').value.trim();
      const prazo = document.getElementById('atividadePrazo').value || null;
      const responsavelId = document.getElementById('atividadeResponsavel').value || null;

      if (!titulo) {
        alert('Informe um título para a atividade.');
        return;
      }

      const prazoIso = prazo ? new Date(prazo).toISOString() : null;

      const resultado = id
        ? await editarAtividade(id, { titulo, descricao, prazo: prazoIso, responsavelId })
        : await criarAtividade({ titulo, descricao, prazo: prazoIso, origem: 'manual', responsavelId });

      if (resultado) modal.classList.remove('active');
    });
  }

  // ---------- Init ----------
  async function iniciarAtividades() {
    await carregarMembros();
    await carregarAtividades();
    configurarDragDrop();
    configurarModal();
    verificarLembretes();
    verificarSugestoesIA();
  }

  document.addEventListener('DOMContentLoaded', () => {
    // só inicializa quando a aba "Atividades" existir no DOM
    if (document.getElementById('atividadesPanel')) {
      iniciarAtividades();
    }
  });

  // Expõe pra outros módulos (ex: fluxo pós-reunião) poderem criar atividades
  window.AtividadesModule = {
    criarAtividade,
    recarregar: carregarAtividades,
  };
})();