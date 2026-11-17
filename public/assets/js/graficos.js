// ============================================
// GRÁFICOS (Chart.js)
// ============================================

function atualizarGraficos() {
  if (window.meetingChart) window.meetingChart.destroy();
  if (window.hourChart) window.hourChart.destroy();

  window.meetingChart = new Chart(document.getElementById('meetingsChart'), {
    type: 'line',
    data: {
      labels: transcripts.map(t => formatarBrasil(t.criado_em)),
      datasets: [{
        label: 'Transcrições',
        data: transcripts.map((_, i) => i + 1),
        borderColor: '#5B3B8C'
      }]
    }
  });

  window.hourChart = new Chart(document.getElementById('hoursChart'), {
    type: 'bar',
    data: {
      labels: transcripts.map(t => t.nome || 'Sem título'),
      datasets: [{
        label: 'Palavras',
        data: transcripts.map(t => t.total_palavras || 0),
        backgroundColor: '#8B5CF6'
      }]
    }
  });
}
