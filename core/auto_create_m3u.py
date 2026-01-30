import spotipy
from spotipy.oauth2 import SpotifyClientCredentials
import re
import os
import sys

# --- Spotify Configuration ---
CLIENT_ID_DEFAULT = os.environ.get('SPOTIFY_CLIENT_ID', '')
CLIENT_SECRET_DEFAULT = os.environ.get('SPOTIFY_CLIENT_SECRET', '')

class PathTemplate:
    # Variables available for the template
    VARS = {
        "track_name": lambda m: m.get('name', 'Unknown Track'),
        "artist_name": lambda m: m['artists'][0]['name'] if m.get('artists') else 'Unknown Artist',
        "all_artist_names": lambda m: ", ".join([a['name'] for a in m['artists']]) if m.get('artists') else 'Unknown Artist',
        "album_name": lambda m: m['album']['name'] if m.get('album') else 'Unknown Album',
        "track_num": lambda m: m.get('track_number', ''),
        "release_year": lambda m: m['album']['release_date'].split('-')[0] if m.get('album') and m['album'].get('release_date') else '',
        "multi_disc_path": lambda m: f"/CD {m['disc_number']}" if m.get('disc_number') and m.get('disc_number') > 1 else "",
    }


    @staticmethod
    def escape_path(s):
        """
        Sanitize forbidden characters for filenames.
        """
        replacement_chars = {
            '\\': '＼', '/': '／', ':': '：', '*': '＊', '?': '？',
            '"': '＂', '<': '＜', '>': '＞', '|': '￤',
        }
        for old, new in replacement_chars.items():
            s = s.replace(old, new)
        s = re.sub(r'(^ +| +$)', ' ', s) # Spaces
        s = re.sub(r'\.+(\W|$)', r'．\1', s) # Trailing dots
        return s

    @staticmethod
    def render(template, metadata):
        def replace_func(match):
            var_name = match.group(1)
            if var_name in PathTemplate.VARS:
                value = PathTemplate.VARS[var_name](metadata)
                return str(value)
            return match.group(0)

        rendered_path = re.sub(r'{(.+?)}', replace_func, template)
        return PathTemplate.escape_path(rendered_path)

# --- Main Function ---
def generate_m3u_from_spotify_playlist(playlist_url, output_filename="playlist.m3u", track_path_template="{artist_name}/{album_name}{multi_disc_path}/{track_num}. {track_name}.ogg", CLIENT_ID=None, CLIENT_SECRET=None):
    
    # Use default values if arguments are missing
    cid = CLIENT_ID_DEFAULT
    csecret = CLIENT_SECRET_DEFAULT

    if not cid or not csecret:
        print("Error: Missing Spotify CLIENT_ID or CLIENT_SECRET.")
        # Raise error so plex_bridge catches it
        raise ValueError("Missing Spotify Credentials")

    try:
        auth_manager = SpotifyClientCredentials(client_id=cid, client_secret=csecret)
        sp = spotipy.Spotify(auth_manager=auth_manager)
    except Exception as e:
        print(f"Spotify Authentication Error: {e}")
        return

    playlist_name = "Spotify Playlist"
    tracks_data = []

    try:
        if "playlist/" in playlist_url:
            playlist_id = playlist_url.split("playlist/")[-1].split("?")[0]
            playlist_info = sp.playlist(playlist_id)
            # Handle pagination for large playlists
            tracks_result = playlist_info['tracks']
            tracks_data.extend(tracks_result['items'])
            while tracks_result['next']:
                tracks_result = sp.next(tracks_result)
                tracks_data.extend(tracks_result['items'])
            
            playlist_name = playlist_info['name']
            print(f"Playlist detected: {playlist_name} ({len(tracks_data)} tracks)")

        elif "track/" in playlist_url:
            track_id = playlist_url.split("track/")[-1].split("?")[0]
            track = sp.track(track_id)
            tracks_data = [{'track': track}]
            playlist_name = track['name']
            print(f"Single track detected: {playlist_name}")
            
        else:
            print("Unsupported Spotify URL (playlist or track only).")
            return

    except Exception as e:
        print(f"Spotify API Error: {e}")
        return

    m3u_content = ["#EXTM3U"]
    m3u_content.append(f"#PLAYLIST:{playlist_name}")

    for item in tracks_data:
        track = item.get('track', item) 
        if not track: continue

        metadata = {
            'name': track['name'],
            'artists': track['artists'],
            'album': track['album'],
            'track_number': track['track_number'],
            'disc_number': track.get('disc_number', 1),
            'duration_ms': track['duration_ms']
        }

        # Relative path generation (matches SpotDL default)
        file_path_relative = PathTemplate.render(track_path_template, metadata)
        
        # Adjust path for M3U (optional but cleaner)
        final_file_path = f"../{file_path_relative}"

        duration_seconds = metadata['duration_ms'] // 1000
        # Standard EXTINF format
        artist_str = PathTemplate.VARS['all_artist_names'](metadata)
        m3u_content.append(f"#EXTINF:{duration_seconds},{artist_str} - {metadata['name']}")
        m3u_content.append(final_file_path)

    # Force UTF-8 encoding (Vital for Linux/Docker)
    try:
        with open(output_filename, 'w', encoding='utf-8') as f:
            f.write("\n".join(m3u_content))
        print(f"M3U file generated: {output_filename}")
    except IOError as e:
        print(f"File Write Error: {e}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        link = sys.argv[1]
        generate_m3u_from_spotify_playlist(link, output_filename="test.m3u")
    else:
        print("Usage: python3 auto_create_m3u.py [SPOTIFY_URL]")