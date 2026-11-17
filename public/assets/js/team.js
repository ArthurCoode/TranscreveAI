class TeamManager {
  constructor() {
    this.members = [];

    this.list = document.getElementById('teamList');
    this.drawer = document.getElementById('memberDrawer');
    this.drawerContent = document.getElementById('memberDetails');
    this.drawerChartInstance = null;

    this.token =
      localStorage.getItem('token') ||
      localStorage.getItem('tr_token') ||
      localStorage.getItem('authToken') ||
      '';

    this.init();
  }

  init() {
    const inviteBtn = document.getElementById('inviteBtn');
    const inviteModal = document.getElementById('inviteModal');
    const closeInvite = document.getElementById('closeInvite');
    const sendInvite = document.getElementById('sendInvite');
    const closeDrawer = document.getElementById('closeDrawer');

    closeDrawer?.addEventListener('click', () => {
      this.drawer?.classList.remove('active');
    });

    inviteBtn?.addEventListener('click', () => {
      inviteModal?.classList.add('active');
    });

    closeInvite?.addEventListener('click', () => {
      inviteModal?.classList.remove('active');
    });

    sendInvite?.addEventListener('click', () => {
      this.invite();
    });

    inviteModal?.addEventListener('click', (e) => {
      if (e.target === inviteModal) {
        inviteModal.classList.remove('active');
      }
    });

    // pesquisa
    document.getElementById('teamSearch')?.addEventListener('input', () => this.render());

    // filtro cargo
    document.getElementById('teamFilter')?.addEventListener('change', () => this.render());

    this.loadMembers();
  }

  async request(url, options = {}) {
    const headers = {
      'Content-Type': 'application/json'
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    Object.assign(headers, options.headers || {});

    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.erro || 'Erro API');
    }

    return data;
  }

  async loadMembers() {
    try {
      const data = await this.request('/api/team/stats');

      this.members = Array.isArray(data) ? data : [];

      this.render();
    } catch (err) {
      console.error('TEAM LOAD', err);

      this.members = [];

      this.render();
    }
  }

  async invite() {
    const email = document.getElementById('inviteEmail').value.trim();
    const role = document.getElementById('inviteRole').value;

    if (!email) {
      alert('Digite um email');
      return;
    }

    try {
      const resposta = await this.request('/api/team/invite', {
        method: 'POST',
        body: JSON.stringify({ email, role })
      });

      document.getElementById('inviteEmail').value = '';
      document.getElementById('inviteModal').classList.remove('active');
      alert((resposta && resposta.mensagem) || 'Convite enviado! A pessoa entra no time ao aceitar pelo e-mail.');

      await this.loadMembers();
    } catch (err) {
      console.error(err);
      alert(err.message);
    }
  }

  updateSummary() {
    const members = this.members.length;

    const meetings = this.members.reduce((acc, m) => acc + (Number(m.meetings) || 0), 0);
    const hours = this.members.reduce((acc, m) => acc + (Number(m.hours) || 0), 0);
    const insights = this.members.reduce((acc, m) => acc + (Number(m.insights) || 0), 0);

    const membersEl = document.getElementById('membersCount');
    const meetingsEl = document.getElementById('teamMeetings');
    const hoursEl = document.getElementById('teamHours');
    const insightsEl = document.getElementById('teamInsights');

    if (membersEl) {
      membersEl.textContent = members;
    }

    if (meetingsEl) {
      meetingsEl.textContent = meetings;
    }

    if (hoursEl) {
      hoursEl.textContent = `${hours.toFixed(1)}h`;
    }

    if (insightsEl) {
      insightsEl.textContent = insights;
    }
  }

  // ============================================
  // AVATAR (cards da grid) — mostra a foto (avatar_url)
  // se existir, senão cai para as iniciais do nome.
  // ============================================
  avatarMarkup(m) {
    if (m.avatar_url) {
      return `<img src="${escHtml(urlSegura(m.avatar_url))}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" />`;
    }

    return escHtml((m.name || '?').slice(0, 2).toUpperCase());
  }

  // Mesma lógica, mas para o avatar do drawer (border-radius-lg,
  // não 50%, para bater com .profile-avatar-drawer)
  avatarMarkupDrawer(m) {
    if (m.avatar_url) {
      return `<img src="${escHtml(urlSegura(m.avatar_url))}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;" />`;
    }

    return escHtml((m.name || '?').slice(0, 2).toUpperCase());
  }

  // ============================================
  // Texto relativo tipo "há 2 dias" / "hoje" / "nunca"
  // ============================================
  tempoRelativo(iso) {
    if (!iso) return 'nunca';

    const agora = new Date();
    const data = new Date(iso);
    const diffMs = agora - data;
    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDias <= 0) return 'hoje';
    if (diffDias === 1) return 'há 1 dia';
    if (diffDias < 30) return `há ${diffDias} dias`;

    const diffMeses = Math.floor(diffDias / 30);
    if (diffMeses === 1) return 'há 1 mês';
    return `há ${diffMeses} meses`;
  }

  render() {
    if (!this.list) return;

    this.list.innerHTML = '';

    const search = (document.getElementById('teamSearch')?.value || '').toLowerCase().trim();
    const role = document.getElementById('teamFilter')?.value || 'all';

    const filtered = this.members.filter(m => {
      const matchSearch =
        (m.name || '').toLowerCase().includes(search) ||
        (m.email || '').toLowerCase().includes(search);

      const matchRole = role === 'all' || (m.role || 'viewer').toLowerCase() === role;

      return matchSearch && matchRole;
    });

    if (filtered.length === 0) {
      this.list.innerHTML = `
        <div class="empty-state">
          <i class="fas fa-users"></i>
          <h3>Nenhum membro encontrado</h3>
          <p>Tente alterar os filtros</p>
        </div>
      `;

      this.updateSummary();
      return;
    }

    filtered.forEach(m => {
      const totalAtividades = (Number(m.atividades_concluidas) || 0) + (Number(m.atividades_pendentes) || 0);
      const progresso = totalAtividades > 0
        ? Math.round((Number(m.atividades_concluidas) || 0) / totalAtividades * 100)
        : 0;

      this.list.innerHTML += `
        <div class="team-card">
          <div class="team-top">
            <div class="team-avatar">${this.avatarMarkup(m)}</div>

            <div>
              <h4>${escHtml(m.name || '-')}</h4>
              <p>${escHtml(m.email || '-')}</p>
            </div>
          </div>

          <div class="team-meta">
            <span class="role ${escHtml(m.role || '')}">${escHtml(m.role || 'viewer')}</span>
          </div>

          <div class="team-quick-stats">
            <div class="team-quick-stat">
              <i class="fas fa-video"></i>
              <span>${m.meetings || 0} reuniões</span>
            </div>
            <div class="team-quick-stat">
              <i class="fas fa-clock"></i>
              <span>${m.hours || 0}h</span>
            </div>
          </div>

          ${totalAtividades > 0 ? `
            <div class="team-progress">
              <div class="team-progress-bar">
                <div class="team-progress-fill" style="width:${progresso}%;"></div>
              </div>
              <span class="team-progress-label">${m.atividades_concluidas || 0}/${totalAtividades} atividades ${m.atividades_atrasadas > 0 ? `· <span class="team-atrasadas">${m.atividades_atrasadas} atrasada${m.atividades_atrasadas > 1 ? 's' : ''}</span>` : ''}</span>
            </div>
          ` : ''}

          <div class="team-ultima-atividade">
            <i class="fas fa-history"></i> Última reunião: ${this.tempoRelativo(m.ultima_reuniao_em)}
          </div>

          <div class="team-actions">
            <button class="btn-member open-profile" data-id="${m.id}">Perfil</button>
            <button class="btn-member danger remove-member" data-id="${m.id}">Remover</button>
          </div>
        </div>
      `;
    });

    this.attachEvents();
    this.updateSummary();
  }

  attachEvents() {
    document.querySelectorAll('.remove-member').forEach((btn) => {
      btn.onclick = () => {
        this.remove(btn.dataset.id);
      };
    });

    document.querySelectorAll('.open-profile').forEach((btn) => {
      btn.onclick = () => {
        this.openDrawer(btn.dataset.id);
      };
    });
  }

  async remove(id) {
    if (!confirm('Remover membro?')) return;

    try {
      await this.request('/api/team/remove', {
        method: 'DELETE',
        body: JSON.stringify({ id })
      });

      this.drawer?.classList.remove('active');

      await this.loadMembers();
    } catch (err) {
      alert(err.message);
    }
  }

  // ============================================
  // DRAWER — agora carrega detalhe sob demanda
  // (histórico semanal, últimas reuniões, últimas atividades)
  // ============================================
  async openDrawer(id) {
    const member = this.members.find(m => m.id === id);

    if (!member || !this.drawerContent) return;

    // Mostra o drawer já com o que já temos (aparece instantâneo),
    // e um estado de carregamento pro resto.
    this.drawerContent.innerHTML = `
      <div class="profile-avatar-drawer" style="overflow:hidden;">
        ${this.avatarMarkupDrawer(member)}
      </div>

      <h2 class="profile-name-drawer">${escHtml(member.name || '-')}</h2>
      <p class="profile-email-drawer">${escHtml(member.email || '-')}</p>

      <span class="role ${escHtml(member.role || '')}">${escHtml(member.role || 'viewer')}</span>

      <div class="profile-grid-drawer">
        <div class="profile-stat-card-drawer">
          <div class="stat-value">${member.meetings || 0}</div>
          <div class="stat-label">Reuniões</div>
        </div>

        <div class="profile-stat-card-drawer">
          <div class="stat-value">${member.hours || 0}h</div>
          <div class="stat-label">Horas</div>
        </div>

        <div class="profile-stat-card-drawer">
          <div class="stat-value">${member.insights || 0}</div>
          <div class="stat-label">Insights</div>
        </div>
      </div>

      <div class="drawer-loading" id="drawerExtraLoading">
        <i class="fas fa-spinner fa-spin"></i> Carregando histórico...
      </div>

      <div id="drawerExtraContent"></div>

      <div class="drawer-actions">
        <button class="btn-member danger" id="removeMemberDrawerBtn" data-id="${member.id}">
          <i class="fas fa-user-minus"></i> Remover do time
        </button>
      </div>
    `;

    document.getElementById('removeMemberDrawerBtn')?.addEventListener('click', (e) => {
      this.remove(e.currentTarget.dataset.id);
    });

    this.drawer?.classList.add('active');

    // busca o detalhe sob demanda
    try {
      const detalhe = await this.request(`/api/team/member/${id}`);
      this.renderDrawerExtra(detalhe);
    } catch (err) {
      console.error('MEMBER DETAILS', err);
      const loadingEl = document.getElementById('drawerExtraLoading');
      if (loadingEl) {
        loadingEl.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Não foi possível carregar o histórico.';
      }
    }
  }

  renderDrawerExtra(detalhe) {
    const loadingEl = document.getElementById('drawerExtraLoading');
    const contentEl = document.getElementById('drawerExtraContent');

    if (loadingEl) loadingEl.style.display = 'none';
    if (!contentEl) return;

    const reunioes = detalhe.ultimas_reunioes || [];
    const atividades = detalhe.ultimas_atividades || [];

    contentEl.innerHTML = `
      <div class="drawer-section">
        <h4><i class="fas fa-chart-simple"></i> Reuniões por semana</h4>
        <div class="drawer-chart-wrapper">
          <canvas id="drawerMemberChart"></canvas>
        </div>
      </div>

      <div class="drawer-section">
        <h4><i class="fas fa-clock-rotate-left"></i> Últimas reuniões</h4>
        ${
          reunioes.length
            ? `<ul class="drawer-mini-list">
                ${reunioes.map(r => `
                  <li onclick="window.abrirTranscricao && window.abrirTranscricao('${escHtml(r.id)}')">
                    <span>${escHtml(r.nome || 'Sem título')}</span>
                    <small>${this.tempoRelativo(r.criado_em)}</small>
                  </li>
                `).join('')}
              </ul>`
            : `<p class="drawer-empty">Nenhuma reunião recente</p>`
        }
      </div>

      <div class="drawer-section">
        <h4><i class="fas fa-list-check"></i> Últimas atividades</h4>
        ${
          atividades.length
            ? `<ul class="drawer-mini-list">
                ${atividades.map(a => `
                  <li>
                    <span>${escHtml(a.titulo || 'Sem título')}</span>
                    <small class="drawer-status-${escHtml(a.status)}">${escHtml(a.status || '-')}</small>
                  </li>
                `).join('')}
              </ul>`
            : `<p class="drawer-empty">Nenhuma atividade recente</p>`
        }
      </div>
    `;

    // gráfico de barras simples: reuniões por semana (6 semanas)
    const canvas = document.getElementById('drawerMemberChart');

    if (canvas && typeof Chart !== 'undefined') {
      if (this.drawerChartInstance) {
        this.drawerChartInstance.destroy();
        this.drawerChartInstance = null;
      }

      const semanas = detalhe.reunioes_por_semana || [];

      this.drawerChartInstance = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: semanas.map(s => s.label),
          datasets: [{
            label: 'Reuniões',
            data: semanas.map(s => s.reunioes),
            backgroundColor: '#9B59FF',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
        }
      });
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new TeamManager();
});