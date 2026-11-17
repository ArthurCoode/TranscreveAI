// ============================================
// FUNÇÕES UTILITÁRIAS GERAIS
// Usadas por praticamente todos os outros módulos
// (api, formatação de datas, toast de feedback).
// ============================================

// Escapa texto antes de interpolar em innerHTML. Use SEMPRE que o valor
// vier do banco, de outro usuário ou da IA (nomes, títulos, resumos...).
function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
window.escHtml = escHtml;

// Só permite links http(s) em href/src montados com dados do banco.
function urlSegura(v) {
  try {
    const u = new URL(String(v || ''), window.location.origin);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : '';
  } catch (e) {
    return '';
  }
}
window.urlSegura = urlSegura;

// token lido dinamicamente para sempre pegar o mais recente
function getHeaders() {
  const token = localStorage.getItem('token');

  return {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : ''
  };
}

function formatarBrasil(data) {
  if (!data) return '-';

  const d = new Date(data);

  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo'
  });
}

function showToast(msg) {
  const toast = document.createElement('div');

  toast.className = 'toast';
  toast.innerHTML = `<i class="fas fa-check-circle" style="color:#5B3B8C;margin-right:10px"></i>${msg}`;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

async function api(url, options = {}) {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        ...getHeaders(),
        ...(options.headers || {})
      }
    });

    if (res.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');

      window.location.replace('/login.html');

      return;
    }

    const text = await res.text();

    let json = {};

    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = {};
    }

    if (!res.ok) {
      throw new Error(json.erro || json.message || `Erro ${res.status}`);
    }

    return json;
  } catch (err) {
    console.error('API ERROR:', err);

    showToast('Falha ao carregar dados');

    throw err;
  }
}
