// ============================================
// PERFIL DO USUÁRIO
// ============================================

async function calcularHorasUsuario() {
  try {
    const json = await api('/api/reunioes');

    const reunioes = json.reunioes || [];

    let seconds = 0;

    reunioes.forEach(r => {
      if (r.inicio && r.fim) {
        seconds += (new Date(r.fim) - new Date(r.inicio)) / 1000;
      }
    });

    return seconds / 3600;
  } catch (err) {
    console.error(err);
    return 0;
  }
}

function atualizarInsightsDashboard() {
  const el = document.getElementById('totalInsights');
  if (!el) return;

  const insights = transcripts.filter(t =>
    t.resumo && t.resumo.trim().length > 0
  ).length;

  el.innerText = insights;
}

async function carregarPerfil() {
  try {
    const json = await api('/api/perfil');

    perfil = json.perfil;

    await atualizarPerfilUI();
  } catch (e) {
    console.error(e);

    showToast('Erro ao carregar perfil');
  }
}

async function atualizarPerfilUI() {
  const hours = await calcularHorasUsuario() || 0;

  /* CAMPOS SETTINGS */
  const nameInput = document.getElementById('profileName');
  const emailInput = document.getElementById('profileEmail');
  const avatarPreview = document.getElementById('profilePreview');

  /* evita erro se elemento nao existir */
  if (nameInput) {
    nameInput.value = perfil?.nome || '';
  }

  if (emailInput) {
    emailInput.value = perfil?.email || '';
  }

  /* FOTO */
  if (avatarPreview && perfil?.avatar_url) {
    avatarPreview.src = perfil.avatar_url;
  }

  /* SIDEBAR */
  const sidebarName = document.querySelector('.user-details strong');
  const sidebarPlan = document.querySelector('.user-details small');
  const sidebarAvatar = document.querySelector('.user-avatar');

  if (sidebarName) {
    sidebarName.innerText = perfil?.nome || 'Usuário';
  }

  if (sidebarPlan) {
    sidebarPlan.innerText = perfil?.plano || 'Plano';
  }

  /* FOTO OU INICIAIS */
  if (sidebarAvatar) {
    if (perfil?.avatar_url) {
      sidebarAvatar.innerHTML = `
        <img
          src="${escHtml(urlSegura(perfil.avatar_url))}"
          style="width:100%;height:100%;object-fit:cover;border-radius:50%;"
        />
      `;
    } else {
      sidebarAvatar.innerText = (perfil?.nome || 'U')
        .split(' ')
        .map(n => n[0])
        .slice(0, 2)
        .join('');
    }
  }

  /* DASHBOARD */
  // NOTA: o card "Total Agendamentos" (#totalMeetings) é controlado
  // por atualizarContadorMeetings() em reunioes.js — removido daqui
  // para não haver disputa entre carregarPerfil() e
  // carregarAgendamentos() (que rodam em paralelo) sobre o mesmo
  // elemento.
  const totalHours = document.getElementById('totalHours');

  if (totalHours) {
    totalHours.innerText = hours.toFixed(1);
  }
}

async function salvarPerfil() {
  try {
    await api('/api/perfil', {
      method: 'PUT',
      body: JSON.stringify({
        nome: document.getElementById('profileName')?.value || ''
      })
    });

    showToast('Perfil atualizado');
  } catch (err) {
    console.error(err);

    showToast('Erro ao salvar');
  }
}