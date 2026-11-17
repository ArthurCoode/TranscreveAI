// assets/js/banner-display.js
(() => {

    function ensureContainer() {
        let el = document.getElementById('globalBannerBar');
        if (el) return el;

        el = document.createElement('div');
        el.id = 'globalBannerBar';
        el.style.cssText = `
            display:none;
            align-items:center;
            justify-content:space-between;
            gap:12px;
            flex-wrap:wrap;
            padding:0.8rem 1.5rem;
            font-family:'Inter', sans-serif;
            font-weight:500;
            font-size:0.9rem;
        `;
        el.innerHTML = `
            <div id="globalBannerContent" style="display:flex; align-items:center; gap:10px;"></div>
            <button id="globalBannerClose" style="background:none;border:none;color:inherit;opacity:0.85;cursor:pointer;font-size:1rem;">
                <i class="fas fa-times"></i>
            </button>
        `;
        document.body.prepend(el);

        el.querySelector('#globalBannerClose').addEventListener('click', () => {
            el.style.display = 'none';
            if (window._activeBannerId) {
                sessionStorage.setItem('banner_closed_' + window._activeBannerId, '1');
            }
        });

        return el;
    }

    function renderBanner(banner) {
        const el = ensureContainer();
        const content = el.querySelector('#globalBannerContent');

        const closedKey = 'banner_closed_' + banner.id;
        if (sessionStorage.getItem(closedKey)) {
            el.style.display = 'none';
            return;
        }

        window._activeBannerId = banner.id;
        const corValida = (c, padrao) => (/^#[0-9a-fA-F]{6}$/.test(c || '') ? c : padrao);
        el.style.background = corValida(banner.bg_color, '#4f46e5');
        el.style.color = corValida(banner.text_color, '#ffffff');

        // monta com DOM (textContent), nunca com innerHTML de dados do banco
        const icone = document.createElement('i');
        icone.className = 'fas ' + (/^fa-[a-z0-9-]+$/.test(banner.icon || '') ? banner.icon : 'fa-bell');
        const texto = document.createElement('span');
        texto.textContent = banner.message || '';

        content.replaceChildren();
        let linkSeguro = null;
        try {
            const u = new URL(banner.link || '');
            if (u.protocol === 'https:') linkSeguro = u.toString();
        } catch (e) { /* sem link */ }

        if (linkSeguro) {
            const a = document.createElement('a');
            a.href = linkSeguro;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.style.cssText = 'color:inherit; text-decoration:underline; display:flex; align-items:center; gap:8px;';
            a.append(icone, texto);
            content.append(a);
        } else {
            content.append(icone, ' ', texto);
        }

        el.style.display = 'flex';
    }

    async function loadActiveBanner() {
        try {
            const resp = await fetch('/api/conteudo-ativo');
            if (!resp.ok) return;
            const dados = await resp.json();
            if (dados && dados.banner) renderBanner(dados.banner);
        } catch (err) {
            console.error('Erro ao carregar banner:', err);
        }
    }

    document.addEventListener('DOMContentLoaded', loadActiveBanner);
})();