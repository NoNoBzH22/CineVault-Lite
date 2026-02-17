# CineVault-Lite 

![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

**CineVault-Lite** is a lightweight, self-hosted web dashboard designed for HomeLab enthusiasts. It acts as a centralized bridge between your manual download workflow (JDownloader), your music library (Spotify/SpotDL), and your media server (Plex).

> **Note:** This "Lite" version focuses on manual management, privacy, and automation triggers.

## Key Features

* **JDownloader Bridge:** Manually send direct download links (1fichier, Uptobox, etc.) to your JDownloader instance.
* **Spotify-to-OGG:** Download or sync public Spotify playlists locally using [SpotDL](https://github.com/spotDL/spotify-downloader).
* **Plex Webhook:** Manually trigger a Plex library scan with a single click.
* **Live Monitoring:** Track JDownloader progress in real-time directly from the dashboard.
* **Responsive UI:** Modern, dark-themed interface optimized for mobile and desktop.
* **Secure:** Designed to run behind a reverse proxy with built-in API token authentication.

## Prerequisites

Before installing, ensure you have:
* **Docker & Docker Compose** installed.
* A running instance of **JDownloader 2** (Headless or Desktop).
* A **Plex Media Server**.
* A **Spotify Developer Account** (for API keys).

> [!IMPORTANT]
> **🎵 Spotify Configuration Required**
> To enable music downloading and playlist synchronization, you must create a [Spotify Developer App](https://developer.spotify.com/dashboard).
>
> [link to this problem](https://github.com/spotDL/spotify-downloader/issues/2420)
>
> 1. Go to the **Spotify Developer Dashboard**.
> 2. Create a new app to generate your **Client ID** and **Client Secret**.
> 3. Add these credentials to your environment variables to unlock SpotDL features.

---

## JDownloader Configuration (Important)

To enable the **"Download Status"** feature, JDownloader must accept local API connections.

1. Open your **JDownloader 2** settings (via Web Interface or Desktop GUI).
2. Go to Advanced Settings
3. Search for **Deprecated Api**
4. Activate it and note the port ect (You can modify it)
5. **Note:** Your `JD_HOST` in the configuration below should be the local IP of your JDownloader container/PC, and `JD_API_PORT` is typically `3128`.

> **Note for Docker Users:** If running JDownloader in Docker, ensure port `3128` is mapped/exposed in your JDownloader container config.

For the folder watch,
1. Inside Settings, find Extention Modules and activate *folder watch* and *scheduler*
2. Open *folder watch* and change the folder to the one you choice
3. For *scheduler*, my advise is to first add all download every minutes and start all downloads every minutes

---

### Installation (Docker Compose)

The easiest way to deploy is using Docker Compose.

#### 1. Clone the repository

```bash
git clone https://github.com/TonUsername/CineVault-Lite.git
cd CineVault-Lite

```

#### 2. Configure Environment

1. Rename `core/.env.exemple` to `core/.env`.
2. Edit `core/.env` with your API keys and passwords.

#### 3. Configure Docker

1. Open the [`cinevault-lite.yaml`](./cinevault-lite.yaml) file.
2. Update the `volumes` section to match your paths (JDownloader folder, Music folder).

#### 4. Setup Reverse Proxy (Frontend)

Since this consists of a Backend (Node.js) and a Frontend (Static HTML/JS), you need a web server/reverse proxy.

* **Backend:** Runs on port 3000 (via Docker).
* **Frontend:** The `website/` folder contains the interface.

👉 **[See the Caddyfile example](./caddy.example)** to configure your web server to serve the `website/` folder and proxy requests to the backend.

#### 5. Start the container

```bash
docker-compose up -d

```
---

## How It Works

### 1. Manual Add (Direct Download)

* Paste a DDL link (e.g., from 1fichier) into the input field.
* Give it a Title (optional but recommended for folder naming).
* Click **Send**.
* CineVault creates a `.crawljob` file in the mapped `/downloads` folder. JDownloader detects this file and starts the download automatically.

### 2. Music Manager

* **Download Mode:** Paste a Spotify Track or Playlist URL. The server uses `SpotDL` to download metadata-tagged OGG files to your `/music` folder.
* **Sync Mode:** Creates a matching `.m3u` playlist directly inside your Plex Media Server for a specific user.

### 3. Status & Refresh

* **Downloads:** Queries the JDownloader Local API (port 3128) to show a progress bar.
* **Refresh Plex:** Hits the Plex API to scan libraries instantly.

---

## API Endpoints

If you want to integrate CineVault into other scripts, here are the available endpoints:

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/direct-download` | Send a link to JD (`{link, title, type}`) |
| `POST` | `/download-music` | Download a song/playlist (`{url}`) |
| `GET` | `/download-status` | Get JSON list of active downloads |
| `POST` | `/refresh-plex` | Trigger Plex Library Scan |


---

## ⚠️ Disclaimer
This project is intended for **personal use** and educational purposes (HomeLab). Please ensure you have the necessary rights to the content you download or manage.

---

*Made with ❤️ for the HomeLab community.*
