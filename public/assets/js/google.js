// ============================================
// INTEGRAÇÃO COM GOOGLE CALENDAR
// ============================================

let googleConnected = localStorage.getItem('google_connected') === 'true';

function atualizarGoogleUI() {
  const btn = document.getElementById('googleAuthBtn');

  if (!btn) return;

  btn.innerHTML = googleConnected
    ? '<i class="fas fa-check"></i> Conectado'
    : '<i class="fab fa-google"></i> Conectar';

  btn.classList.toggle('connected', googleConnected);
}

function conectarGoogle() {
  const voltarPara = window.location.pathname + window.location.search;

  window.location.href = `/api/google/login?redirect=${encodeURIComponent(voltarPara)}`;
}

window.addEventListener('load', () => {
  atualizarGoogleUI();

  document.getElementById('googleAuthBtn')?.addEventListener('click', conectarGoogle);

  if (window.location.search.includes('google=connected')) {
    localStorage.setItem('google_connected', 'true');

    googleConnected = true;

    atualizarGoogleUI();

    history.replaceState({}, '', window.location.pathname);

    showToast('Google Calendar conectado');

    window.notifications?.add({
      title: "Google conectado",
      message: "Sua agenda foi sincronizada",
      icon: "fa-google",
      type: "success"
    });
  }
});