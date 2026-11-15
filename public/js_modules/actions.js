/**
 * Actions Module
 * Core user actions like taking pills, snoozing, and resetting
 */

import { getState, getNow, saveState, pushHistory, getCap, getDayStart, clone, DEFAULT_STATE } from './state.js';
import { calculateSchedule } from './scheduler.js';

// Blocks double-taps on the big button (e.g. last pill -> instant "Reset Day?")
let lastActionAt = 0;
export const recentlyActed = () => Date.now() - lastActionAt < 1500;

/**
 * Record a dose. Defaults to now; pass an earlier timestamp to log a
 * forgotten pill so the schedule behaves as if it was taken then.
 * @returns {boolean} true if a dose was recorded
 */
export function takePillAt(timestamp = getNow().getTime()) {
    const now = getNow().getTime();
    const state = getState();
    const d = state.data;

    if (d.dosesTaken >= getCap()) return false;

    let ts = Math.min(timestamp, now); // never in the future
    // Never before the previous dose (avoids a negative interval)
    if (d.dosesTaken > 0 && d.lastDoseTime && ts < d.lastDoseTime) ts = d.lastDoseTime;
    // Never before the current logical day, or checkReset would wipe it at once
    const dayStart = getDayStart();
    if (dayStart !== null && ts < dayStart) ts = dayStart;

    pushHistory();
    d.lastDoseTime = ts;
    if (d.dosesTaken === 0) d.firstDoseTime = ts;
    d.dosesTaken++;
    d.snoozesUsedForCurrent = 0;
    d.snoozeAddedMs = 0;

    calculateSchedule();
    saveState();
    lastActionAt = Date.now();
    return true;
}

export const takePill = () => takePillAt();

let snoozeLock = false;
export const isSnoozeLocked = () => snoozeLock;

export function snooze() {
    const state = getState();
    const s = state.settings;
    const d = state.data;
    if (snoozeLock || d.dosesTaken === 0 || !d.nextDoseScheduled || d.dosesTaken >= getCap()) return;
    if (d.snoozesUsedForCurrent >= s.snoozeCount) return;

    snoozeLock = true;
    pushHistory();
    // Snooze from now if already overdue, otherwise from the due time
    const next = Math.max(d.nextDoseScheduled, getNow().getTime()) + s.snoozeMinutes * 60000;
    d.snoozeAddedMs = (d.snoozeAddedMs || 0) + (next - d.nextDoseScheduled);
    d.nextDoseScheduled = next;
    d.snoozesUsedForCurrent++;
    saveState();
    setTimeout(() => { snoozeLock = false; }, 1500);
}

export function checkReset() {
    const state = getState();
    const d = state.data;
    if (!d.firstDoseTime) return;
    const dayStart = getDayStart();
    if (dayStart !== null && d.firstDoseTime < dayStart) return manualResetDay();
    // Idle reset: nothing taken or due for N hours (e.g. a skipped last dose overnight)
    const idleMs = (state.settings.idleResetHours || 0) * 3600e3;
    const lastActivity = Math.max(d.lastDoseTime || 0, d.nextDoseScheduled || 0);
    if (idleMs > 0 && getNow().getTime() - lastActivity > idleMs) manualResetDay();
}

export function manualResetDay() {
    const state = getState();
    const offset = state.data.timeOffset || 0;
    state.data = clone(DEFAULT_STATE.data);
    state.data.timeOffset = offset;
    state.data.currentInterval = state.settings.standardInterval;
    state.data.effectiveTotalDoses = state.settings.totalDoses;
    state.history = []; // undo must not resurrect the previous day
    saveState();
}

export function confirmResetDay() {
    if (window.confirm('Reset day? This will clear doses taken for today. Proceed?')) manualResetDay();
}

export function resetDayFromButton() {
    if (window.confirm('Start a new day? This will reset all doses. Proceed?')) manualResetDay();
}
