
'use client';

import type { Element, Node } from '@/lib/game-data/types';
import { GRID_COLS } from '@/lib/game-data/constants';

const audioBufferCache = new Map<string, AudioBuffer>();
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
    if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return audioContext;
}

async function loadAudioFile(url: string): Promise<AudioBuffer> {
    if (audioBufferCache.has(url)) {
        return audioBufferCache.get(url)!;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch audio file: ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await getAudioContext().decodeAudioData(arrayBuffer);
        audioBufferCache.set(url, audioBuffer);
        return audioBuffer;
    } catch (error) {
        console.error(`Error loading audio file ${url}:`, error);
        throw error;
    }
}

// Sound effect mapping
const SFX_FILES: Record<string, string> = {
    'build_tower': 'build.wav',
    'upgrade_tower': 'upgrade.wav',
    'sell_tower': 'sell.wav',
    'enemy_die': 'hit.wav',
    'enemy_leak': 'leak.wav',
    'ui_click': 'click.wav',
    'wave_start': 'wave_start.wav',
};

// Based on user's detailed specification
type SoundSettings = {
    wave: OscillatorType;
    baseFreq: number;
    vol: number;
    // ADSR
    attack: number;
    decay: number;
    sustain: number;
    release: number;
    // Layering
    noise?: { type: 'bandpass' | 'highpass', freq: number, q: number };
    pitchDrop?: boolean;
};

const ELEMENT_SOUNDS: Record<Element, SoundSettings> = {
    fire:    { wave: 'sawtooth', baseFreq: 150, vol: 0.15, attack: 0.01, decay: 0.05, sustain: 0,    release: 0.1,  noise: { type: 'bandpass', freq: 2000, q: 10 } },
    water:   { wave: 'sine',     baseFreq: 440, vol: 0.25, attack: 0.02, decay: 0.15, sustain: 0.05, release: 0.2 },
    earth:   { wave: 'square',   baseFreq: 80,  vol: 0.2,  attack: 0.005,decay: 0.08, sustain: 0,    release: 0.2 },
    air:     { wave: 'sine',     baseFreq: 600, vol: 0.3,  attack: 0.001,decay: 0.05, sustain: 0,    release: 0.1,  noise: { type: 'highpass', freq: 4000, q: 1 } },
    light:   { wave: 'triangle', baseFreq: 800, vol: 0.18, attack: 0.005,decay: 0.05, sustain: 0,    release: 0.2,  pitchDrop: true },
    dark:    { wave: 'sawtooth', baseFreq: 220, vol: 0.2,  attack: 0.02, decay: 0.1,  sustain: 0,    release: 0.3 },
    nature:  { wave: 'sine',     baseFreq: 300, vol: 0.22, attack: 0.01, decay: 0.1,  sustain: 0.1,  release: 0.15 },
    neutral: { wave: 'triangle', baseFreq: 600, vol: 0.18, attack: 0.005,decay: 0.05, sustain: 0,    release: 0.2,  pitchDrop: true },
};

class AudioManager {
    private musicSource: AudioBufferSourceNode | null = null;
    private musicGainNode: GainNode | null = null;
    private isInitialized = false;
    public isMuted = false;

    public async init() {
        if (this.isInitialized) return;
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
            await ctx.resume();
        }
        this.isInitialized = true;
        console.log("Audio Manager Initialized.");
    }

    public mute() { this.isMuted = true; this.stopMusic(); }
    public unmute() { this.isMuted = false; }
    
    public playWaveMusic() { return; }
    public stopMusic() {
        if (this.musicSource && this.musicGainNode) {
            try { this.musicSource.stop(); } catch(e) {}
        }
        this.musicSource = null;
        this.musicGainNode = null;
    }

    public playAttackSound(element: Element, position: Node) {
        if (!this.isInitialized || this.isMuted) return;

        const ctx = getAudioContext();
        const now = ctx.currentTime;

        const settings = ELEMENT_SOUNDS[element] || ELEMENT_SOUNDS.neutral;
        const totalDuration = settings.attack + settings.decay + settings.release;

        // Create main Gain and Panner nodes
        const mainGain = ctx.createGain();
        const panner = ctx.createStereoPanner();
        panner.pan.value = ((position.x / GRID_COLS) - 0.5) * 1.8;
        mainGain.connect(panner).connect(ctx.destination);

        // --- Create Oscillator ---
        const osc = ctx.createOscillator();
        osc.type = settings.wave;
        osc.frequency.setValueAtTime(settings.baseFreq, now);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 100, now);
        
        if (settings.pitchDrop) {
            osc.frequency.setValueAtTime(settings.baseFreq * 1.5, now);
            osc.frequency.exponentialRampToValueAtTime(settings.baseFreq, now + totalDuration * 0.8);
        }

        osc.connect(mainGain);
        
        // --- Create Noise Layer (if applicable) ---
        if (settings.noise) {
            const noise = ctx.createBufferSource();
            const bufferSize = ctx.sampleRate * 0.2;
            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            noise.buffer = buffer;

            const filter = ctx.createBiquadFilter();
            filter.type = settings.noise.type;
            filter.frequency.value = settings.noise.freq;
            filter.Q.value = settings.noise.q;

            noise.connect(filter).connect(mainGain);
            noise.start(now);
            noise.stop(now + totalDuration);
        }

        // --- Apply ADSR Envelope to the main gain node ---
        mainGain.gain.setValueAtTime(0, now);
        mainGain.gain.linearRampToValueAtTime(settings.vol, now + settings.attack);
        if (settings.sustain > 0) {
            mainGain.gain.linearRampToValueAtTime(settings.vol * settings.sustain, now + settings.attack + settings.decay);
            mainGain.gain.setTargetAtTime(0, now + settings.attack + settings.decay, settings.release / 3); // Exponential-like release
        } else {
            mainGain.gain.exponentialRampToValueAtTime(0.0001, now + settings.attack + settings.decay + settings.release);
        }

        // Start and stop the main oscillator
        osc.start(now);
        osc.stop(now + totalDuration);
    }
    
    public playSfx(sfxName: keyof typeof SFX_FILES, volume = 0.5) {
        if (!this.isInitialized || this.isMuted) return;
        const filename = SFX_FILES[sfxName];
        if (!filename) return;

        loadAudioFile(`/audio/sfx/${filename}`).then(buffer => {
            const ctx = getAudioContext();
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            const gainNode = ctx.createGain();
            gainNode.gain.setValueAtTime(volume, ctx.currentTime);
            source.connect(gainNode).connect(ctx.destination);
            source.start();
        }).catch(err => {});
    }
}

export const audioManager = new AudioManager();
