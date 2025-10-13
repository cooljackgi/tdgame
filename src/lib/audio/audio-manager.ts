
'use client';

// A Map to cache the loaded AudioBuffer objects
const audioBufferCache = new Map<string, AudioBuffer>();
let audioContext: AudioContext | null = null;

// Ensure AudioContext is created only once and after user interaction
function getAudioContext(): AudioContext {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
}

// Function to fetch and decode an audio file, with caching
async function loadAudioFile(url: string): Promise<AudioBuffer> {
    if (audioBufferCache.has(url)) {
        return audioBufferCache.get(url)!;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch audio file: ${url}`);
        }
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer);
        audioBufferCache.set(url, audioBuffer);
        return audioBuffer;
    } catch (error) {
        console.error(`Error loading audio file ${url}:`, error);
        throw error;
    }
}

// =================================================================
// USER CONFIGURATION
// =================================================================
// 1. Add your music files to the `public/audio/music/` directory.
// 2. List the filenames of your music tracks in this array.
const WAVE_MUSIC_TRACKS = [
    'song1.mp3',
    'song2.mp3',
    'song3.mp3',
];

// 3. Add your sound effect files to the `public/audio/sfx/` directory.
// 4. Map a short name (key) to your sound effect filename.
const SFX_FILES: Record<string, string> = {
    'build_tower': 'build_tower.mp3',
    'shoot': 'laser.wav',
};
// =================================================================


class AudioManager {
    private musicSource: AudioBufferSourceNode | null = null;
    private musicGainNode: GainNode | null = null;
    private isInitialized = false;
    public isMuted = false;
    private lastPlayedTrack: string | null = null;

    public async init() {
        if (this.isInitialized) return;
        
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }
        this.isInitialized = true;
        console.log("Audio Manager Initialized.");
    }

    public mute() {
        this.isMuted = true;
        this.stopMusic();
    }

    public unmute() {
        this.isMuted = false;
        // The game logic will decide if music should be re-started
    }
    
    public playWaveMusic() {
        if (!this.isInitialized || this.isMuted || WAVE_MUSIC_TRACKS.length === 0) return;

        this.stopMusic({ fadeOutMs: 500 });

        let trackPool = WAVE_MUSIC_TRACKS;
        if(this.lastPlayedTrack && WAVE_MUSIC_TRACKS.length > 1) {
            trackPool = WAVE_MUSIC_TRACKS.filter(t => t !== this.lastPlayedTrack);
        }
        
        const trackName = trackPool[Math.floor(Math.random() * trackPool.length)];
        this.lastPlayedTrack = trackName;
        const filePath = `/audio/music/${trackName}`;
        
        loadAudioFile(filePath).then(buffer => {
            if (this.isMuted || this.musicSource) return; // Don't start if muted or another track is starting
            
            const ctx = getAudioContext();
            this.musicSource = ctx.createBufferSource();
            this.musicSource.buffer = buffer;
            this.musicSource.loop = false; // Play song only once

            this.musicGainNode = ctx.createGain();
            this.musicGainNode.connect(ctx.destination);
            this.musicSource.connect(this.musicGainNode);

            const now = ctx.currentTime;
            this.musicGainNode.gain.setValueAtTime(0, now);
            this.musicGainNode.gain.linearRampToValueAtTime(0.7, now + 1.5);

            this.musicSource.start();

            // When the song ends, just clean up. The game session will decide when to play the next one.
            this.musicSource.onended = () => {
                this.musicSource = null;
                this.musicGainNode = null;
            };
        }).catch(err => {
            console.warn(`Could not load or play music file: ${filePath}`, err);
        });
    }

    public stopMusic({ fadeOutMs = 1000 } = {}) {
        if (this.musicSource && this.musicGainNode) {
            const now = getAudioContext().currentTime;
            this.musicGainNode.gain.cancelScheduledValues(now);
            this.musicGainNode.gain.setTargetAtTime(0, now, fadeOutMs / 1000 / 3);
            
            try {
                // Add a small delay before stopping to allow the fade out to begin
                setTimeout(() => {
                    if (this.musicSource) {
                        try {
                           this.musicSource.stop();
                        } catch (e) {
                           // This can throw if the source is already stopped, which is fine.
                        }
                    }
                }, fadeOutMs);
            } catch(e) {
                // Can throw if already stopped
            }
        }
        this.musicSource = null;
        this.musicGainNode = null;
    }
    
    public playSfx(sfxName: keyof typeof SFX_FILES, volume = 0.5) {
        if (!this.isInitialized || this.isMuted) return;

        const filename = SFX_FILES[sfxName];
        if (!filename) {
            console.warn(`SFX not found in map: ${sfxName}`);
            return;
        }

        const url = `/audio/sfx/${filename}`;
        loadAudioFile(url).then(buffer => {
            const ctx = getAudioContext();
            const source = ctx.createBufferSource();
            source.buffer = buffer;

            const gainNode = ctx.createGain();
            gainNode.gain.setValueAtTime(volume, ctx.currentTime);
            
            source.connect(gainNode);
            gainNode.connect(ctx.destination);
            source.start();
        }).catch(err => {
            // Silently fail if SFX is not found, to not spam console
        });
    }
}

export const audioManager = new AudioManager();
