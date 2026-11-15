/**
 * Audio Module
 * Handles beeping and audio notifications
 */

import { getState, getNow, getCap } from './state.js';

let beepStartTime = null; // When beeping started (when pill became due)
let lastBeepCount = 0;    // How many beeps in current sequence
let pending = [];         // queued follow-up beeps, cancelled when pill no longer due

// Reuse a single AudioContext. Browsers create it 'suspended' until a user
// gesture, so every call tries to resume and app.js calls unlockAudio() on taps.
let _audioCtx = null;
function getAudioContext() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (_audioCtx.state !== 'running') _audioCtx.resume().catch(() => {});
    return _audioCtx;
}
export const unlockAudio = () => { getAudioContext(); };

export function playBeep(durationMs = 220) {
    const audioContext = getAudioContext();
    // Suspended context would queue beeps and blast them all later
    if (audioContext.state !== 'running') return;
    const vol = Math.min(1, Math.max(0, getState().settings.beepVolume ?? 0.25));
    if (vol === 0) return;
    const now = audioContext.currentTime;
    const duration = Math.max(50, durationMs) / 1000;

    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const filter = audioContext.createBiquadFilter();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    filter.type = 'lowpass';
    filter.frequency.value = 3500;

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);

    const attack = 0.005;
    const release = Math.min(0.06, duration * 0.3);
    const sustainEnd = now + duration - release;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + attack);
    gain.gain.setValueAtTime(vol, sustainEnd);
    gain.gain.exponentialRampToValueAtTime(0.0001, sustainEnd + release);

    // Small frequency wobble for a softer, natural sound
    osc1.frequency.setValueAtTime(430, now);
    osc1.frequency.exponentialRampToValueAtTime(450, sustainEnd);
    osc2.frequency.setValueAtTime(650, now);
    osc2.frequency.exponentialRampToValueAtTime(670, sustainEnd);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(sustainEnd + release + 0.02);
    osc2.stop(sustainEnd + release + 0.02);
}

function stopBeeping() {
    beepStartTime = null;
    lastBeepCount = 0;
    pending.forEach(clearTimeout);
    pending = [];
}

export function handleBeeping() {
    const now = getNow();
    const state = getState();
    const d = state.data;

    const due = d.dosesTaken > 0 && d.dosesTaken < getCap() &&
                d.nextDoseScheduled && now.getTime() >= d.nextDoseScheduled;
    if (!due) return stopBeeping();

    if (!beepStartTime) {
        beepStartTime = now.getTime();
        lastBeepCount = 0;
    }

    const elapsedSecs = (now.getTime() - beepStartTime) / 1000;
    const interval1 = Math.max(1, state.settings.beepInterval1 || 1);
    const interval2 = Math.max(1, state.settings.beepInterval2 || 30);

    if (elapsedSecs < 60) {
        // First minute: one long beep every interval1 seconds
        const beepsExpected = Math.floor(elapsedSecs / interval1) + 1;
        if (beepsExpected > lastBeepCount) {
            playBeep(1000);
            lastBeepCount = beepsExpected;
        }
    } else {
        // After first minute: a 3-beep burst every interval2 seconds
        const beepsInFirstMin = Math.floor(60 / interval1);
        const sequencesAfterMin = Math.floor((elapsedSecs - 60) / interval2) + 1;
        const totalBeepsExpected = beepsInFirstMin + sequencesAfterMin * 3;
        if (totalBeepsExpected > lastBeepCount) {
            playBeep(600);
            pending = [800, 1600].map(t => setTimeout(() => playBeep(600), t));
            lastBeepCount = totalBeepsExpected;
        }
    }
}
