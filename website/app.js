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
        downloadInterval: null,
        musicInterval: null
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

            // Refresh specific data when entering section
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
        
        // Initial Loads
        loadDownloads();
        
        // Start Auto-Refresh Loops
        startLoops();
        
        lucide.createIcons();
    };

    const startLoops = () => {
        // Refresh downloads every 8 seconds
        state.downloadInterval = setInterval(loadDownloads, 8000);
        // Check music status every 1 second (fast UI update)
        state.musicInterval = setInterval(updateMusicStatus, 1000);
    };

    // --- DOWNLOADS (JDownloader) ---
    const loadDownloads = async () => {
        const list = dom('downloads-list');
        if(!list) return;
        
        try {
            const data = await apiCall('/download-status');
            list.innerHTML = '';
            
            if(!data || !data.length) {
                list.innerHTML = `
                    <div class="empty-state">
                        <p>No active downloads</p>
                    </div>`;
                lucide.createIcons();
                return;
            }

            data.forEach(dl => {
                const item = document.createElement('div');
                item.className = 'dl-card'; 
                
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
                            <div class="dl-bar-fill" style="width: ${dl.percent}%; background: ${barColor};"></div>
                        </div>
                        <div class="dl-status-text">${isDone ? 'Completed' : 'Downloading...'}</div>
                    </div>
                `;
                list.appendChild(item);
            });
            lucide.createIcons();
        } catch(e) {}
    };
    
    // Refresh button manually triggers load
    const refreshBtn = dom('btn-refresh-downloads');
    if(refreshBtn) refreshBtn.onclick = loadDownloads;

    // --- MUSIC HUB ---
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

    // 1. Download Music (SpotDL)
    const musicForm = dom('music-dl-form');
    if(musicForm) {
        musicForm.onsubmit = async (e) => {
            e.preventDefault();
            try {
                await apiCall('/download-music', 'POST', { url: dom('music-url').value });
                dom('music-url').value = '';
                showToast('Music started!');
            } catch(e) { showToast(e.message); }
        };
    }

    // 2. Sync Playlist (Plex Bridge)
    const playlistForm = dom('playlist-sync-form');
    if(playlistForm) {
        playlistForm.onsubmit = async (e) => {
            e.preventDefault();
            try {
                await apiCall('/sync-playlist', 'POST', {
                    url: dom('playlist-url').value,
                    name: dom('playlist-name').value,
                    userId: dom('plex-users-select').value
                });
                dom('playlist-url').value = '';
                showToast('Sync started!');
            } catch(e) { showToast(e.message); }
        };
    }

    // 3. Live Status Update
    const updateMusicStatus = async () => {
        try {
            const s = await apiCall('/music-status');
            const card = dom('music-status-card');
            if(!card) return;

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

    // --- MANUAL ADD (JDownloader) ---
    const manualForm = dom('manual-form');
    if(manualForm) {
        manualForm.onsubmit = async (e) => {
            e.preventDefault();
            try {
                const type = document.querySelector('input[name="manual-type"]:checked').value;
                await apiCall('/direct-download', 'POST', {
                    link: dom('manual-link').value,
                    title: dom('manual-name').value,
                    type
                });
                dom('manual-link').value = '';
                showToast('Link sent to JDownloader!');
            } catch(e) { showToast(e.message); }
        };
    }

    // --- PLEX ACTIONS ---
    const refreshPlexBtn = dom('btn-refresh-plex');
    if(refreshPlexBtn) {
        refreshPlexBtn.onclick = async () => {
            try {
                await apiCall('/refresh-plex', 'POST');
                showToast('Scanning Plex Library...');
            } catch(e) { showToast(e.message); }
        };
    }

    // --- LOGOUT ---
    const logoutBtn = dom('btn-logout');
    if(logoutBtn) {
        logoutBtn.onclick = async () => {
            await apiCall('/logout', 'POST');
            location.reload();
        };
    }

    // Start App
    checkSession();
});
