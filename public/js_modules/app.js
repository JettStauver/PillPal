/**
 * Main Application Module
 * Initializes and coordinates all modules
 */

import { getState, getNow, undoLastAction, getCap, getDayStart } from './state.js';
import { handleBeeping, unlockAudio } from './audio.js';
import { runWatchdog } from './watchdog.js';
import { takePill, takePillAt, snooze, checkReset, manualResetDay, confirmResetDay, resetDayFromButton, recentlyActed } from './actions.js';
import { toggleSettings, saveSettings, applyTimeOffset, clearTimeOffset, hardReset, updateSettingsVisibility, resetAppearance, testBeep } from './settings.js';
import { updateUI, updateLoadingText, applyAppearance, fmtTime } from './ui.js';

const $ = id => document.getElementById(id);
// Wrap an action so the screen refreshes right after it
const withUI = fn => (...a) => { const r = fn(...a); updateUI(); syncWakeLock(); return r; };

// Export functions to global scope for HTML onclick handlers
window.takePill = withUI(takePill);
window.snooze = withUI(snooze);
window.undoLastAction = withUI(undoLastAction);
window.manualResetDay = withUI(manualResetDay);
window.confirmResetDay = withUI(confirmResetDay);
window.resetDayFromButton = withUI(resetDayFromButton);
window.toggleSettings = toggleSettings;
window.saveSettings = withUI(saveSettings);
window.applyTimeOffset = withUI(applyTimeOffset);
window.clearTimeOffset = withUI(clearTimeOffset);
window.hardReset = hardReset;
window.updateLoadingText = updateLoadingText;
window.updateSettingsVisibility = updateSettingsVisibility;
window.resetAppearance = resetAppearance;
window.testBeep = testBeep;

// Backdate-dose overlay: log a pill that was actually taken earlier
window.toggleBackdate = () => {
    const overlay = $('backdate-overlay');
    overlay.hidden = !overlay.hidden;
    if (!overlay.hidden) {
        const now = getNow();
        $('backdate-input').value = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
        $('backdate-msg').textContent = '';
    }
};
window.logPillEarlier = () => {
    const input = $('backdate-input');
    if (!input.value) return;
    const [h, m] = input.value.split(':').map(Number);
    const now = getNow();
    const doseTime = new Date(now);
    doseTime.setHours(h, m, 0, 0);
    // A time later than now means last night (e.g. 23:30 entered at 00:15)
    if (doseTime > now) doseTime.setDate(doseTime.getDate() - 1);
    const d = getState().data;
    const dayStart = getDayStart();
    let note = '';
    if (d.dosesTaken > 0 && doseTime.getTime() < d.lastDoseTime) note = `before the last dose; logged at ${fmtTime(d.lastDoseTime)} instead`;
    else if (dayStart !== null && doseTime.getTime() < dayStart) note = `before today's reset time; logged at ${fmtTime(dayStart)} instead`;

    if (!takePillAt(doseTime.getTime())) {
        $('backdate-msg').textContent = 'All doses for today are already logged.';
        return;
    }
    if (note) window.alert(`That time is ${note}.`);
    $('backdate-overlay').hidden = true;
    updateUI();
};

// Keep screen on so alarms keep sounding (tablet otherwise sleeps & throttles timers)
let wakeLock = null;
async function syncWakeLock() {
    const want = getState().settings.ui.keepAwake !== false && document.visibilityState === 'visible';
    if (!want) { wakeLock?.release().catch(() => {}); wakeLock = null; return; }
    if (wakeLock || !navigator.wakeLock) return;
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch { /* needs a gesture or not allowed; retried on next tap */ }
}

function tick() {
    checkReset();
    updateUI();
    handleBeeping();
}

export function initializeApp() {
    applyAppearance(getState().settings.ui);

    $('btn-take').addEventListener('click', function () {
        if (recentlyActed()) return; // swallow double-tap (e.g. last pill -> Reset Day?)
        const action = this.dataset.action;
        if (action === 'pill') {
            if (getState().data.dosesTaken < getCap()) takePill();
        } else if (action === 'reset') {
            resetDayFromButton();
        }
        updateUI();
    });

    // Any tap unlocks audio + wake lock (browsers require a gesture)
    document.addEventListener('pointerdown', () => { unlockAudio(); syncWakeLock(); }, { passive: true });
    document.addEventListener('visibilitychange', () => { syncWakeLock(); if (!document.hidden) tick(); });

    runWatchdog();
    tick();

    const loadingScreen = $('loading-screen');
    if (loadingScreen) loadingScreen.style.animation = 'fade-out 0.5s ease-in-out forwards';

    // Main update loop - twice per second for responsive audio
    setInterval(tick, 500);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Offline / installable PWA. Check for updates hourly (always-on tablets rarely navigate)
// and reload once a new version takes over.
if ('serviceWorker' in navigator) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js')
        .then(reg => setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000))
        .catch(err => console.warn('SW registration failed', err));
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded) return;
        reloaded = true;
        location.reload();
    });
}
