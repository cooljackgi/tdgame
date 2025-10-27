
'use client';

// A Map to cache the loaded AudioBuffer objects
const audioBufferCache = new Map<string, AudioBuffer>();
let audioContext: AudioContext | null = null;
import type { Element } from '@/lib/game-data/types';


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
    'build_tower': 'build.wav',
    'upgrade_tower': 'upgrade.wav',
    'sell_tower': 'sell.wav',
    'enemy_die': 'hit.wav',
    'enemy_leak': 'leak.wav',
    'ui_click': 'click.wav',
    'wave_start': 'wave_start.wav',
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
    }
    
    public playWaveMusic() {
        // Temporarily disabled by user request.
        return;
    }

    public stopMusic({ fadeOutMs = 1000 } = {}) {
        if (this.musicSource && this.musicGainNode) {
            const now = getAudioContext().currentTime;
            this.musicGainNode.gain.cancelScheduledValues(now);
            this.musicGainNode.gain.setTargetAtTime(0, now, fadeOutMs / 1000 / 3);
            
            try {
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

    public playAttackSound(element: Element, pitchVariation: number = 0.5) {
        if (!this.isInitialized || this.isMuted) return;

        const ctx = getAudioContext();
        const now = ctx.currentTime;
        const gainNode = ctx.createGain();
        gainNode.connect(ctx.destination);
        
        let osc: OscillatorNode | null = null;
        let basePitch = 220;
        let duration = 0.15;
        let volume = 0.2;

        switch (element) {
            case 'fire':
                osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                basePitch = 150 + pitchVariation * 40;
                duration = 0.1;
                volume = 0.15;
                gainNode.gain.setValueAtTime(volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
                break;
            
            case 'water':
                osc = ctx.createOscillator();
                osc.type = 'sine';
                basePitch = 440 + pitchVariation * 50;
                duration = 0.2;
                volume = 0.25;
                gainNode.gain.setValueAtTime(volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
                osc.frequency.setValueAtTime(basePitch, now);
                osc.frequency.exponentialRampToValueAtTime(basePitch * 0.8, now + duration);
                break;

            case 'earth':
                osc = ctx.createOscillator();
                osc.type = 'square';
                basePitch = 80 + pitchVariation * 20;
                duration = 0.12;
                volume = 0.2;
                gainNode.gain.setValueAtTime(volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration * 1.5);
                break;
            
            case 'air': {
                const noise = ctx.createBufferSource();
                const bufferSize = ctx.sampleRate * 0.1; // 0.1 second buffer
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }
                noise.buffer = buffer;
                const bandpass = ctx.createBiquadFilter();
                bandpass.type = 'bandpass';
                bandpass.frequency.value = 1200 + pitchVariation * 400;
                bandpass.Q.value = 15;
                noise.connect(bandpass);
                bandpass.connect(gainNode);
                volume = 0.3;
                gainNode.gain.setValueAtTime(volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                noise.start(now);
                noise.stop(now + 0.1);
                return; // Different path, return early
            }

            default: // Neutral, Light, Dark, Nature
                osc = ctx.createOscillator();
                osc.type = 'triangle';
                basePitch = 380 + pitchVariation * 60;
                duration = 0.1;
                volume = 0.18;
                gainNode.gain.setValueAtTime(volume, now);
                gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
                osc.frequency.setValueAtTime(basePitch * 1.5, now);
                osc.frequency.exponentialRampToValueAtTime(basePitch, now + duration);
                break;
        }

        if (osc) {
            osc.frequency.setValueAtTime(basePitch, now);
            osc.connect(gainNode);
            osc.start(now);
            osc.stop(now + duration);
        }
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
