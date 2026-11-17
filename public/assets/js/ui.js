// ============================================
// COMPORTAMENTOS GERAIS DE UI
// (toggle switches genéricos e alternância de tema)
// ============================================

document.querySelectorAll('.toggle-switch').forEach(t => {
  t.onclick = () => t.classList.toggle('active');
});

const themeToggle = document.getElementById('themeToggle');

if (themeToggle) {
  themeToggle.onclick = () => {
    document.body.classList.toggle('dark');

    localStorage.setItem('darkMode', document.body.classList.contains('dark'));
  };

  // ATENÇÃO: esta linha já existia no código original e roda
  // imediatamente ao carregar a página (antes do dark mode salvo
  // ser aplicado no main.js). Na prática ela reseta 'darkMode'
  // para 'false' a cada load, então a preferência salva nunca
  // chega a persistir de fato. Mantive igual ao original — me
  // avise se quiser que eu corrija isso.
  localStorage.setItem('darkMode', document.body.classList.contains('dark'));
}

// ============================================
// CARD "AI INSIGHTS" DO DASHBOARD
// Soma os insights de todas as transcrições carregadas
// e atualiza o stat card #totalInsights.
// ============================================

function atualizarInsightsDashboard() {
  const el = document.getElementById('totalInsights');
  if (!el) return;

  const total = transcripts.reduce((soma, t) => soma + (t.insights ? t.insights.length : 0), 0);

  el.textContent = total;
}

window.atualizarInsightsDashboard = atualizarInsightsDashboard;