const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { spawn } = require('child_process');
require('dotenv').config();

// --- Configuration ---
// Keeping only necessary variables for manual mode
const CONFIG = {
    API_PASSWORD: process.env.API_PASSWORD,
    PLEX_IP: process.env.PLEX_IP,
    PLEX_TOKEN: process.env.PLEX_TOKEN,
    JD_HOST: process.env.JD_HOST,
    JD_API_PORT: process.env.JD_API_PORT,
    SECRET: process.env.SECRET,
    SPOTIFY_ID: process.env.SPOTIFY_CLIENT_ID,
    SPOTIFY_SECRET: process.env.SPOTIFY_CLIENT_SECRET,
    PLEX_SECTION_MOVIES: process.env.PLEX_SECTION_MOVIES,
    JD_WATCH_MOVIES:process.env.JD_WATCH_MOVIES, 
    JD_WATCH_SERIES:process.env.JD_WATCH_SERIES,
    MUSIC:process.env.MUSIC
};

const PATHS = {
    JD_WATCH: '/downloads', 
};

const app = express();
const PORT = 3000;

// --- Middleware Configuration ---
app.use(cors());
app.use(helmet());
app.use(express.json());
app.set('trust proxy', 1);
app.use(cookieParser());
app.use(session({
    store: new FileStore({
        path: './sessions',
        ttl: 48 * 60 * 60, 
        retries: 0          
    }),
    secret: CONFIG.SECRET, 
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // Set to true if using HTTPS
        maxAge: 48 * 60 * 60 * 1000
    }
}));

const apiLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

const authMiddleware = (req, res, next) => {
    if (req.session.isLoggedIn) {
        next();
    } else {
        res.status(401).json({ error: "Session expired or invalid. Please log in again." });
    }
};

// --- Global State ---
// Only keeping music state, as scraping is removed
let globalState = {
    musicDownloadState: {
        isDownloading: false,
        currentSong: null,
        progress: 0,
        message: "Waiting..."
    }
};

// --- UTILITY FUNCTIONS ---

// Create .crawljob file for JDownloader
async function sendToJDownloader(link, title, isSeries) {
    // Use unique filename to avoid conflicts
    const fileName = `manual_${Date.now()}.crawljob`;
    const filePath = path.join(PATHS.JD_WATCH, fileName);
    const lineEnding = '\r\n';

    let fileContent = `text=${link}${lineEnding}`;
    fileContent += `autoStart=TRUE${lineEnding}`;

    if (title) {
        // Sanitize title to avoid illegal characters in folder names
        const safeTitle = title.replace(/[<>:"/\\|?*]+/g, '').replace(/\.$/, '').trim();
        fileContent += `packageName=${safeTitle}${lineEnding}`;

        if (isSeries) {
            console.log(`[JD] Series detected (${title}), configuring path...`);
            // Specific folder structure for series
            const seriesDownloadFolder = `${CONFIG.JD_WATCH_SERIES}/${safeTitle}`;
            fileContent += `downloadFolder=${seriesDownloadFolder}${lineEnding}`;
        } else {
            console.log(`[JD] Movie detected (${title}), standard package.`);
            // Specific folder structure for movies
            const seriesDownloadFolder = `${CONFIG.JD_WATCH_MOVIES}/${safeTitle}`;
            fileContent += `downloadFolder=${seriesDownloadFolder}${lineEnding}`;
        }
    }

    try {
        await fs.promises.writeFile(filePath, fileContent);
        // Permissions for JD to read/delete the file
        await fs.promises.chmod(filePath, 0o666);
        console.log(`✅ JDownloader file created: ${fileName}`);
    } catch (error) {
        console.error(`❌ Error creating JD file (${fileName}):`, error.message);
        throw error; // Rethrow for the route handler
    }
}

// Download Music via SpotDL
async function downloadMusic(url) {
    globalState.musicDownloadState = {
        isDownloading: true,
        currentSong: "Analyzing...",
        progress: 0,
        message: "Starting...",
        totalSongs: 1,
        downloadedCount: 0
    };

    return new Promise((resolve, reject) => {
        const cleanUrl = url.split('?')[0].trim();
        // Basic URL validation
        if (!cleanUrl.includes('spotify.com') && !cleanUrl.includes('youtube.com') && !cleanUrl.includes('youtu.be')) {
             globalState.musicDownloadState.isDownloading = false;
             return reject(new Error("Unsupported URL (Spotify or YouTube only)"));
        }
        
        const command = 'spotdl';
        const args = [
            cleanUrl,
            '--format', 'ogg',
            '--output', `"${CONFIG.MUSIC}/{artist}/{album}/{track-number}. {title}.{output-ext}"`,
            '--client-id', CONFIG.SPOTIFY_ID,      
            '--client-secret', CONFIG.SPOTIFY_SECRET
        ];
        
        console.log(`[spotdl] Launching for: ${cleanUrl}`);

        const spotdlProcess = spawn(command, args, { 
            shell: true,
            env: {
                ...process.env,
                SPOTIPY_CLIENT_ID: CONFIG.SPOTIFY_ID,      
                SPOTIPY_CLIENT_SECRET: CONFIG.SPOTIFY_SECRET,
                PYTHONIOENCODING: 'utf-8'
            }
        });

       spotdlProcess.stdout.on('data', (data) => {
            const text = data.toString().trim();
            if (text) console.log(`[spotdl]: ${text}`); 
            
            // Detect total song count
            const foundMatch = text.match(/Found (\d+) songs/);
            if (foundMatch) {
                globalState.musicDownloadState.totalSongs = parseInt(foundMatch[1]);
                globalState.musicDownloadState.message = `Playlist: ${globalState.musicDownloadState.totalSongs} songs detected.`;
            }

            // Detect current song
            if (text.includes('Downloading "')) {
                const songName = text.substring(text.indexOf('"') + 1, text.lastIndexOf('"'));
                globalState.musicDownloadState.currentSong = songName;
            }

            // Progress tracking
            if (text.includes('Downloaded "') || text.includes('Skipping')) {
                globalState.musicDownloadState.downloadedCount++;
                const total = globalState.musicDownloadState.totalSongs;
                const current = globalState.musicDownloadState.downloadedCount;
                let percent = Math.round((current / total) * 100);
                if (percent > 99) percent = 99; 
                
                globalState.musicDownloadState.progress = percent;
                
                if (total > 1) {
                    globalState.musicDownloadState.message = `Progress: ${current} / ${total}`;
                } else {
                    globalState.musicDownloadState.message = "Finalizing...";
                }
            }
        });

        spotdlProcess.stderr.on('data', (data) => {
            console.log(`[spotdl LOG]: ${data.toString().trim()}`);
        });

        spotdlProcess.on('close', (code) => {
            globalState.musicDownloadState.isDownloading = false;
            
            if (code === 0) {
                globalState.musicDownloadState.progress = 100;
                globalState.musicDownloadState.downloadedCount = globalState.musicDownloadState.totalSongs;
                globalState.musicDownloadState.message = "Finished successfully!";
                resolve("Download complete!");
            } else {
                globalState.musicDownloadState.message = `Error (Code ${code})`;
                reject(new Error(`SpotDL Error (Code ${code})`));
            }
        });

        spotdlProcess.on('error', (err) => {
            globalState.musicDownloadState.isDownloading = false;
            reject(new Error("Failed to launch spotdl"));
        });
    });
}

// --- API ROUTES ---

// 1. Authentication
app.post('/login', (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: "Missing password." });

    try {
        const hash = (str) => crypto.createHash('sha256').update(str).digest('hex');
        const correctHash = hash(CONFIG.API_PASSWORD);
        const userHash = hash(password);

        if (crypto.timingSafeEqual(Buffer.from(correctHash), Buffer.from(userHash))) {
            req.session.isLoggedIn = true;
            console.log(`[Auth] Login successful for ${req.ip}`);
            res.json({ success: true });
        } else {
            console.warn(`[Auth] Login failed for ${req.ip}`);
            res.status(401).json({ error: "Invalid API Password." });
        }
    } catch (e) {
        console.error("[Auth] Error:", e.message);
        res.status(500).json({ error: "Internal Server Error." });
    }
});

app.get('/check-session', (req, res) => {
    res.json({ isLoggedIn: req.session.isLoggedIn || false });
});

app.post('/logout', (req, res) => {
    req.session.destroy(err => {
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// 2. General Status (Simplified)
app.get('/status', (req, res) => {
    // Service is always "Online" since we removed external dependencies
    res.json({ isOffline: false, message: "CineVault-Lite service operational." });
});

// 3. JDownloader - Manual Add
app.post('/direct-download', apiLimiter, authMiddleware, async (req, res) => {
    const { link, title, type } = req.body; // expected type: 'film' or 'series'

    if (!link) return res.status(400).json({ error: "Missing link." });
    
    const safeTitle = title ? title.trim() : "Manual_Add_" + Date.now();
    const isSeries = (type === 'serie');

    console.log(`[Manual] Adding: ${safeTitle} (${type}) -> ${link}`);

    try {
        await sendToJDownloader(link, safeTitle, isSeries);
        res.json({ message: "Link successfully sent to JDownloader!" });
    } catch (error) {
        res.status(500).json({ error: "Error writing JD file." });
    }
});

// 4. JDownloader - Status
app.get('/download-status', apiLimiter, authMiddleware, async (req, res) => {
    const jdQuery = {
        params: [{
            "running": true,
            "name": true,
            "bytesLoaded": true,
            "bytesTotal": true
        }],
        id: Date.now(),
        methodName: "queryLinks"
    };

    try {
        const response = await fetch(`http://${CONFIG.JD_HOST}:${CONFIG.JD_API_PORT}/downloadsV2/queryLinks`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jdQuery)
        });
        
        if (!response.ok) throw new Error(`JD API non-OK: ${response.status}`);
        const data = await response.json();
        
        let items = [];
        if (data && data.data) {
            items = data.data.map(item => {
                let percent = 0;
                if (item.bytesTotal > 0) percent = (item.bytesLoaded / item.bytesTotal) * 100;
                else if (item.bytesLoaded > 0 && item.bytesTotal === 0) percent = 0;
                if (item.bytesLoaded > 0 && item.bytesLoaded === item.bytesTotal) percent = 100;

                return { name: item.name, percent: percent };
            });
        }
        res.json(items);

    } catch (error) {
        res.json([]);
    }
});

// 5. Music
app.post('/download-music', apiLimiter, authMiddleware, async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "Missing URL." });

    downloadMusic(url).catch(e => console.error(e.message));
    res.json({ message: "Download started!" });
});

app.get('/music-status', authMiddleware, (req, res) => {
    res.json(globalState.musicDownloadState);
});

// 6. Plex - Bridge Sync Playlist
app.post('/sync-playlist', apiLimiter, authMiddleware, async (req, res) => {
    const { url, name, userId } = req.body; 
    if (!url || !name) return res.status(400).json({ error: "Incomplete data." });

    const targetUser = userId || 'main'; 
    console.log(`[Plex Bridge] Sync: ${name} for UserID: ${targetUser}`);

    const env = { 
        ...process.env, 
        PLEX_URL: `http://${CONFIG.PLEX_IP}:32400`,
        PLEX_TOKEN: CONFIG.PLEX_TOKEN,
        SPOTIFY_CLIENT_ID: CONFIG.SPOTIFY_ID,
        SPOTIFY_CLIENT_SECRET: CONFIG.SPOTIFY_SECRET,
        PYTHONIOENCODING: 'utf-8'
    };

    const pythonProcess = spawn('python3', 
        ['plex_bridge.py', 'sync_spotify', '--url', url, '--name', name, '--user', targetUser], 
        { env }
    );

    let outputData = '';
    pythonProcess.stdout.on('data', (data) => outputData += data.toString());

    pythonProcess.on('close', (code) => {
        if (code === 0 && outputData.includes('SUCCESS:')) {
            const cleanMsg = outputData.split('SUCCESS:')[1].trim();
            res.json({ message: cleanMsg });
        } else {
            const errorMsg = outputData.includes('ERROR:') ? outputData.split('ERROR:')[1].trim() : "Python Script Error";
            res.status(500).json({ error: errorMsg });
        }
    });
});

// 7. Plex - Inventory & Refresh
app.get('/plex-inventory', apiLimiter, authMiddleware, async (req, res) => {
    if (!CONFIG.PLEX_IP || !CONFIG.PLEX_TOKEN) return res.json([]);

    const sectionId = CONFIG.PLEX_SECTION_MOVIES;
    const plexUrl = `http://${CONFIG.PLEX_IP}:32400/library/sections/${sectionId}/all?X-Plex-Token=${CONFIG.PLEX_TOKEN}`;

    try {
        const response = await fetch(plexUrl, { headers: { 'Accept': 'application/json' } });
        if (!response.ok) throw new Error("Plex Error");
        
        const data = await response.json();
        const inventory = [];
        
        if (data.MediaContainer && data.MediaContainer.Metadata) {
            data.MediaContainer.Metadata.forEach(item => {
                inventory.push({ title: item.title, year: item.year || 'N/A' });
            });
        }
        res.json(inventory);
    } catch (error) {
        console.error("[Plex] Inventory Error:", error.message);
        res.json([]);
    }
});

app.post('/refresh-plex', apiLimiter, authMiddleware, async (req, res) => {
    const refreshUrl = `http://${CONFIG.PLEX_IP}:32400/library/sections/all/refresh?X-Plex-Token=${CONFIG.PLEX_TOKEN}`;
    try {
        await fetch(refreshUrl);
        res.json({ message: "Plex Scan initiated!" });
    } catch (error) {
        res.status(500).json({ error: "Cannot contact Plex." });
    }
});

app.get('/plex-users', authMiddleware, (req, res) => {
    const env = { 
        ...process.env, 
        PLEX_URL: `http://${CONFIG.PLEX_IP}:32400`,
        PLEX_TOKEN: CONFIG.PLEX_TOKEN
    };

    const pythonProcess = spawn('python3', ['plex_bridge.py', 'list_users'], { env });
    let dataString = '';

    pythonProcess.stdout.on('data', (data) => dataString += data.toString());
    pythonProcess.on('close', () => {
        try {
            res.json(JSON.parse(dataString));
        } catch (e) {
            res.status(500).json({ error: "Error reading users" });
        }
    });
});

// --- Start Server ---
app.listen(PORT, () => {
    console.log(`🚀 CineVault-Lite started on port ${PORT}`);
    console.log(`Mode: Manual Management & Dashboard`);
});

// Graceful Shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));