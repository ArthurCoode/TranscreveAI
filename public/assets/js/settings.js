const supabase = window.supabaseClient;

// ======================
// ELEMENTOS
// ======================

const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const profilePhoto = document.getElementById('profilePhoto');
const profilePreview = document.getElementById('profilePreview');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');

const planoAtualBadge = document.getElementById('planoAtualBadge');
const planoAtualDescricao = document.getElementById('planoAtualDescricao');

const senhaAtualInput = document.getElementById('senhaAtualInput');
const novaSenhaInput = document.getElementById('novaSenhaInput');
const confirmarNovaSenhaInput = document.getElementById('confirmarNovaSenhaInput');
const trocarSenhaBtn = document.getElementById('trocarSenhaBtn');

const sidebarAvatar = document.querySelector('.user-avatar');
const sidebarName = document.querySelector('.user-details strong');

const token = localStorage.getItem('token');

// ======================
// UPLOAD SUPABASE
// ======================
async function uploadAvatar(file) {
  if (!file) throw new Error('Arquivo inválido');
  if (file.size > 2 * 1024 * 1024) throw new Error('Imagem muito grande (máx. 2 MB).');

  // o upload passa pelo servidor (valida tipo/tamanho e usa a pasta do usuário)
  const form = new FormData();
  form.append('avatar', file);

  const res = await fetch('/api/avatar', {
    method: 'POST',
    headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    body: form
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) {
    throw new Error(data.erro || 'Não foi possível enviar a imagem.');
  }
  return data.url;
}

// ======================
// AVATAR UI
// ======================

function aplicarAvatar(url) {
  if (!url) {
    profilePreview.src = '';

    if (sidebarAvatar) {
      sidebarAvatar.textContent =
        profileName?.value?.[0]?.toUpperCase() || 'U';
    }
    return;
  }

  const safeUrl = url.includes('blob:')
    ? url
    : `${url}?v=${Date.now()}`;

  profilePreview.src = safeUrl;

  if (sidebarAvatar) {
    sidebarAvatar.innerHTML = `
      <img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />
    `;
  }
}

// ======================
// PLANO UI
// ======================

function aplicarPlano(perfil) {
  if (!planoAtualBadge || !planoAtualDescricao) return;

  const nomePlano = perfil.plano || 'Free';
  planoAtualBadge.textContent = nomePlano;

  const acoesPlanoEl = document.getElementById('acoesPlano');
  if (!acoesPlanoEl) {
    planoAtualDescricao.textContent =
      `Você está no plano ${nomePlano}. Clique em "Mudar plano" para fazer upgrade ou trocar.`;
    return;
  }

  if (nomePlano === 'Free') {
    planoAtualDescricao.textContent = `Você está no plano ${nomePlano}.`;
    acoesPlanoEl.innerHTML = '';
    return;
  }

  if (perfil.statusAssinatura === 'cancelamento_agendado') {
    const dataFormatada = perfil.fim_ciclo
      ? new Date(perfil.fim_ciclo).toLocaleDateString('pt-BR')
      : 'em breve';
    planoAtualDescricao.textContent =
      `Cancelamento agendado — você mantém acesso ao ${nomePlano} até ${dataFormatada}.`;
    acoesPlanoEl.innerHTML = `
      <button class="btn-new" id="reativarAssinaturaBtn" style="background:var(--success);">
        <i class="fas fa-undo"></i> Desfazer cancelamento
      </button>
    `;
    document.getElementById('reativarAssinaturaBtn')?.addEventListener('click', reativarAssinatura);
  } else {
    planoAtualDescricao.textContent = `Você está no plano ${nomePlano}.`;
    acoesPlanoEl.innerHTML = `
      <button class="btn-new" id="cancelarAssinaturaBtn" style="background:var(--danger);">
        <i class="fas fa-times-circle"></i> Cancelar assinatura
      </button>
    `;
    document.getElementById('cancelarAssinaturaBtn')?.addEventListener('click', cancelarAssinatura);
  }
}

async function cancelarAssinatura() {
  if (!confirm('Tem certeza que quer cancelar sua assinatura? Você continuará com acesso ao plano pago até o fim do período já pago, depois volta pro Free automaticamente.')) {
    return;
  }
  try {
    const res = await fetch('/api/cancelar-assinatura', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao cancelar');
    alert(data.mensagem);
    loadSettings();
  } catch (err) {
    alert(err.message);
  }
}

async function reativarAssinatura() {
  try {
    const res = await fetch('/api/reativar-assinatura', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erro || 'Erro ao reativar');
    alert(data.mensagem);
    loadSettings();
  } catch (err) {
    alert(err.message);
  }
}

// ======================
// LOAD PERFIL
// ======================

async function loadSettings() {
  try {
    const res = await fetch('/api/perfil', {
      cache: 'no-store',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await res.json();
    const perfil = data.perfil;

    profileName.value = perfil.nome || '';
    profileEmail.value = perfil.email || '';

    if (sidebarName) {
      sidebarName.textContent = perfil.nome || 'Usuário';
    }

    aplicarAvatar(perfil.avatar_url);
    aplicarPlano(perfil);

  } catch (err) {
    console.error('Erro ao carregar perfil:', err);
    if (planoAtualDescricao) planoAtualDescricao.textContent = 'Não foi possível carregar o plano.';
  }
}

// ======================
// SELEÇÃO DE FOTO (PREVIEW)
// ======================

profilePhoto?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  // revoga anterior
  if (profilePhoto._blobUrl) {
    URL.revokeObjectURL(profilePhoto._blobUrl);
  }

  const blobUrl = URL.createObjectURL(file);
  profilePhoto._blobUrl = blobUrl;

  aplicarAvatar(blobUrl);

  profilePhoto._file = file;
});

// ======================
// SALVAR CONFIGURAÇÕES (perfil)
// ======================

async function saveSettings() {
  try {
    if (!token) throw new Error('Token ausente');

    saveSettingsBtn.disabled = true;

    let avatar_url;

    const file = profilePhoto._file;

    // só faz upload se realmente existir arquivo novo
    if (file) {
      avatar_url = await uploadAvatar(file);
    }

    // 🔥 payload seguro (NUNCA envia null)
    const payload = {
      nome: profileName.value
    };

    if (avatar_url) {
      payload.avatar_url = avatar_url;
    }

    const res = await fetch('/api/perfil', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.erro || 'Erro ao salvar');
    }

    // atualiza UI lateral
    sidebarName.textContent = profileName.value;

    if (data.perfil?.avatar_url) {
      aplicarAvatar(data.perfil.avatar_url);
    }

    // limpa estado de upload
    profilePhoto._file = null;

    alert('Salvo com sucesso');

  } catch (err) {
    alert(err.message);
  } finally {
    saveSettingsBtn.disabled = false;
  }
}

// ======================
// TROCAR SENHA
// ======================

async function trocarSenha() {
  try {
    if (!token) throw new Error('Token ausente');

    const senhaAtual = senhaAtualInput?.value || '';
    const novaSenha = novaSenhaInput?.value || '';
    const confirmarNovaSenha = confirmarNovaSenhaInput?.value || '';

    if (!senhaAtual || !novaSenha || !confirmarNovaSenha) {
      alert('Preencha os três campos de senha.');
      return;
    }

    if (novaSenha.length < 8) {
      alert('A nova senha precisa ter pelo menos 8 caracteres.');
      return;
    }

    if (novaSenha !== confirmarNovaSenha) {
      alert('A nova senha e a confirmação não são iguais.');
      return;
    }

    trocarSenhaBtn.disabled = true;
    trocarSenhaBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Alterando...';

    const res = await fetch('/api/trocar-senha', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ senhaAtual, novaSenha })
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.erro || 'Erro ao trocar senha');
    }

    alert('Senha alterada com sucesso!');
    senhaAtualInput.value = '';
    novaSenhaInput.value = '';
    confirmarNovaSenhaInput.value = '';

  } catch (err) {
    alert(err.message);
  } finally {
    trocarSenhaBtn.disabled = false;
    trocarSenhaBtn.innerHTML = '<i class="fas fa-key"></i> Alterar senha';
  }
}

// ======================
// CLEANUP MEMORY
// ======================

window.addEventListener('beforeunload', () => {
  if (profilePhoto._blobUrl) {
    URL.revokeObjectURL(profilePhoto._blobUrl);
  }
});

// ======================
// EVENT LISTENERS
// ======================

saveSettingsBtn?.addEventListener('click', saveSettings);
trocarSenhaBtn?.addEventListener('click', trocarSenha);

// ======================
// INIT
// ======================

loadSettings();