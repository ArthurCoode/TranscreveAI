// ============================================
// REUNIÕES / AGENDAMENTOS
// ============================================

let convidadosSelecionados = [];

function atualizarContadorMeetings() {
  const total = scheduledMeetings.length;

  const el = document.getElementById('totalMeetings');

  if (el) {
    el.innerText = total;
  }
}

async function carregarAgendamentos() {
  try {
    const json = await api('/api/reunioes');

    const totalAnterior = scheduledMeetings.length;

    scheduledMeetings = json.reunioes || [];

    if (scheduledMeetings.length > totalAnterior) {
      window.notifications?.add({
        title: "Nova reunião",
        message: "Você possui novos agendamentos",
        icon: "fa-bell",
        type: "info"
      });
    }

    renderMeetings();

    atualizarContadorMeetings();
  } catch (err) {
    console.error(err);

    showToast('Erro ao carregar agendamentos');
  }
}

function renderMeetings() {
  const abaAtual = document.querySelector('.nav-link.active')?.dataset.tab;

  const meetingsOnly = scheduledMeetings.map(m => ({
    tipo: 'agendada',
    id: m.id,
    titulo: m.titulo,
    data: m.inicio,
    extra: `${m.plataforma || '-'} · AGENDADA`,
    link: m.link
  }));

  const dashboardItems = [
    ...meetingsOnly,

    ...transcripts.map(t => ({
      tipo: 'transcricao',
      id: t.id,
      titulo: t.nome || 'Sem título',
      data: t.criado_em,
      extra: `${t.total_palavras || 0} palavras`,
      link: null
    }))
  ];

  if (abaAtual === 'dashboard') {
    const dashboard = document.getElementById('meetingList');

    if (dashboard) {
      dashboard.innerHTML = dashboardItems
        .sort((a, b) => new Date(b.data) - new Date(a.data))
        .slice(0, 5)
        .map(renderMeetingCard)
        .join('');
    }

    return;
  }

  const todas = meetingsOnly.sort((a, b) => new Date(b.data) - new Date(a.data));

  const totalPages = Math.max(1, Math.ceil(todas.length / meetingsPerPage));

  if (currentMeetingPage > totalPages) {
    currentMeetingPage = totalPages;
  }

  const inicio = (currentMeetingPage - 1) * meetingsPerPage;

  const pageItems = todas.slice(inicio, inicio + meetingsPerPage);

  document.getElementById('allMeetingsList').innerHTML = `
    <div id="meetingsContainer">
      ${
        pageItems.length
          ? pageItems.map(renderMeetingCard).join('')
          : '<p style="padding:1rem">Nenhuma reunião agendada</p>'
      }
    </div>

    <div class="meeting-pagination">
      <button
        class="page-btn"
        onclick="trocarPaginaMeeting(${currentMeetingPage - 1})"
        ${currentMeetingPage === 1 ? 'disabled' : ''}
      >
        <i class="fas fa-chevron-left"></i>
      </button>

      <div style="padding:10px 18px;border-radius:14px;background:var(--bg-primary);">
        ${currentMeetingPage} / ${totalPages}
      </div>

      <button
        class="page-btn"
        onclick="trocarPaginaMeeting(${currentMeetingPage + 1})"
        ${currentMeetingPage === totalPages ? 'disabled' : ''}
      >
        <i class="fas fa-chevron-right"></i>
      </button>
    </div>
  `;
}

function exportMeetingsCSV() {
  if (!scheduledMeetings.length) {
    showToast('Nenhum agendamento para exportar');
    return;
  }

  const headers = ['Título', 'Início', 'Fim', 'Plataforma', 'Link'];

  const rows = scheduledMeetings.map(r => [
    r.titulo || '',
    formatarBrasil(r.inicio),
    formatarBrasil(r.fim),
    r.plataforma || '-',
    r.link || '-'
  ]);

  const csv = [
    headers.join(';'),
    ...rows.map(row =>
      row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')
    )
  ].join('\n');

  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });

  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');

  a.href = url;
  a.download = `agendamentos_${new Date().toISOString().slice(0, 10)}.csv`;

  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);

  showToast('CSV exportado com sucesso');
}

function trocarPaginaMeeting(pagina) {
  const todas = scheduledMeetings
    .slice()
    .sort((a, b) => new Date(b.inicio) - new Date(a.inicio));

  const totalPages = Math.max(1, Math.ceil(todas.length / meetingsPerPage));

  if (pagina < 1 || pagina > totalPages) {
    return;
  }

  currentMeetingPage = pagina;

  renderMeetings();
}

function renderMeetingCard(m) {
  return `
    <div class="meeting-item" ${m.tipo === 'transcricao' ? `onclick="abrirTranscricao('${escHtml(m.id)}')"` : ''}>
      <div>
        <strong>
          ${m.tipo === 'agendada' ? '📅' : '🎙️'}
          ${escHtml(m.titulo)}
        </strong>
        <br>
        <small>${formatarBrasil(m.data)} · ${escHtml(m.extra)}</small>
      </div>

      ${
        m.tipo === 'agendada'
          ? (
              m.link
                ? `<a href="${escHtml(urlSegura(m.link))}" target="_blank" rel="noopener noreferrer" onclick="event.stopPropagation();"><i class="fas fa-video"></i></a>`
                : `<i class="fas fa-calendar"></i>`
            )
          : `
            <button onclick="event.stopPropagation(); abrirTranscricao('${m.id}')" style="background:none;border:none;cursor:pointer;">
              <i class="fas fa-eye"></i>
            </button>
          `
      }
    </div>
  `;
}

/* ==========================
   CONVIDADOS — CHIPS
========================== */
function adicionarConvidado(email) {
  const limpo = email.trim();

  if (!limpo) return;

  if (!limpo.includes('@') || !limpo.includes('.')) {
    showToast('Email inválido: ' + limpo);
    return;
  }

  if (convidadosSelecionados.includes(limpo)) return;

  convidadosSelecionados.push(limpo);
  renderChipsConvidados();
}

function removerConvidado(email) {
  convidadosSelecionados = convidadosSelecionados.filter(e => e !== email);
  renderChipsConvidados();
}

function renderChipsConvidados() {
  const container = document.getElementById('convidadosChips');
  if (!container) return;

  container.innerHTML = convidadosSelecionados
    .map(email => `
      <span class="chip">
        ${escHtml(email)}
        <i class="fas fa-xmark" data-email="${escHtml(email)}" onclick="removerConvidado(this.dataset.email)"></i>
      </span>
    `)
    .join('');
}

function inicializarInputConvidados() {
  const input = document.getElementById('modalConvidados');
  if (!input) return;

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      adicionarConvidado(input.value.replace(',', ''));
      input.value = '';
    }
  });

  input.addEventListener('blur', () => {
    if (input.value.trim()) {
      adicionarConvidado(input.value);
      input.value = '';
    }
  });
}

window.removerConvidado = removerConvidado;

/* ==========================
   CRIAR REUNIÃO
========================== */
async function criarReuniao() {
  try {
    const titulo = document.getElementById('modalTitle').value.trim();

    if (!googleConnected) {
      showToast('Conecte sua conta Google antes de criar reuniões');

      setTimeout(() => {
        window.location.href = '/api/google/login';
      }, 1000);

      return;
    }

    function localToISO(localDate) {
      if (!localDate) return null;

      return new Date(localDate).toISOString();
    }

    const inicio = localToISO(document.getElementById('modalDate').value);
    const fim = localToISO(document.getElementById('modalEndDate').value);
    const plataforma = document.getElementById('modalPlatform').value;
    const link = document.getElementById('modalLink').value.trim();
    const descricao = document.getElementById('modalDescricao')?.value.trim() || '';
    const criarMeet = document.getElementById('modalCriarMeet')?.checked ?? true;
    const anexoUrl = document.getElementById('modalAnexoUrl')?.value.trim() || '';

    // pega o que ainda está digitado no campo de convidados e não foi confirmado
    const convidadosInput = document.getElementById('modalConvidados');
    if (convidadosInput && convidadosInput.value.trim()) {
      adicionarConvidado(convidadosInput.value);
      convidadosInput.value = '';
    }

    if (!titulo) {
      showToast('Informe o título');
      return;
    }

    if (!inicio) {
      showToast('Informe a data da reunião');
      return;
    }

    const resultado = await api('/api/reunioes', {
      method: 'POST',
      body: JSON.stringify({
        titulo,
        descricao,
        inicio,
        fim,
        plataforma,
        link,
        convidados: convidadosSelecionados.join(','),
        criarMeet,
        anexoUrl,
        anexoTitulo: 'Material da reunião'
      })
    });

    showToast(
      resultado?.evento?.meetLink
        ? 'Reunião criada com link do Meet!'
        : 'Reunião criada'
    );

    window.notifications?.add({
      title: "Reunião agendada",
      message: `${titulo} foi criada com sucesso`,
      icon: "fa-calendar-check",
      type: "success"
    });

    /* fecha modal */
    document.getElementById('meetingModal').classList.remove('active');

    /* limpa campos */
    document.getElementById('modalTitle').value = '';
    document.getElementById('modalDate').value = '';
    document.getElementById('modalEndDate').value = '';
    document.getElementById('modalPlatform').selectedIndex = 0;
    document.getElementById('modalLink').value = '';
    if (document.getElementById('modalDescricao')) document.getElementById('modalDescricao').value = '';
    if (document.getElementById('modalAnexoUrl')) document.getElementById('modalAnexoUrl').value = '';
    if (document.getElementById('modalCriarMeet')) document.getElementById('modalCriarMeet').checked = true;
    convidadosSelecionados = [];
    renderChipsConvidados();

    /* recarrega lista */
    await carregarAgendamentos();

    renderMeetings();
  } catch (err) {
    console.error(err);

    showToast(err.message || 'Erro ao criar reunião');
  }
}

window.trocarPaginaMeeting = trocarPaginaMeeting;

document.addEventListener('DOMContentLoaded', inicializarInputConvidados);