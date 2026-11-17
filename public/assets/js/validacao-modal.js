// ============================================
// VALIDAÇÃO EM TEMPO REAL DO MODAL DE REUNIÃO
// Bloco autocontido — não depende de outros módulos
// (tem seu próprio showToast local, igual ao original).
// ============================================

(function () {
  const titleInput = document.getElementById('modalTitle');
  const dateInput = document.getElementById('modalDate');
  const endDateInput = document.getElementById('modalEndDate');
  const titleHint = document.getElementById('titleHint');
  const dateHint = document.getElementById('dateHint');
  const endDateHint = document.getElementById('endDateHint');
  const quickDurationBtns = document.querySelectorAll('.quick-duration');
  const linkInput = document.getElementById('modalLink');
  const linkSuggestion = document.getElementById('linkSuggestion');
  const suggestedLinkText = document.getElementById('suggestedLinkText');

  // Dica do título
  if (titleInput) {
    titleInput.addEventListener('focus', function () {
      titleHint.style.display = 'block';
    });
    titleInput.addEventListener('blur', function () {
      if (!titleInput.value) titleHint.style.display = 'none';
    });
    titleInput.addEventListener('input', function () {
      if (this.value.length > 0) {
        this.style.borderColor = 'var(--success)';
        titleHint.style.display = 'none';
      } else {
        this.style.borderColor = 'var(--border)';
      }
    });
  }

  // Validação de data/hora
  function validateDates() {
    const start = dateInput?.value;
    const end = endDateInput?.value;
    const now = new Date();

    if (start && dateHint) {
      const startDate = new Date(start);
      if (startDate < now) {
        dateHint.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--warning);"></i> Data no passado!';
        dateHint.style.color = 'var(--warning)';
        dateInput.style.borderColor = 'var(--warning)';
      } else {
        dateHint.innerHTML = '<i class="fas fa-check-circle" style="color: var(--success);"></i> Data válida';
        dateHint.style.color = 'var(--success)';
        dateInput.style.borderColor = 'var(--success)';
      }
    }

    if (start && end && endDateHint) {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (endDate <= startDate) {
        endDateHint.innerHTML = '<i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i> Término deve ser após início!';
        endDateHint.style.color = 'var(--danger)';
        endDateInput.style.borderColor = 'var(--danger)';
      } else {
        const duration = (endDate - startDate) / (1000 * 60);
        endDateHint.innerHTML = `<i class="fas fa-check-circle" style="color: var(--success);"></i> Duração: ${duration} minutos`;
        endDateHint.style.color = 'var(--success)';
        endDateInput.style.borderColor = 'var(--success)';
      }
    }
  }

  if (dateInput) {
    dateInput.addEventListener('change', validateDates);
    dateInput.addEventListener('input', validateDates);
  }
  if (endDateInput) {
    endDateInput.addEventListener('change', validateDates);
    endDateInput.addEventListener('input', validateDates);
  }

  // Botões de duração rápida
  quickDurationBtns.forEach(btn => {
    btn.addEventListener('click', function () {
      const minutes = parseInt(this.getAttribute('data-minutes'));
      if (dateInput && dateInput.value && endDateInput) {
        const startDate = new Date(dateInput.value);
        if (!isNaN(startDate.getTime())) {
          const endDate = new Date(startDate.getTime() + minutes * 60000);
          endDateInput.value = endDate.toISOString().slice(0, 16);
          validateDates();

          // Feedback visual
          this.style.background = 'var(--primary)';
          this.style.color = 'white';
          setTimeout(() => {
            this.style.background = '';
            this.style.color = '';
          }, 200);
        }
      }
    });
  });

  // Sugestão de link baseado na plataforma
  const platformSelect = document.getElementById('modalPlatform');

  function generateSuggestedLink() {
    if (!platformSelect || !linkSuggestion || !suggestedLinkText) return;

    const platform = platformSelect.value;
    let baseUrl = '';
    let suggestion = '';

    switch (platform) {
      case 'zoom':
        baseUrl = 'https://zoom.us/j/';
        suggestion = baseUrl + Math.floor(Math.random() * 900000000) + 123456789;
        break;
      case 'meet':
        baseUrl = 'https://meet.google.com/';
        suggestion = baseUrl + Math.random().toString(36).substring(2, 8) + '-' +
                     Math.random().toString(36).substring(2, 5) + '-' +
                     Math.random().toString(36).substring(2, 5);
        break;
      case 'teams':
        baseUrl = 'https://teams.microsoft.com/l/meetup-join/19:';
        suggestion = baseUrl + Math.random().toString(36).substring(2, 15) + '%40thread.tacv2';
        break;
    }

    if (!linkInput.value) {
      linkSuggestion.style.display = 'block';
      suggestedLinkText.textContent = suggestion;
      suggestedLinkText.style.cursor = 'pointer';
      suggestedLinkText.style.color = 'var(--primary)';
      suggestedLinkText.style.textDecoration = 'underline';

      // Clique para preencher
      suggestedLinkText.onclick = function () {
        linkInput.value = suggestion;
        linkSuggestion.style.display = 'none';
        showToast('Link sugerido adicionado!', 'success');
      };
    } else {
      linkSuggestion.style.display = 'none';
    }
  }

  if (platformSelect) {
    platformSelect.addEventListener('change', function () {
      if (!linkInput.value) {
        generateSuggestedLink();
      }
    });
  }

  if (linkInput) {
    linkInput.addEventListener('input', function () {
      if (this.value) {
        linkSuggestion.style.display = 'none';
      } else if (platformSelect) {
        generateSuggestedLink();
      }
    });
  }

  // Inicializar sugestão
  setTimeout(generateSuggestedLink, 100);

  // Função auxiliar para toast local (sobrescreve a global
  // apenas dentro deste módulo, igual ao comportamento original)
  function showToast(message, type) {
    let toastContainer = document.querySelector('.toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container';
      toastContainer.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9999;';
      document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.style.cssText = `
      background: var(--card-bg);
      border-left: 4px solid ${type === 'success' ? 'var(--success)' : 'var(--primary)'};
      padding: 0.75rem 1.25rem;
      border-radius: 12px;
      margin-top: 0.5rem;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 0.85rem;
      display: flex;
      align-items: center;
      gap: 8px;
      animation: slideIn 0.3s ease;
    `;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : 'fa-info-circle'}" style="color: ${type === 'success' ? 'var(--success)' : 'var(--primary)'}"></i> ${message}`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Estilo adicional para animação
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100px); opacity: 0; }
    }
    .quick-duration:active {
      transform: scale(0.95);
    }
  `;
  document.head.appendChild(style);
})();
