// ============================================
// SIDEBAR MOBILE — abre/fecha o menu lateral em telas pequenas
// Depende das classes já existentes no dashboard.css:
//   .sidebar.mobile-open   -> mostra a sidebar como drawer
//   .sidebar-overlay.active -> escurece o fundo
//   body.sidebar-open       -> trava o scroll da página
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.getElementById('sidebar');
    const menuToggle = document.getElementById('menuToggle');
    const sidebarOverlay = document.getElementById('sidebarOverlay');
    const sidebarClose = document.getElementById('sidebarClose');

    if (!sidebar || !menuToggle || !sidebarOverlay) {
        console.warn('Sidebar mobile: elementos #menuToggle ou #sidebarOverlay não encontrados no HTML.');
        return;
    }

    const openSidebar = () => {
        sidebar.classList.add('mobile-open');
        sidebarOverlay.classList.add('active');
        document.body.classList.add('sidebar-open');
        menuToggle.setAttribute('aria-expanded', 'true');
    };

    const closeSidebar = () => {
        sidebar.classList.remove('mobile-open');
        sidebarOverlay.classList.remove('active');
        document.body.classList.remove('sidebar-open');
        menuToggle.setAttribute('aria-expanded', 'false');
    };

    const toggleSidebar = () => {
        if (sidebar.classList.contains('mobile-open')) {
            closeSidebar();
        } else {
            openSidebar();
        }
    };

    menuToggle.addEventListener('click', toggleSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    if (sidebarClose) {
        sidebarClose.addEventListener('click', closeSidebar);
    }

    // Fecha o menu ao escolher uma opção de navegação (mobile)
    sidebar.querySelectorAll('.nav-link').forEach((link) => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                closeSidebar();
            }
        });
    });

    // Fecha com a tecla Esc
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && sidebar.classList.contains('mobile-open')) {
            closeSidebar();
        }
    });

    // Se a tela for redimensionada para desktop com o menu aberto, fecha
    window.addEventListener('resize', () => {
        if (window.innerWidth > 768 && sidebar.classList.contains('mobile-open')) {
            closeSidebar();
        }
    });
});