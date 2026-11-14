/**
 * Main Application Module
 * Initializes and coordinates all modules
 */

import { getState, getNow, saveState, undoLastAction } from './state.js';
import { handleBeeping } from './audio.js';
import { runWatchdog } from './watchdog.js';
import { takePill, takePillAt, snooze, checkReset, manualResetDay, confirmResetDay, resetDayFromButton } from './actions.js';
import { toggleSettings, saveSettings, applyTimeOffset, clearTimeOffset, hardReset, updateSettingsVisibility } from './settings.js';
import { updateUI, updateLoadingText } from './ui.js';

// Export functions to global scope for HTML onclick handlers
window.takePill = () => {
    takePill();
    updateUI();
};
window.snooze = () => {
    snooze();
    updateUI();
};
window.undoLastAction = () => {
    undoLastAction();
    updateUI();
};
window.manualResetDay = manualResetDay;
window.confirmResetDay = confirmResetDay;
window.resetDayFromButton = resetDayFromButton;
window.toggleSettings = toggleSettings;
window.saveSettings = () => {
    saveSettings();
    // Immediate UI update to sync button state with new settings
    setTimeout(() => updateUI(), 10);
};
window.applyTimeOffset = () => {
    applyTimeOffset();
    updateUI();
};
window.clearTimeOffset = () => {
    clearTimeOffset();
    updateUI();
};
window.hardReset = hardReset;
window.updateLoadingText = updateLoadingText;
window.updateSettingsVisibility = updateSettingsVisibility;

// Backdate-dose overlay: log a pill that was actually taken earlier
window.toggleBackdate = () => {
    const overlay = document.getElementById('backdate-overlay');
    if (!overlay) return;
    overlay.classList.toggle('hidden');
    if (!overlay.classList.contains('hidden')) {
        // Prefill with the current (effective) time for the caregiver to dial back
        const now = getNow();
        const input = document.getElementById('backdate-input');
        if (input) {
            input.value = String(now.getHours()).padStart(2, '0') + ':' +
                          String(now.getMinutes()).padStart(2, '0');
        }
    }
};
window.logPillEarlier = () => {
    const input = document.getElementById('backdate-input');
    if (!input || !input.value) return;
    const [h, m] = input.value.split(':');
    // Build the timestamp on today's (effective) date
    const doseTime = new Date(getNow());
    doseTime.setHours(parseInt(h), parseInt(m), 0, 0);
    takePillAt(doseTime.getTime());
    const overlay = document.getElementById('backdate-overlay');
    if (overlay) overlay.classList.add('hidden');
    updateUI();
};

// Initialize application
export function initializeApp() {
    // Add single click handler for take pill button
    const btnTake = document.getElementById('btn-take');
    if (btnTake) {
        btnTake.addEventListener('click', function() {
            const action = this.dataset.action;
            // Safety check: Don't allow taking pill if day is complete
            if (action === 'pill') {
                const state = getState();
                const effectiveTotal = state.data.effectiveTotalDoses || state.settings.totalDoses;
                // Only allow if we haven't reached the limit
                if (state.data.dosesTaken < effectiveTotal) {
                    takePill();
                    updateUI();
                }
            } else if (action === 'reset') {
                resetDayFromButton();
            }
        });
    }
    
    // Run watchdog on startup to verify state integrity
    runWatchdog();
    checkReset();
    updateUI();
    
    // Hide loading screen after initial UI update completes
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.style.animation = 'fade-out 0.5s ease-in-out forwards';
    }
    
    // Main update interval - check twice per second for responsive audio
    setInterval(() => {
        checkReset();
        updateUI();
        handleBeeping();
    }, 500);
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Offline / installable PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
}
