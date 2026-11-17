// assets/js/welcome-media.js

(() => {
    let overlay;
    let box;
    let content;
    let closeBtn;
    let titlebar;

    // Guarda a mídia carregada
    window._welcomeMedia = null;

    function initElements() {
        overlay = document.getElementById("welcomeMediaOverlay");
        box = document.querySelector(".welcome-media-box");
        content = document.getElementById("welcomeMediaContent");
        closeBtn = document.getElementById("welcomeMediaClose");

        if (!overlay || !box || !content || !closeBtn) {
            console.warn("Modal de mídia de boas-vindas não encontrado.");
            return false;
        }

        closeBtn.addEventListener("click", closeModal);

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                closeModal();
            }
        });

        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && overlay.classList.contains("active")) {
                closeModal();
            }
        });

        return true;
    }

    function closeModal() {
        overlay.classList.remove("active");
        overlay.classList.remove("show");

        document.body.style.overflow = "";

        const video = content.querySelector("video");
        if (video) {
            video.pause();
        }

        setTimeout(() => {
            content.innerHTML = "";
            removeTitlebar();
        }, 300);
    }

    function removeTitlebar() {
        if (titlebar) {
            titlebar.remove();
            titlebar = null;
        }
    }

    function extrairYoutubeId(url) {
        if (url.includes("watch?v=")) {
            return new URL(url).searchParams.get("v");
        } else if (url.includes("youtu.be/")) {
            return url.split("youtu.be/")[1].split("?")[0];
        } else if (url.includes("/shorts/")) {
            return url.split("/shorts/")[1].split("?")[0];
        }
        return null;
    }

    async function buscarTituloYoutube(url) {
        try {
            const resp = await fetch(
                `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
            );
            if (!resp.ok) return null;
            const data = await resp.json();
            return data.title || null;
        } catch (err) {
            console.warn("Não foi possível buscar o título do vídeo:", err);
            return null;
        }
    }

    function mostrarTitlebar(titulo) {
        removeTitlebar();

        titlebar = document.createElement("div");
        titlebar.className = "welcome-media-titlebar";
        titlebar.innerHTML = `
            <i class="fas fa-play-circle"></i>
            <span>${titulo}</span>
        `;

        box.insertBefore(titlebar, content);
        box.classList.add("has-title");
    }

    window.openWelcomeMedia = function (tipo, url) {

        if (!url) return;

        if (!overlay) {
            if (!initElements()) return;
        }

        content.innerHTML = "";
        removeTitlebar();
        box.classList.remove("has-title");

        // ==========================
        // YOUTUBE
        // ==========================
        const isYoutube =
            url.includes("youtube.com") ||
            url.includes("youtu.be");

        if (tipo === "video") {

            if (isYoutube) {

                const videoId = extrairYoutubeId(url);

                content.innerHTML = `
                    <div style="
                        width:100%;
                        height:100%;
                        background:#000;
                    ">
                        <iframe
                            src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0"
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                            allowfullscreen
                            style="
                                width:100%;
                                height:100%;
                                border:0;
                                display:block;
                            ">
                        </iframe>
                    </div>
                `;

                // Busca o título real do YouTube e injeta a titlebar
                buscarTituloYoutube(url).then((titulo) => {
                    if (titulo) {
                        mostrarTitlebar(titulo);
                    }
                });

            } else {

                const video = document.createElement("video");

                video.src = url;

                video.controls = true;
                video.autoplay = true;
                video.muted = true;
                video.defaultMuted = true;
                video.playsInline = true;

                video.style.width = "100%";
                video.style.height = "100%";
                video.style.objectFit = "contain";

                content.appendChild(video);

                video.play().catch(() => {});
            }

        } else {

            const img = document.createElement("img");

            img.src = url;
            img.alt = "Boas-vindas";

            img.style.width = "100%";
            img.style.height = "100%";
            img.style.objectFit = "contain";

            content.appendChild(img);
        }

        overlay.classList.add("active");
        overlay.classList.add("show");

        document.body.style.overflow = "hidden";
    };

    async function loadActiveMedia() {

        try {

            const resp = await fetch('/api/conteudo-ativo');
            if (!resp.ok) return;
            const dados = await resp.json();
            const media = dados && dados.midia;

            if (!media || !/^https:\/\//.test(media.url || '')) {
                window._welcomeMedia = null;
                return;
            }

            window._welcomeMedia = {
                tipo: media.tipo,
                url: media.url
            };

            // Abre automaticamente ao entrar
            window.openWelcomeMedia(media.tipo, media.url);

        } catch (err) {

            console.error(err);

        }

    }

    document.addEventListener("DOMContentLoaded", async () => {

        if (!initElements()) return;

        await loadActiveMedia();

        // tenta novamente após o dashboard terminar de carregar
        if (!window._welcomeMedia) {
            setTimeout(loadActiveMedia, 2000);
        };

    });

})();