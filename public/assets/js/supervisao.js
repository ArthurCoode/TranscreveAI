class SupervisaoManager {
  constructor() {
    this.navItem = document.getElementById('navSupervisao');
    this.alertasEl = document.getElementById('supervisaoAlertas');
    this.destaquesEl = document.getElementById('supervisaoDestaques');
    this.rankingBody = document.getElementById('supervisaoRankingBody');
    this.reunioesEl = document.getElementById('supervisaoReunioes');
    this.chartCanvas = document.getElementById('supervisaoChart');
    this.chartInstance = null;

    this.token =
      localStorage.getItem('token') ||
      localStorage.getItem('tr_token') ||
      localStorage.getItem('authToken') ||
      '';

    this.init();
  }

  async init() {
    // Se nenhum dos elementos existir, o snippet ainda não foi inserido no HTML
    if (!this.navItem) return;

    await this.load();
  }

  async request(url) {
    const headers = { 'Content-Type': 'application/json' };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(url, { headers });
    const data = await response.json();

    if (response.status === 403) {
      return { forbidden: true };
    }

    if (!response.ok) {
      throw new Error(data.erro || data.error || 'Erro API');
    }

    return data;
  }

  async load() {
    try {
      const data = await this.request('/api/supervisao/overview');

      if (data.forbidden) {
        // Usuário não é admin — não mostra o item de nav nem o painel
        this.navItem.style.display = 'none';
        return;
      }

      // É admin — libera o item de navegação
      this.navItem.style.display = 'flex';

      this.renderAlertas(data.alertas || []);
      this.renderDestaques(data.destaques || []);
      this.renderChart(data.ranking || []);
      this.renderRanking(data.ranking || []);
      this.renderReunioes(data.reunioes_recentes || []);
    } catch (err) {
      console.error('SUPERVISAO LOAD', err);
      this.navItem.style.display = 'none';
    }
  }

  // ============================================
  // GRÁFICO COMPARATIVO (Chart.js, já carregado globalmente)
  // Reaproveita o mesmo array "ranking" da tabela — nenhuma chamada
  // extra à API.
  // ============================================
  renderChart(ranking) {
    if (!this.chartCanvas || typeof Chart === 'undefined') return;

    // destrói instância anterior antes de recriar (evita canvas duplicado
    // ao recarregar o painel sem dar refresh na página inteira)
    if (this.chartInstance) {
      this.chartInstance.destroy();
      this.chartInstance = null;
    }

    if (ranking.length === 0) return;

    const labels = ranking.map((m) => m.name || m.email || '-');

    this.chartInstance = new Chart(this.chartCanvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Reuniões (30d)',
            data: ranking.map((m) => m.reunioes_30d),
            backgroundColor: '#9B59FF'
          },
          {
            label: 'Atividades concluídas',
            data: ranking.map((m) => m.atividades_concluidas),
            backgroundColor: '#28a745'
          },
          {
            label: 'Atividades atrasadas',
            data: ranking.map((m) => m.atividades_atrasadas),
            backgroundColor: '#dc3545'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' }
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } }
        }
      }
    });
  }

  // ============================================
  // ALERTAS
  // ============================================
  alertaLabel(alerta) {
    switch (alerta.tipo) {
      case 'atividade_atrasada':
        return `${escHtml(alerta.membro_nome)} tem ${alerta.detalhes.quantidade} atividade(s) atrasada(s)`;
      case 'sem_reuniao':
        return `${escHtml(alerta.membro_nome)} está sem reunião há ${alerta.detalhes.dias} dias`;
      case 'sentimento_negativo':
        return `${escHtml(alerta.membro_nome)} teve ${alerta.detalhes.quantidade} reunião(ões) com sinal de insatisfação do cliente`;
      default:
        return `${escHtml(alerta.membro_nome)}: alerta`;
    }
  }

  renderAlertas(alertas) {
    if (!this.alertasEl) return;

    if (alertas.length === 0) {
      this.alertasEl.innerHTML = `
        <div class="supervisao-empty">
          <i class="fas fa-circle-check"></i> Nenhum alerta no momento
        </div>
      `;
      return;
    }

    // críticos primeiro
    const ordenados = [...alertas].sort((a, b) => {
      const peso = { critico: 2, atencao: 1, info: 0 };
      return (peso[b.severidade] || 0) - (peso[a.severidade] || 0);
    });

    this.alertasEl.innerHTML = ordenados
      .map(
        (a) => `
        <div class="supervisao-alerta supervisao-alerta-${a.severidade}">
          <i class="fas ${a.severidade === 'critico' ? 'fa-circle-exclamation' : 'fa-triangle-exclamation'}"></i>
          <span>${this.alertaLabel(a)}</span>
        </div>
      `
      )
      .join('');
  }

  // ============================================
  // DESTAQUES
  // ============================================
  renderDestaques(destaques) {
    if (!this.destaquesEl) return;

    if (destaques.length === 0) {
      this.destaquesEl.innerHTML = `
        <div class="supervisao-empty">
          <i class="fas fa-hourglass-half"></i> Ainda sem destaques suficientes esta semana
        </div>
      `;
      return;
    }

    this.destaquesEl.innerHTML = destaques
      .map(
        (d) => `
        <div class="supervisao-destaque">
          <i class="fas fa-star"></i>
          <span>${d.motivo}</span>
        </div>
      `
      )
      .join('');
  }

  // ============================================
  // RANKING
  // ============================================
  scoreClasse(score) {
    if (score >= 80) return 'score-alto';
    if (score >= 50) return 'score-medio';
    return 'score-baixo';
  }

  renderRanking(ranking) {
    if (!this.rankingBody) return;

    if (ranking.length === 0) {
      this.rankingBody.innerHTML = `<tr><td colspan="6" class="supervisao-empty">Sem dados ainda</td></tr>`;
      return;
    }

    this.rankingBody.innerHTML = ranking
      .map(
        (m) => `
        <tr>
          <td>${escHtml(m.name || m.email || '-')}</td>
          <td><span class="score-badge ${this.scoreClasse(m.health_score)}">${m.health_score}</span></td>
          <td>${m.reunioes_30d}</td>
          <td>${m.horas_30d}h</td>
          <td>${m.taxa_conclusao_prazo}%</td>
          <td>${
            m.atividades_atrasadas > 0
              ? `<span class="atrasadas-badge">${m.atividades_atrasadas}</span>`
              : '—'
          }</td>
        </tr>
      `
      )
      .join('');
  }

  // ============================================
  // REUNIÕES RECENTES (com sentimento)
  // ============================================
  sentimentoBadge(sentimento) {
    const map = {
      positivo: { emoji: '😊', classe: 'sentimento-positivo', label: 'Positivo' },
      neutro: { emoji: '🙂', classe: 'sentimento-neutro', label: 'Neutro' },
      negativo: { emoji: '😟', classe: 'sentimento-negativo', label: 'Insatisfação' }
    };

    const s = map[sentimento] || map.neutro;

    return `<span class="sentimento-badge ${s.classe}">${s.emoji} ${s.label}</span>`;
  }

  formatarData(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  renderReunioes(reunioes) {
    if (!this.reunioesEl) return;

    if (reunioes.length === 0) {
      this.reunioesEl.innerHTML = `
        <div class="supervisao-empty">
          <i class="fas fa-inbox"></i> Nenhuma reunião nos últimos 30 dias
        </div>
      `;
      return;
    }

    this.reunioesEl.innerHTML = reunioes
      .map(
        (r) => `
        <div class="supervisao-reuniao-card" onclick="window.abrirTranscricao && window.abrirTranscricao('${escHtml(r.id)}')">
          <div class="supervisao-reuniao-top">
            <strong>${escHtml(r.titulo || 'Reunião sem título')}</strong>
            ${this.sentimentoBadge(r.sentimento)}
          </div>
          <div class="supervisao-reuniao-meta">
            <span><i class="fas fa-user"></i> ${escHtml(r.membro_nome)}</span>
            <span><i class="fas fa-calendar"></i> ${this.formatarData(r.criado_em)}</span>
            ${r.cliente_mencionado ? `<span><i class="fas fa-building"></i> ${escHtml(r.cliente_mencionado)}</span>` : ''}
          </div>
          ${
            r.tem_risco_cancelamento
              ? `<div class="supervisao-reuniao-risco"><i class="fas fa-triangle-exclamation"></i> Risco de cancelamento identificado</div>`
              : ''
          }
        </div>
      `
      )
      .join('');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SupervisaoManager();
});