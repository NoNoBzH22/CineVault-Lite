
# CineVault-Lite

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

**CineVault-Lite** is a lightweight, self-hosted web interface designed for HomeLab enthusiasts. It simplifies the interaction between your media services by acting as a centralized bridge for manual download management, music synchronization, and library updates.

## Key Features

* **JDownloader Bridge:** Manually send direct download links (DDL) to your JDownloader instance via API.
* **Spotify-to-MP3:** Download or sync public Spotify playlists locally using [SpotDL](https://github.com/spotDL/spotify-downloader) integration.
* **Plex Webhook:** Manually trigger a Plex library scan with a single click once your downloads are ready.
* **Live Monitoring:** Track JDownloader download progress in real-time directly from the dashboard.
* **Responsive UI:** Modern, dark-themed interface optimized for both mobile and desktop.
* **Secure:** Designed to run behind a reverse proxy (like Caddy or Nginx) with API token authentication.

> [!IMPORTANT]
> **Spotify Configuration Required**
> To enable music downloading and playlist synchronization, you must create a [Spotify Developer App](https://developer.spotify.com/dashboard).
>
> It bypass the Rate/request limit with spotDL [spotDL FAQ](https://github.com/spotDL/spotify-downloader/issues/2420)
>
> 1. Go to the **Spotify Developer Dashboard**.
> 2. Create a new app to generate your **Client ID** and **Client Secret**.
> 3. Add these credentials to your `docker-compose.yml` or environment variables to unlock SpotDL features.

## Installation (Docker Compose)

The easiest way to deploy CineVault-Lite is using Docker Compose.

1. **Clone the repository:**
   ```bash
   git clone [https://github.com/NoNoBzH22/CineVault-Lite.git](https://github.com/NoNoBzH22/CineVault-Lite.git)
   cd CineVault-Lite

2. **Configure your `docker-compose.yml`:**

```yaml
version: "3"
services:
  cinevault-lite:
    image: node:18-alpine
    container_name: cinevault-lite
    working_dir: /app
    volumes:
      - ./app:/app
      - /path/to/your/downloads:/downloads
      - /path/to/your/music:/music
    ports:
      - "3000:3000"
    environment:
      # Security
      - API_PASSWORD=your_secure_api_password
      
      # Plex Configuration
      - PLEX_URL=http://your-plex-ip:32400
      - PLEX_TOKEN=your_plex_token
      
      # JDownloader Credentials
      - JD_HOST=IP_OF_JDOWNLOADER
      - JD_API_PORT=PORT_JDOWNLOADER_API

      # Spotify Credentials
      - SPOTIFY_CLIENT_ID=CLIENT_ID
      - SPOTIFY_CLIENT_SECRET=CLIENT_SECRET

    restart: unless-stopped

```

3. **Start the container:**
```bash
docker-compose up -d

```



## Tech Stack

* **Frontend:** HTML5, CSS3 (Custom Dark Theme), Vanilla JavaScript
* **Backend:** Node.js, Express
* **Integrations:** JDownloader API, SpotDL, Plex API

## Disclaimer

This project is intended for personal use and educational purposes (HomeLab). Please ensure you have the necessary rights to the content you download or manage.

---

*Made with ❤️ for the HomeLab community.*
