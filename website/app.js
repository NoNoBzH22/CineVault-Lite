document.addEventListener('DOMContentLoaded', () => {
    
    // --- INIT ICONS ---
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }

    // --- UTILS ---
    const dom = (id) => document.getElementById(id);
    const show = (el) => el && el.classList.remove('hidden');
    const hide = (el) => el && el.classList.add('hidden');
    
    const showToast = (msg) => {
        const t = dom('toast');
        if(!t) return;
        t.textContent = msg;
        show(t);
        setTimeout(() => hide(t), 3000);
    };

    const apiCall = async (endpoint, method = 'GET', body = null) => {
        try {
            const opts = {
                method,
                headers: { 'Content-Type': 'application/json' }
            };
            if (body) opts.body = JSON.stringify(body);
            
            const res = await fetch(endpoint, opts);
            const text = await res.text();
            
            if (!res.ok) {
                let err = `Error ${res.status}`;
                try { err = JSON.parse(text).error || err; } catch(e){}
                throw new Error(err);
            }
            return text ? JSON.parse(text) : {};
        } catch (e) {
            console.error(`API ${endpoint}:`, e);
            throw e;
        }
    };

    // --- STATE ---
    const state = {
        plexInventory: [],
        downloadInterval: null,
        musicInterval: null
    };

    const isInPlex = (title) => {
        if(!state.plexInventory.length) return false;
        const clean = (s) => String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
        return state.plexInventory.some(p => clean(p.title) === clean(title));
    };

    // --- NAVIGATION ---
    const navLinks = document.querySelectorAll('.nav-links li[data-target]');
    const sections = document.querySelectorAll('.section');

    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            
            const targetId = link.dataset.target;
            sections.forEach(s => hide(s));
            show(dom(targetId));

            // Logic Hooks
            if(targetId === 'section-downloads') loadDownloads();
        });
    });

    // --- LOGIN ---
    const loginForm = dom('login-form');
    if(loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = loginForm.querySelector('button');
            const pass = dom('api-password').value;
            const err = dom('login-error');
            
            btn.disabled = true;
            hide(err);

            try {
                const res = await apiCall('/login', 'POST', { password: pass });
                if (res.success) {
                    initApp();
                } else {
                    show(err);
                }
            } catch (e) {
                err.textContent = "Server error";
                show(err);
            } finally {
                btn.disabled = false;
            }
        });
    }

    const checkSession = async () => {
        try {
            const res = await apiCall('/check-session');
            if (res.isLoggedIn) initApp();
        } catch (e) {}
    };

    const initApp = async () => {
        hide(dom('login-overlay'));
        show(dom('app-container'));
        
        try {
            state.plexInventory = await apiCall('/plex-inventory');
        } catch(e) {}

        loadTrending();
        startLoops();
        lucide.createIcons();
    };

    const startLoops = () => {
        loadDownloads();
        state.downloadInterval = setInterval(loadDownloads, 8000);
        state.musicInterval = setInterval(updateMusicStatus, 1000);
    };

    // --- UTILS: BLOCKING LOADER ---
    const toggleBlockingLoader = (show, msg = "Processing...") => {
        let loader = document.getElementById('blocking-loader');
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'blocking-loader';
            loader.className = 'hidden';
            loader.innerHTML = `<div class="loader"></div><p id="blocking-msg"></p>`;
            document.body.appendChild(loader);
        }
        
        if (show) {
            document.getElementById('blocking-msg').textContent = msg;
            loader.classList.remove('hidden');
        } else {
            loader.classList.add('hidden');
        }
    };

    // --- TRENDING & CARDS ---
    const createCard = (movie) => {
        const div = document.createElement('div');
        div.className = 'card';
        const onPlex = isInPlex(movie.title);
        const badge = onPlex ? `<div class="plex-badge">ON PLEX</div>` : '';

        div.innerHTML = `
            <div class="poster-container">
                <img src="${movie.image || ''}" loading="lazy" alt="${movie.title}">
                ${badge}
            </div>
            <div class="card-info">
                <div class="card-title">${movie.title}</div>
                <div class="card-year">${movie.year || ''}</div>
            </div>
        `;
        div.addEventListener('click', () => handleSelection(movie));
        return div;
    };

    const loadTrending = async () => {
        const grid = dom('trending-grid');
        if(!grid) return;
        try {
            const movies = await apiCall('/trending');
            grid.innerHTML = '';
            movies.forEach(m => grid.appendChild(createCard(m)));
        } catch (e) {
            grid.innerHTML = '<p style="padding:1rem">Error loading trending items</p>';
        }
    };

    // --- SEARCH ---
    const searchBtn = dom('btn-search-trigger');
    if(searchBtn) {
        searchBtn.addEventListener('click', async () => {
            const q = dom('search-input').value.trim();
            if (!q) return;
            
            const grid = dom('search-results');
            const type = document.querySelector('input[name="search-type"]:checked').value;
            
            grid.innerHTML = '<div class="loader-wrapper"><div class="loader"></div></div>';
            
            try {
                const res = await apiCall('/search', 'POST', { title: q, mediaType: type });
                grid.innerHTML = '';
                if(!res || !res.length) grid.innerHTML = '<p style="padding:1rem">No results found.</p>';
                else res.forEach(m => grid.appendChild(createCard(m)));
            } catch (e) {
                grid.innerHTML = `<p style="padding:1rem">Error: ${e.message}</p>`;
            }
        });
    }

    // --- MODAL ---
    const handleSelection = async (movie) => {
        showModal(movie.title, '<div class="loader-wrapper"><div class="loader"></div></div>');
        try {
            // Logique pour différencier tendance (hrefPath download) ou recherche
            let ep = '/select-movie';
            if(movie.hrefPath && movie.hrefPath.includes('download')) ep = '/select-trending';
            
            const data = await apiCall(ep, 'POST', { hrefPath: movie.hrefPath || '', title: movie.title });
            renderModalOptions(data);
        } catch (e) {
            dom('modal-body').innerHTML = `<p style="color:red">${e.message}</p>`;
        }
    };
    // --- HELPER: TRI QUALITÉ (V1 Logic) ---
    const parseSizeToMB = (sizeStr) => {
        if (!sizeStr) return Infinity;
        const match = sizeStr.match(/([\d.,]+)\s*(gb|mb|ko|kb|tb)/i);
        if (!match) return Infinity;
        let size = parseFloat(match[1].replace(',', '.'));
        const unit = match[2].toLowerCase();
        if (unit.includes('gb') || unit.includes('go')) size *= 1024;
        else if (unit.includes('tb')) size *= 1024 * 1024;
        else if (unit.includes('kb') || unit.includes('ko')) size /= 1024;
        return size;
    };

    const getQualityRank = (qualityString) => {
        const lower = qualityString.toLowerCase();
        if (lower.includes("ultra hdlight") && lower.includes("x265")) return 1;
        if (lower.includes("1080p") && lower.includes("x265") || lower.includes("1080p light") && lower.includes("x265")) return 2;
        // 3. Le reste
        return 3;
    };
    const renderModalOptions = (data) => {
        const body = dom('modal-body');
        body.innerHTML = '';

        // Saisons
        if (data.seasons && data.seasons.length) {
            const h4 = document.createElement('h4'); 
            h4.textContent = "Seasons"; h4.className = "modal-subtitle";
            body.appendChild(h4);
            
            data.seasons.forEach(s => {
                const btn = document.createElement('button');
                btn.className = 'option-btn';
                btn.innerHTML = `<span>${s.label}</span> <i data-lucide="chevron-right"></i>`;
                btn.onclick = async () => {
                    body.innerHTML = '<div class="loader-wrapper"><div class="loader"></div></div>';
                    const res = await apiCall('/select-season', 'POST', { seasonValue: s.value });
                    renderModalOptions(res);
                };
                body.appendChild(btn);
            });
        }

        // Qualités (Trié + Sécurisé)
        if (data.clientOptions && data.clientOptions.length) {
            const h4 = document.createElement('h4'); 
            h4.textContent = "Available Files"; h4.className = "modal-subtitle";
            body.appendChild(h4);

            // LOGIQUE DE TRI
            const sortedOptions = data.clientOptions.map(q => ({
                ...q,
                sizeVal: parseSizeToMB(q.size),
                rank: getQualityRank(q.quality)
            })).sort((a, b) => {
                if (a.rank !== b.rank) return a.rank - b.rank;
                return a.sizeVal - b.sizeVal;
            });

            sortedOptions.forEach(q => {
                const btn = document.createElement('button');
                
                let specialClass = '';
                let icon = '';
                if(q.rank === 1) { specialClass = 'quality-gold'; icon = '⭐'; }
                else if(q.rank === 2) { specialClass = 'quality-blue'; icon = '✨'; }

                btn.className = `option-btn ${specialClass}`;
                
                btn.innerHTML = `
                    <div class="opt-left">
                        <div class="opt-title">
                            ${icon} ${q.episode ? 'Ep. '+q.episode : 'Movie'} 
                            <span class="quality-tag">${q.quality}</span>
                        </div>
                        <div class="opt-meta">${q.size || 'Unknown size'}</div>
                    </div>
                    <i data-lucide="download" class="opt-icon"></i>
                `;
                
                btn.onclick = async () => {
                    hide(dom('modal-overlay'));
                    
                    toggleBlockingLoader(true, "Retrieving movie...");

                    try {
                        await apiCall('/get-link', 'POST', { chosenId: q.id });
                        
                        toggleBlockingLoader(false);
                        showToast('Link sent to JDownloader!');
                        loadDownloads();

                        // Optionnel : Basculer automatiquement sur l'onglet téléchargement
                        dom('section-downloads').click(); // si tu veux rediriger

                    } catch (e) {
                        toggleBlockingLoader(false);
                        showToast("Error: " + e.message);
                        // Optionnel : On rouvre la modale pour laisser l'utilisateur réessayer ?
                        show(dom('modal-overlay')); 
                    }
                };
                body.appendChild(btn);
            });
        }
        lucide.createIcons();
    };

    const showModal = (title, content) => {
        dom('modal-title').textContent = title;
        dom('modal-body').innerHTML = content;
        show(dom('modal-overlay'));
    };
    
    dom('modal-close').onclick = () => hide(dom('modal-overlay'));

    // --- DOWNLOADS (LIST) ---
    const loadDownloads = async () => {
        const list = dom('downloads-list');
        if(!list) return;
        
        try {
            const data = await apiCall('/download-status');
            list.innerHTML = '';
            
            if(!data || !data.length) {
                list.innerHTML = `
                    <div class="empty-state-modern">
                        <i data-lucide="hard-drive-download"></i>
                        <p>No active downloads</p>
                    </div>`;
                lucide.createIcons();
                return;
            }

            data.forEach(dl => {
                const item = document.createElement('div');
                item.className = 'dl-card'; // Nouvelle classe CSS
                
                // Calcul couleur progress bar (vert si fini, bleu si en cours)
                const isDone = dl.percent >= 100;
                const barColor = isDone ? 'var(--success)' : 'var(--accent)';
                
                item.innerHTML = `
                    <div class="dl-icon">
                        <i data-lucide="${isDone ? 'check-circle' : 'loader-2'}" class="${!isDone ? 'spin-slow' : ''}"></i>
                    </div>
                    <div class="dl-content">
                        <div class="dl-header">
                            <span class="dl-title">${dl.name}</span>
                            <span class="dl-percentage">${Math.round(dl.percent)}%</span>
                        </div>
                        <div class="dl-bar-bg">
                            <div class="dl-bar-fill" style="width: ${dl.percent}%; background: ${barColor};">
                                <div class="dl-bar-glow"></div>
                            </div>
                        </div>
                        <div class="dl-status-text">${isDone ? 'Completed' : 'Downloading...'}</div>
                    </div>
                `;
                list.appendChild(item);
            });
            lucide.createIcons();
        } catch(e) {}
    };
    
    dom('btn-refresh-downloads').onclick = loadDownloads;

    // --- MUSIC ---
    const musicTabs = document.querySelectorAll('.tab-btn');
    musicTabs.forEach(t => {
        t.onclick = () => {
            musicTabs.forEach(b => b.classList.remove('active'));
            t.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(c => hide(c));
            show(dom(t.dataset.tab));
            
            if(t.dataset.tab === 'music-playlist') loadPlexUsers();
        };
    });

    const loadPlexUsers = async () => {
        try {
            const users = await apiCall('/plex-users');
            const sel = dom('plex-users-select');
            sel.innerHTML = '';
            users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.title;
                sel.appendChild(opt);
            });
        } catch(e) {}
    };

    dom('music-dl-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            await apiCall('/download-music', 'POST', { url: dom('music-url').value });
            dom('music-url').value = '';
            showToast('Music started!');
        } catch(e) { showToast(e.message); }
    };

    const updateMusicStatus = async () => {
        try {
            const s = await apiCall('/music-status');
            const card = dom('music-status-card');
            
            if(s.isDownloading || s.progress > 0) {
                show(card);
                dom('music-current-song').textContent = s.currentSong || "Waiting...";
                dom('music-progress-bar').style.width = s.progress + '%';
                dom('music-percent').textContent = s.progress + '%';
                dom('music-message').textContent = s.message || '';
            } else {
                hide(card);
            }
        } catch(e) {}
    };

    // --- MANUAL ---
    dom('manual-form').onsubmit = async (e) => {
        e.preventDefault();
        try {
            const type = document.querySelector('input[name="manual-type"]:checked').value;
            await apiCall('/direct-download', 'POST', {
                link: dom('manual-link').value,
                title: dom('manual-name').value,
                type
            });
            dom('manual-link').value = '';
            showToast('Sent!');
        } catch(e) { showToast(e.message); }
    };

    // --- REFRESH ---
    dom('btn-refresh-plex').onclick = async () => {
        try {
            await apiCall('/refresh-plex', 'POST');
            showToast('Scanning Plex...');
        } catch(e) { showToast(e.message); }
    };

    dom('btn-logout').onclick = async () => {
        await apiCall('/logout', 'POST');
        location.reload();
    };

    // Start
    checkSession();
});
