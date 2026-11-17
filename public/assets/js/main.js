// ============================================
// INICIALIZAÇÃO E NAVEGAÇÃO DA APLICAÇÃO
// Este arquivo deve ser carregado por ÚLTIMO,
// depois de todos os outros .js — ele usa funções
// definidas em todos eles.
// ============================================

// logout — limpa tudo e manda para o login
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('darkMode');
  window.location.replace('/login.html');
}

window.logout = logout;

window.addEventListener('load', () => {
  renderMeetings();
  renderTranscripts();
});

// Convite de time: o link do e-mail abre /dashboard.html?convite=<token>.
// Guarda o token (sobrevive ao redirect para o login) e aceita depois.
function capturarConviteDaUrl() {
  const params = new URLSearchParams(window.location.search);
  const convite = params.get('convite');
  if (!convite) return;
  try { sessionStorage.setItem('convite_pendente', convite); } catch (e) { /* sem storage */ }
  params.delete('convite');
  const query = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (query ? '?' + query : '') + window.location.hash);
}

async function processarConvitePendente() {
  let convite = null;
  try { convite = sessionStorage.getItem('convite_pendente'); } catch (e) { return; }
  if (!convite) return;
  try { sessionStorage.removeItem('convite_pendente'); } catch (e) { /* ignora */ }

  if (!confirm('Você recebeu um convite para entrar em um time. Ao aceitar, os administradores do time poderão ver suas reuniões. Aceitar?')) return;

  try {
    const res = await fetch('/api/team/aceitar-convite', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ token: convite })
    });
    const data = await res.json().catch(() => ({}));
    alert(res.ok ? (data.mensagem || 'Convite aceito!') : (data.error || 'Não foi possível aceitar o convite.'));
    if (res.ok) window.location.reload();
  } catch (err) {
    alert('Não foi possível aceitar o convite agora.');
  }
}

(async () => {
  capturarConviteDaUrl();

  // 1. verifica se esta logado — redireciona para login se nao tiver token
  const tokenAtual = localStorage.getItem('token');
  if (!tokenAtual) {
    window.location.replace('/login.html');
    return;
  }

  processarConvitePendente();

  // 2. aplica dark mode salvo
  if (localStorage.getItem('darkMode') === 'true') {
    document.body.classList.add('dark');
  }

  // 3. carrega os dados
  await Promise.all([
    carregarPerfil(),
    carregarAgendamentos(),
    carregarTranscricoes()
  ]);

  if (!localStorage.getItem('welcome_notification')) {
    window.notifications?.add({
      title: "Bem-vindo",
      message: "Seu dashboard está pronto",
      icon: "fa-rocket",
      type: "success"
    });

    localStorage.setItem('welcome_notification', 'true');
  }

  /* ABRIR MODAL */
  document.getElementById('newMeetingBtn')?.addEventListener('click', () => {
    document.getElementById('meetingModal')?.classList.add('active');
  });

  /* FECHAR */
  document.getElementById('cancelModal')?.addEventListener('click', () => {
    document.getElementById('meetingModal').classList.remove('active');
  });

  /* SALVAR */
  document.getElementById('saveMeeting')?.addEventListener('click', criarReuniao);

  /* ==========================
     FECHAR CLICANDO FORA
  ========================== */
  document.getElementById('meetingModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'meetingModal') {
      document.getElementById('meetingModal').classList.remove('active');
    }
  });

  document.getElementById('exportAllBtn')?.addEventListener('click', exportMeetingsCSV);

  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      const tab = link.dataset.tab;

      /* ativa menu */
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      link.classList.add('active');

      /* ativa painel */
      document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
      document.getElementById(tab + 'Panel')?.classList.add('active');

      /* reset pagina */
      currentMeetingPage = 1;

      /* render depois da troca */
      renderMeetings();

      const titles = {
        dashboard: 'Início',
        meetings: 'Agendamentos',
        transcripts: 'Transcrições',
        insights: 'Insights',
        theo: 'Theo',
        team: 'Time',
        supervisao: 'Supervisão',
        atividades: 'Atividades',
        settings: 'Configurações'
      };

      document.getElementById('pageTitle').innerText = titles[tab];
    });
  });

  document.addEventListener('click', (e) => {
    const item = e.target.closest('.meeting-item, .transcript-item');
    if (item) {
      item.blur?.();
    }
  });
})();
