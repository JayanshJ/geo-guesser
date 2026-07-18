// Background music player.
//
// Two kinds of source:
//   1. The procedural chiptune synth in arcade.js (ArcadeFX.startMusic) — the
//      zero-asset default, listed in the dropdown as "Arcade Synth".
//   2. Real MP3 tracks shipped under src/music/. They are imported with
//      import.meta.glob so Vite emits them as hashed, base-relative assets —
//      this keeps them working under the GitHub Pages project subpath
//      (vite.config.js uses base: './'), which absolute /music/ URLs would not.
//
// The player owns the <audio> element for file tracks and delegates to the
// synth for the chiptune option. It coordinates mute/volume/track-switch so
// the two backends never play at once. Playback only begins after a user
// gesture (the unlocked flag, set by start()), satisfying autoplay policy.

import { arcadeFX } from './arcade.js';

// import.meta.glob with ?url + eager returns a map of { '<path>': <resolved url> }.
// Eager so every track is bundled (available instantly) — the user wants them all.
const TRACK_URLS = import.meta.glob('../music/*.mp3', {
  eager: true,
  query: '?url',
  import: 'default',
});

const SYNTH_ID = '__synth__';

// Turn "bouncyrunner-arcade-all-night-396133.mp3" into a readable label.
function prettyName(file) {
  return file
    .replace(/\.mp3$/i, '')
    .replace(/-\d+$/, '') // trailing Pixabay track id
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function buildTracks() {
  const tracks = [
    { id: SYNTH_ID, name: 'Arcade Synth', url: null },
  ];
  const paths = Object.keys(TRACK_URLS).sort();
  for (const p of paths) {
    const file = p.split('/').pop();
    tracks.push({ id: file, name: prettyName(file), url: TRACK_URLS[p] });
  }
  return tracks;
}

class MusicPlayer {
  constructor() {
    this.tracks = buildTracks();
    this.currentId = SYNTH_ID;
    this.volume = 0.5;
    this.muted = false;
    this.unlocked = false; // set true on first user gesture
    this.audio = null;
  }

  init(volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.audio = new Audio();
    this.audio.loop = true;
    this.audio.volume = this.volume;
    this.audio.preload = 'none'; // only load when chosen, saves bandwidth
    const saved = localStorage.getItem('geoguesser_music_track');
    const exists = this.tracks.some((t) => t.id === saved);
    // selectTrack sets state + src but won't actually play until unlocked.
    this.selectTrack(exists ? saved : SYNTH_ID, { silent: true });
  }

  trackById(id) {
    return this.tracks.find((t) => t.id === id) || null;
  }

  // Switch the active track. `silent` suppresses playback (used during init,
  // before the user gesture that unlocks audio).
  selectTrack(id, { silent = false } = {}) {
    const track = this.trackById(id);
    if (!track) return;
    this.currentId = id;
    localStorage.setItem('geoguesser_music_track', id);
    const play = !silent && this.unlocked && !this.muted;
    if (id === SYNTH_ID) {
      this.audio.pause();
      if (play) arcadeFX.startMusic();
    } else {
      arcadeFX.stopMusic();
      this.audio.src = track.url;
      this.audio.loop = true;
      this.audio.volume = this.volume;
      if (play) this.audio.play().catch(() => {});
    }
  }

  // Begin playback on the first user gesture. No-op if muted; starts whichever
  // backend is active for the current track.
  start() {
    this.unlocked = true;
    if (this.muted) return;
    if (this.currentId === SYNTH_ID) {
      arcadeFX.startMusic();
    } else if (this.audio && this.audio.src) {
      this.audio.play().catch(() => {});
    }
  }

  setMuted(muted) {
    this.muted = !!muted;
    // arcadeFX handles the WebAudio ctx suspend/resume (SFX) and its own synth
    // music stop; the HTML <audio> file track is controlled separately here.
    arcadeFX.setMuted(this.muted);
    if (this.muted) {
      if (this.audio) this.audio.pause();
      return;
    }
    // Unmuted: resume whichever backend is the active track.
    if (!this.unlocked) return;
    if (this.currentId === SYNTH_ID) arcadeFX.startMusic();
    else if (this.audio && this.audio.src) this.audio.play().catch(() => {});
  }

  isMuted() {
    return this.muted;
  }

  // 0..1. Drives both the synth music gain and the <audio> element volume.
  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.audio) this.audio.volume = this.volume;
    arcadeFX.setMusicVolume(this.volume);
  }
}

export const musicPlayer = new MusicPlayer();
export default MusicPlayer;