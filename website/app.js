const API_BASE_URL = window.location.origin;

// DOM Elements
let loginOverlay, loginInput, loginButton, loginStatus;
let logoutButton;
let musicUrlInput, musicActionButton, musicStatusMessage;
let playlistNameInput, playlistOptionsGroup, plexUserSelect;
let musicProgressContainer, musicCurrentSong, musicPercentText, musicProgressFill, musicStatusText;
let manualLinkInput, manualTitleInput, manualSendButton, manualStatusMessage;
let refreshDownloadsButton, autoRefreshCheckbox, downloadsList, downloadsStatus;
let refreshPlexButton, refreshStatusMessage;

let musicPollInterval = null;
let autoRefreshInterval = null;
let plexUserChoices;

document.addEventListener('DOMContentLoaded', function() {
    // Login Elements
    loginOverlay = document.getElementById('login-overlay');
    loginInput = document.getElementById('login-password-input');
    loginButton = document.getElementById('login-button');
    loginStatus = document.getElementById('login-status-message');

    // Check session on load
    checkSession();

    // Login Events
    loginButton.addEventListener('click', handleLogin);
    loginInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleLogin();
    });
});

function initializeAppContent() {
    // Manual Add Elements
    manualLinkInput = document.getElementById('manual-link');
    manualTitleInput = document.getElementById('manual-title');
    manualSendButton = document.getElementById('manual-send-button');
    manualStatusMessage = document.getElementById('manual-status-message');

    // Music Elements
    musicUrlInput = document.getElementById('music-url-input');
    musicActionButton = document.getElementById('music-action-button'); 
    playlistNameInput = document.getElementById('playlist-name-input');
    playlistOptionsGroup = document.getElementById('playlist-options-group');
    musicStatusMessage = document.getElementById('music-status-message');
    plexUserSelect = document.getElementById('plex-user-select');
    
    // Music Progress Elements
    musicProgressContainer = document.getElementById('music-progress-container');
    musicCurrentSong = document.getElementById('music-current-song');
    musicPercentText = document.getElementById('music-percent-text');
    musicProgressFill = document.getElementById('music-progress-fill');
    musicStatusText = document.getElementById('music-status-text');

    // Download Status Elements
    refreshDownloadsButton = document.getElementById('refresh-downloads');
    autoRefreshCheckbox = document.getElementById('auto-refresh');
    downloadsList = document.getElementById('downloads-list');
    downloadsStatus = document.getElementById('downloads-status');

    // Other Elements
    refreshPlexButton = document.getElementById('refresh-plex-button');
    refreshStatusMessage = document.getElementById('refresh-status-message');
    logoutButton = document.getElementById('logout-button');

    setupEventListeners();    
    console.log("CineVault-Lite Initialized");
}

async function checkSession() {
    try {
        const response = await fetch(`${API_BASE_URL}/check-session`);
        const data = await response.json();

        if (data.isLoggedIn) {
            showApp();
        } else {
            showLoginScreen();
        }
    } catch (error) {
        console.error("Session check failed", error);
        showLoginScreen("Cannot contact server.");
    }
}

async function handleLogin() {
    const password = loginInput.value;
    if (!password) {
        updateLoginStatus("Please enter a password.", 'error');
        return;
    }

    setButtonLoading(loginButton, true);
    updateLoginStatus("Verifying...", 'info');

    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Unknown error");
        }

        showApp();

    } catch (error) {
        updateLoginStatus(error.message, 'error');
    } finally {
        setButtonLoading(loginButton, false);
    }
}

function showApp() {
    loginOverlay.style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    initializeAppContent(); 
    checkServerStatus(); 
}

function showLoginScreen(error = null) {
    loginOverlay.style.display = 'flex';
    document.querySelector('.container').style.display = 'none';
    if (error) {
        updateLoginStatus(error, 'error');
    }
}

function updateLoginStatus(message, type = 'info') {
    loginStatus.textContent = message;
    loginStatus.className = `status-message ${type}`;
}

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_BASE_URL}/status`);
        if (response.ok) {
            console.log("Server Online");
        }
    } catch (error) {
        console.error("Server Offline:", error);
    }
}

function setupEventListeners() {
    // Navigation
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            const targetPage = this.dataset.page;
            if(!targetPage) return; // For Logout button which has no data-page
            
            showPage(targetPage);
            
            // Auto-refresh logic for downloads page
            if (targetPage === 'downloads') {
                startAutoRefresh();
                loadDownloadStatus();
            } else {
                stopAutoRefresh();
            }
            
            // Update active state
            navButtons.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
        });
    });

    // Manual Add
    if (manualSendButton) {
        manualSendButton.addEventListener('click', handleManualSend);
    }

    // Music
    if (musicActionButton) {
        musicActionButton.addEventListener('click', handleMusicAction);
    }

    const musicModeInputs = document.querySelectorAll('input[name="musicMode"]');
    musicModeInputs.forEach(input => {
        input.addEventListener('change', function() {
            if (this.value === 'playlist') {
                playlistOptionsGroup.classList.remove('hidden');
                musicActionButton.querySelector('.btn-text').textContent = "Create Plex Playlist";
                musicUrlInput.placeholder = "Public Spotify Playlist Link";
                loadPlexUsers(); 
            } else {
                playlistOptionsGroup.classList.add('hidden');
                musicActionButton.querySelector('.btn-text').textContent = "Start Download";
                musicUrlInput.placeholder = "Spotify or YouTube Link";
            }
        });
    });

    // Refresh Plex
    if (refreshPlexButton) {
        refreshPlexButton.addEventListener('click', handlePlexRefresh);
    }

    // Downloads
    if (refreshDownloadsButton) {
        refreshDownloadsButton.addEventListener('click', loadDownloadStatus);
    }
    if (autoRefreshCheckbox) {
        autoRefreshCheckbox.addEventListener('change', function() {
            if (this.checked) startAutoRefresh();
            else stopAutoRefresh();
        });
    }

    // Logout
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
}

function showPage(pageId) {
    document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
    const target = document.getElementById(`${pageId}-page`);
    if (target) target.classList.add('active');
    window.scrollTo(0, 0);
}

// --- FEATURE: MANUAL ADD ---
async function handleManualSend() {
    const link = manualLinkInput.value.trim();
    const title = manualTitleInput.value.trim();
    const type = document.querySelector('input[name="manualType"]:checked').value;

    if (!link) {
        updateManualStatus("Download link is required.", 'error');
        return;
    }

    setButtonLoading(manualSendButton, true);
    updateManualStatus("Sending to JDownloader...", 'info');

    try {
        const response = await fetch(`${API_BASE_URL}/direct-download`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ link, title, type })
        });

        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Unknown Error");

        updateManualStatus("✅ " + data.message, 'success');
        
        // Clear inputs
        manualLinkInput.value = '';
        manualTitleInput.value = '';
        
        // Switch to downloads tab after 1.5s
        setTimeout(() => {
            document.querySelector('.nav-btn[data-page="downloads"]').click();
        }, 1500);

    } catch (error) {
        updateManualStatus("❌ " + error.message, 'error');
    } finally {
        setButtonLoading(manualSendButton, false);
    }
}

function updateManualStatus(message, type) {
    if (manualStatusMessage) {
        manualStatusMessage.textContent = message;
        manualStatusMessage.className = `status-message ${type}`;
    }
}

// --- FEATURE: MUSIC ---
async function handleMusicAction() {
    const url = musicUrlInput.value.trim();
    const mode = document.querySelector('input[name="musicMode"]:checked').value;
    
    if (!url) {
        updateMusicStatus("Please enter a URL", 'error');
        return;
    }

    let playlistName = "";
    let targetUserId = "main";

    if (mode === 'playlist') {
        playlistName = playlistNameInput.value.trim();
        targetUserId = plexUserSelect.value; 

        if (!playlistName) {
            updateMusicStatus("Please enter a Playlist Name", 'error');
            return;
        }
    }

    setButtonLoading(musicActionButton, true);
    
    if (mode === 'download') {
        // Download Mode
        updateMusicStatus("Starting download...", 'info');
        startMusicPolling(); // Start progress tracking
        try {
            const response = await fetch(`${API_BASE_URL}/download-music`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
            
            updateMusicStatus(data.message, 'success');
            musicUrlInput.value = '';
        } catch (error) {
            updateMusicStatus(`Error: ${error.message}`, 'error');
        } finally {
            setButtonLoading(musicActionButton, false);
        }

    } else {
        // Playlist Sync Mode
        updateMusicStatus(`Analyzing and syncing for selected user...`, 'info');
        try {
            const response = await fetch(`${API_BASE_URL}/sync-playlist`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    url, 
                    name: playlistName,
                    userId: targetUserId
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
            
            updateMusicStatus(`✅ ${data.message}`, 'success');
            musicUrlInput.value = '';
            playlistNameInput.value = '';
        } catch (error) {
            console.error(error);
            updateMusicStatus(`❌ Error: ${error.message}`, 'error');
        } finally {
            setButtonLoading(musicActionButton, false);
        }
    }
}

function updateMusicStatus(message, type = 'info') {
    if (musicStatusMessage) {
        musicStatusMessage.textContent = message;
        musicStatusMessage.className = `status-message ${type}`;
    }
}

function startMusicPolling() {
    if (musicPollInterval) clearInterval(musicPollInterval);
    
    musicProgressContainer.classList.remove('hidden');
    musicProgressFill.style.width = '0%';
    musicPercentText.textContent = '0%';
    musicCurrentSong.textContent = "Starting...";
    
    musicPollInterval = setInterval(async () => {
        try {
            const response = await fetch(`${API_BASE_URL}/music-status`);
            if (!response.ok) return;
            
            const state = await response.json();

            musicProgressFill.style.width = state.progress + '%';
            musicPercentText.textContent = state.progress + '%';
            
            if (state.totalSongs > 1) {
                musicStatusText.textContent = `Tracks: ${state.downloadedCount} / ${state.totalSongs}`;
                musicCurrentSong.textContent = state.currentSong;
            } else {
                musicStatusText.textContent = state.message;
                musicCurrentSong.textContent = state.currentSong || "Downloading...";
            }

            if (!state.isDownloading) {
                clearInterval(musicPollInterval);
                if (state.progress === 100) {
                     updateMusicStatus("✅ Download Complete!", 'success');
                     musicProgressFill.style.background = "var(--success)";
                     setTimeout(() => {
                        musicProgressContainer.classList.add('hidden');
                        musicProgressFill.style.background = ""; 
                     }, 4000);
                }
            }
        } catch (e) { console.error("Polling error", e); }
    }, 1000);
}

// --- FEATURE: PLEX USERS (Choices.js) ---
async function loadPlexUsers() {
    if (plexUserSelect.options.length > 1) return;

    try {
        const response = await fetch(`${API_BASE_URL}/plex-users`);
        const users = await response.json();
        
        plexUserSelect.innerHTML = ''; 
        
        const choicesData = users.map(user => ({
            value: user.id,
            label: user.title,
            selected: false,
            customProperties: { description: 'Plex User' } 
        }));

        if (plexUserChoices) {
            plexUserChoices.destroy();
        }

        plexUserChoices = new Choices(plexUserSelect, {
            choices: choicesData,
            searchEnabled: false,
            itemSelectText: '',
            shouldSort: false,
            position: 'auto'
        });

    } catch (error) {
        console.error("Error loading users:", error);
        plexUserSelect.innerHTML = '<option value="main">Main Account (Load Error)</option>';
    }
}

// --- FEATURE: DOWNLOAD STATUS ---
function startAutoRefresh() {
    stopAutoRefresh();
    if (autoRefreshCheckbox && autoRefreshCheckbox.checked) {
        autoRefreshInterval = setInterval(loadDownloadStatus, 10000);
    }
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

async function loadDownloadStatus() {
    if (!refreshDownloadsButton) return;
    setButtonLoading(refreshDownloadsButton, true);
    
    try {
        const response = await fetch(`${API_BASE_URL}/download-status`);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
        displayDownloadStatus(data);
    } catch (error) {
        console.error("JD Status Error:", error);
        displayDownloadStatus([]);
    } finally {
        setButtonLoading(refreshDownloadsButton, false);
    }
}

function displayDownloadStatus(downloads) {
    if (!downloadsList) return;
    downloadsList.innerHTML = '';

    if (!downloads || downloads.length === 0) {
        downloadsList.innerHTML = `
            <div class="no-downloads">
                <i class="no-downloads-icon">📭</i>
                <h3>No active downloads</h3>
                <p>Active downloads will appear here</p>
            </div>
        `;
        return;
    }

    downloads.forEach(download => {
        const downloadItem = document.createElement('div');
        downloadItem.className = 'download-item';
        const progress = download.percent || 0;
        const fileName = download.name || 'Unknown File';
        
        downloadItem.innerHTML = `
            <div class="download-info">
                <div class="download-name" data-fullname="${fileName}">${fileName}</div>
            </div>
            <div class="download-progress">
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progress}%"></div>
                </div>
                <div class="progress-text">${Math.round(progress)}%</div>
            </div>
        `;
        downloadsList.appendChild(downloadItem);
    });
}

// --- FEATURE: REFRESH PLEX ---
async function handlePlexRefresh() {
    setButtonLoading(refreshPlexButton, true);
    updateRefreshStatus("Triggering Plex Scan...", 'info'); 

    try {
        const response = await fetch(`${API_BASE_URL}/refresh-plex`, { method: 'POST' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
        updateRefreshStatus(data.message, 'success'); 
    } catch (error) {
        console.error("Refresh Plex Error:", error);
        updateRefreshStatus(`Error: ${error.message}`, 'error');
    } finally {
        setButtonLoading(refreshPlexButton, false);
    }
}

function updateRefreshStatus(message, type = 'info') {
    if (refreshStatusMessage) {
        refreshStatusMessage.textContent = message;
        refreshStatusMessage.className = `status-message ${type}`;
    }
}

// --- UTILS ---
async function handleLogout() {
    try {
        await fetch(`${API_BASE_URL}/logout`, { method: 'POST' });
    } catch (error) {
        console.error("Logout error:", error);
    } finally {
        showLoginScreen();
        location.reload();
    }
}

function setButtonLoading(button, isLoading) {
    if (!button) return;
    const spinner = button.querySelector('.spinner');
    const buttonText = button.querySelector('.btn-text') || button.querySelector('span');
    
    if (isLoading) {
        button.disabled = true;
        if (spinner) spinner.classList.add('active');
        if (buttonText) buttonText.style.opacity = '0.7';
    } else {
        button.disabled = false;
        if (spinner) spinner.classList.remove('active');
        if (buttonText) buttonText.style.opacity = '1';
    }
}