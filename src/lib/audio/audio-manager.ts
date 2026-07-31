
'use client';

import type { Element, Node, SoundEvent } from '@/lib/game-data/types';
import { GRID_COLS } from '@/lib/game-data/constants';

type SfxName = Extract<SoundEvent, { kind: 'sfx' }>['name'];

const audioBufferCache = new Map<string, AudioBuffer>();
let hapticsPrimed = false;
let lastVibeAt = 0;

function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

async function loadAudioFile(ctx: AudioContext, url: string): Promise<AudioBuffer> {
    if (audioBufferCache.has(url)) {
        return audioBufferCache.get(url)!;
    }
    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch audio file: ${url}`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        audioBufferCache.set(url, audioBuffer);
        return audioBuffer;
    } catch (error) {
        console.error(`Error loading audio file ${url}:`, error);
        throw error;
    }
}

// Sound effect mapping
const SFX_FILES: Record<SfxName, string> = {
    'build_tower': 'build.wav',
    'upgrade_tower': 'upgrade.wav',
    'sell_tower': 'upgrade.wav',
    'enemy_die': 'hit.wav',
    'enemy_leak': 'leak.wav',
    'ui_click': 'hit.wav',
    'wave_start': 'wave_start.wav',
};

// Vibration patterns
const VIBRATION_PATTERNS: Record<string, number | number[]> = {
    'kill': 20,
    'leak': [50, 30, 50],
    'build': 30,
    'error': [100, 50, 100],
    'click': 15,
};

type SoundSettings = {
    wave: OscillatorType;
    baseFreq: number;
    vol: number;
    attack: number;
    decay: number;
    sustain: number;
    release: number;
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
    private ctx: AudioContext | null = null;
    private unlocked = false;
    private musicSource: AudioBufferSourceNode | null = null;
    private musicGainNode: GainNode | null = null;
    public isMuted = false;

    public async init() {
        if (this.ctx) return;
        this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        const unlock = async () => {
            if (!this.ctx || this.unlocked) return;
            if (this.ctx.state === 'suspended') {
                await this.ctx.resume();
            }
            this.unlocked = this.ctx.state === 'running';
            if (this.unlocked) {
                console.log("AudioContext unlocked and running.");
                window.removeEventListener('pointerdown', unlock);
                window.removeEventListener('keydown', unlock);
            }
        };

        window.addEventListener('pointerdown', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') this.ctx?.resume();
        });

        // Initial attempt to unlock
        unlock();
    }
    
    public primeHaptics() {
      hapticsPrimed = true;
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

    public playVibration(patternName: keyof typeof VIBRATION_PATTERNS) {
      if (this.isMuted || !canVibrate() || !hapticsPrimed) return;

      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (now - lastVibeAt < 60) return;

      const pattern = VIBRATION_PATTERNS[patternName];
      if (pattern) {
        lastVibeAt = now;
        navigator.vibrate(pattern);
      }
    }
    
    public play(event: SoundEvent) {
        if (!this.ctx) this.init();
        if (!this.ctx || this.ctx.state !== 'running' || this.isMuted) return;

        if(event.kind === 'attack') {
            this.playAttackSound(event.element, {row: event.y, col: event.x});
        } else if (event.kind === 'sfx') {
            this.playSfx(event.name);
            if (event.name === 'enemy_die') this.playVibration('kill');
            if (event.name === 'enemy_leak') this.playVibration('leak');
        }
    }


    private playAttackSound(element: Element, position: Node) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const settings = ELEMENT_SOUNDS[element] || ELEMENT_SOUNDS.neutral;
        const totalDuration = settings.attack + settings.decay + settings.release;

        const mainGain = this.ctx.createGain();
        const panner = this.ctx.createStereoPanner();
        panner.pan.value = ((position.col / GRID_COLS) - 0.5) * 1.8;
        mainGain.connect(panner).connect(this.ctx.destination);

        const osc = this.ctx.createOscillator();
        osc.type = settings.wave;
        osc.frequency.setValueAtTime(settings.baseFreq, now);
        osc.detune.setValueAtTime((Math.random() - 0.5) * 100, now);
        
        if (settings.pitchDrop) {
            osc.frequency.setValueAtTime(settings.baseFreq * 1.5, now);
            osc.frequency.exponentialRampToValueAtTime(settings.baseFreq, now + totalDuration * 0.8);
        }
        osc.connect(mainGain);
        
        if (settings.noise) {
            const noise = this.ctx.createBufferSource();
            const bufferSize = this.ctx.sampleRate * 0.2;
            const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
            const data = buffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
            noise.buffer = buffer;
            const filter = this.ctx.createBiquadFilter();
            filter.type = settings.noise.type;
            filter.frequency.value = settings.noise.freq;
            filter.Q.value = settings.noise.q;
            noise.connect(filter).connect(mainGain);
            noise.start(now);
            noise.stop(now + totalDuration);
        }

        mainGain.gain.setValueAtTime(0, now);
        mainGain.gain.linearRampToValueAtTime(settings.vol, now + settings.attack);
        if (settings.sustain > 0) {
            mainGain.gain.linearRampToValueAtTime(settings.vol * settings.sustain, now + settings.attack + settings.decay);
            mainGain.gain.setTargetAtTime(0, now + settings.attack + settings.decay, settings.release / 3);
        } else {
            mainGain.gain.exponentialRampToValueAtTime(0.0001, now + totalDuration);
        }

        osc.start(now);
        osc.stop(now + totalDuration);
    }
    
    private playSfx(sfxName: SfxName, volume = 0.5) {
        if (!this.ctx) return;
        const filename = SFX_FILES[sfxName];
        if (!filename) return;

        loadAudioFile(this.ctx, `/audio/sfx/${filename}`).then(buffer => {
            if (!this.ctx) return;
            const source = this.ctx.createBufferSource();
            source.buffer = buffer;
            const gainNode = this.ctx.createGain();
            gainNode.gain.setValueAtTime(volume, this.ctx.currentTime);
            source.connect(gainNode).connect(this.ctx.destination);
            source.start();
        }).catch(err => {});
    }
}

export const audioManager = new AudioManager();
