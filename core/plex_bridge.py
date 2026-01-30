import sys
import os
import argparse
import json
import re
import difflib
import unicodedata
from plexapi.server import PlexServer
from plexapi.exceptions import NotFound
from auto_create_m3u import generate_m3u_from_spotify_playlist

# --- Configuration ---
# Force UTF-8 for Docker logs
sys.stdout.reconfigure(encoding='utf-8')

PLEX_URL = os.environ.get('PLEX_URL', '')
PLEX_TOKEN = os.environ.get('PLEX_TOKEN', '')
SPOTIFY_CLIENT_ID = os.environ.get('SPOTIFY_CLIENT_ID', '')
SPOTIFY_CLIENT_SECRET = os.environ.get('SPOTIFY_CLIENT_SECRET', '')

class PlexManager:
    def __init__(self, plex_url, plex_token):
        self.plex_url = plex_url
        self.plex_token = plex_token
        self.plex = PlexServer(self.plex_url, self.plex_token)

    def get_users_list(self):
        # Default admin account
        users_list = [{'id': 'main', 'title': 'Main Account (Admin)'}]
        try:
            account = self.plex.myPlexAccount()
            for user in account.users():
                users_list.append({'id': str(user.id), 'title': user.title})
        except: pass
        return users_list

    def _get_target_plex_instance(self, user_id):
        if user_id == 'main' or not user_id: return self.plex
        try:
            account = self.plex.myPlexAccount()
            for user in account.users():
                if str(user.id) == str(user_id):
                    # Connect as the managed user
                    token = user.get_token(self.plex.machineIdentifier)
                    return PlexServer(self.plex_url, token)
            return self.plex
        except: return self.plex

    # --- CLEANING & NORMALIZATION ---
    def _normalize(self, text):
        """
        Normalizes text for comparison:
        "God's Plan" -> "gods plan"
        "God’s Plan" -> "gods plan"
        """
        if not text: return ""
        text = text.lower()
        # Manual replacement of curved apostrophes
        text = text.replace('’', '').replace("'", "")
        text = unicodedata.normalize('NFD', text)
        text = "".join([c for c in text if unicodedata.category(c) != 'Mn'])
        text = re.sub(r'[^a-z0-9]', ' ', text)
        return re.sub(r'\s+', ' ', text).strip()

    def _clean_spotify_title(self, title):
        # Remove (feat. X), [Remaster], etc.
        title = re.sub(r'[\(\[][^\)\]]*(feat|ft\.|remaster|live|deluxe|edit|version|mix)[^\)\]]*[\)\]]', '', title, flags=re.IGNORECASE)
        title = re.sub(r'\s-\s.*', '', title)
        return title.strip()

    def _check_artist_match(self, spotify_artist_str, plex_artist_str):
        if not plex_artist_str: return False
        norm_plex = self._normalize(plex_artist_str)
        sp_artists = re.split(r',|&', spotify_artist_str)
        for sp_art in sp_artists:
            norm_sp = self._normalize(sp_art)
            if norm_plex in norm_sp or norm_sp in norm_plex: return True
            if difflib.SequenceMatcher(None, norm_plex, norm_sp).ratio() > 0.8: return True
        return False

    # --- ARTIST FALLBACK SEARCH ---
    def _search_by_artist_fallback(self, lib, sp_artist, sp_title):
        """
        If title search fails, search by Artist, get ALL their tracks,
        and manually compare titles using fuzzy matching.
        """
        # Take the main artist (e.g., "Drake" from "Drake, Wizkid")
        main_artist = re.split(r',|&', sp_artist)[0].strip()
        
        # 1. Find Artist in Plex
        artist_results = lib.search(main_artist, libtype='artist', limit=5)
        
        candidates = []
        for artist_obj in artist_results:
            if self._check_artist_match(main_artist, artist_obj.title):
                # 2. Get all tracks from this artist
                candidates.extend(artist_obj.tracks())

        # 3. Manual Comparison
        best_match = None
        highest_score = 0
        norm_sp_title = self._normalize(sp_title)

        for track in candidates:
            norm_plex_title = self._normalize(track.title)
            
            # Exact Match after normalization
            if norm_sp_title == norm_plex_title:
                return track
            
            # Fuzzy Match
            score = difflib.SequenceMatcher(None, norm_sp_title, norm_plex_title).ratio()
            if score > 0.9 and score > highest_score:
                highest_score = score
                best_match = track
        
        return best_match

    def create_playlist_from_spotify(self, spotify_url, playlist_name, user_id='main'):
        m3u_filename = "temp_playlist_bridge.m3u"
        original_stdout = sys.stdout
        # Suppress prints from the sub-script to avoid pollution
        sys.stdout = open(os.devnull, 'w')
        try:
            generate_m3u_from_spotify_playlist(spotify_url, output_filename=m3u_filename,
                CLIENT_ID=SPOTIFY_CLIENT_ID, CLIENT_SECRET=SPOTIFY_CLIENT_SECRET)
        except Exception as e:
            sys.stdout = original_stdout
            return False, f"Spotify Error: {e}"
        finally:
            sys.stdout = original_stdout

        if not os.path.exists(m3u_filename): return False, "M3U Generation Failed"

        try:
            with open(m3u_filename, 'r', encoding='utf-8') as f: m3u_content = f.read()
            tracks = self._parse_m3u(m3u_content)
            target_plex = self._get_target_plex_instance(user_id)
            target_lib = None
            
            # Try different common library names
            for name in ['Music', 'Musique', 'Musik', 'Música']:
                try: target_lib = target_plex.library.section(name); break
                except NotFound: continue
            
            if not target_lib: return False, "Music library not found in Plex."

            found_items = []
            missing_tracks = []

            for sp_artist, sp_title in tracks:
                track_found = None
                
                # STEP 1: Standard Title Search
                clean_title = self._clean_spotify_title(sp_title)
                results = target_lib.search(clean_title, libtype='track', limit=10)
                
                if not results and clean_title != sp_title:
                     results = target_lib.search(sp_title, libtype='track', limit=10)

                for r in results:
                    plex_artist = r.grandparentTitle if r.grandparentTitle else ""
                    if self._check_artist_match(sp_artist, plex_artist):
                        track_found = r; break 
                    
                    title_score = difflib.SequenceMatcher(None, self._normalize(sp_title), self._normalize(r.title)).ratio()
                    if title_score > 0.9: track_found = r; break

                # STEP 2: ARTIST FALLBACK (If title search failed)
                if not track_found:
                    track_found = self._search_by_artist_fallback(target_lib, sp_artist, sp_title)

                if track_found:
                    found_items.append(track_found)
                else:
                    missing_tracks.append(f"❌ '{sp_title}' ({sp_artist})")

            if found_items:
                try:
                    # Overwrite existing playlist if it exists
                    existing = target_plex.playlist(playlist_name)
                    existing.delete()
                except: pass
                target_plex.createPlaylist(playlist_name, section=target_lib, items=found_items)

            if os.path.exists(m3u_filename): os.remove(m3u_filename)
            
            if len(missing_tracks) > 0:
                print("\n--- MISSING TRACKS ---")
                for m in missing_tracks: print(m)
                print("----------------------\n")
                
            return True, f"Playlist created: {len(found_items)}/{len(tracks)} tracks matched."
            
        except Exception as e:
            if os.path.exists(m3u_filename): os.remove(m3u_filename)
            return False, str(e)

    def _parse_m3u(self, content):
        tracks = []
        for line in content.split('\n'):
            if line.startswith('#EXTINF:'):
                parts = line.split(',', 1)
                if len(parts) > 1:
                    info = parts[1]
                    if ' - ' in info:
                        artist, title = info.split(' - ', 1)
                        tracks.append((artist.strip(), title.strip()))
                    else: tracks.append(("", info.strip()))
        return tracks

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['sync_spotify', 'list_users'])
    parser.add_argument('--url', help='Spotify URL')
    parser.add_argument('--name', help='Playlist Name')
    parser.add_argument('--user', default='main', help='Plex User ID')
    args = parser.parse_args()
    manager = PlexManager(PLEX_URL, PLEX_TOKEN)

    try:
        if args.action == 'list_users':
            print(json.dumps(manager.get_users_list()))
        elif args.action == 'sync_spotify':
            if not args.url or not args.name: sys.exit(1)
            success, msg = manager.create_playlist_from_spotify(args.url, args.name, args.user)
            # Node.js listens for "SUCCESS:" or "ERROR:"
            if success: print(f"SUCCESS: {msg}")
            else: print(f"ERROR: {msg}"); sys.exit(1)
    except Exception as e:
        if args.action != 'list_users': print(f"ERROR: {str(e)}"); sys.exit(1)