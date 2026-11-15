/**
 * Watchdog Module
 * Verifies state integrity and corrects issues on page load
 */

import { getState, getNow, saveState, getCap, getDayStart } from './state.js';
import { calculateSchedule } from './scheduler.js';
import { manualResetDay } from './actions.js';

export function runWatchdog() {
    const now = getNow().getTime();
    const state = getState();
    const d = state.data;
    const s = state.settings;
    const issues = [];
    const fix = (msg, fn) => { issues.push(msg); fn(); };
    const isTs = v => v === null || (typeof v === 'number' && Number.isFinite(v));

    // 1. Day rolled over (same rule as checkReset, so they never disagree)
    const dayStart = getDayStart();
    if (dayStart !== null && d.firstDoseTime && d.firstDoseTime < dayStart) {
        console.warn('🐕 WATCHDOG: day rolled over - resetting');
        manualResetDay();
        return ['Day changed - resetting state'];
    }

    // 2. Counters
    if (!Number.isInteger(d.dosesTaken) || d.dosesTaken < 0) fix('Invalid dosesTaken - 0', () => { d.dosesTaken = 0; });
    if (d.dosesTaken > s.totalDoses) fix('dosesTaken > totalDoses - capping', () => { d.dosesTaken = s.totalDoses; });
    if (!(d.snoozesUsedForCurrent >= 0)) fix('Invalid snooze count - 0', () => { d.snoozesUsedForCurrent = 0; });
    if (d.snoozesUsedForCurrent > s.snoozeCount) fix('Snooze count over limit - capping', () => { d.snoozesUsedForCurrent = s.snoozeCount; });
    if (!(d.snoozeAddedMs >= 0)) fix('Invalid snoozeAddedMs - 0', () => { d.snoozeAddedMs = 0; });

    // 3. Timestamps
    for (const k of ['lastDoseTime', 'firstDoseTime', 'nextDoseScheduled']) {
        if (!isTs(d[k])) fix(`Invalid ${k} - clearing`, () => { d[k] = null; });
    }
    // Future dose times (e.g. after clearing a clock override): clamp, don't wipe the day
    for (const k of ['lastDoseTime', 'firstDoseTime']) {
        if (d[k] && d[k] > now) fix(`${k} in the future - clamping to now`, () => { d[k] = now; });
    }
    if (d.firstDoseTime && d.lastDoseTime && d.firstDoseTime > d.lastDoseTime) {
        fix('firstDoseTime after lastDoseTime - fixing', () => { d.firstDoseTime = d.lastDoseTime; });
    }

    // 4. Time offset (more than 24h is surely a mistake)
    if (!Number.isFinite(d.timeOffset) || Math.abs(d.timeOffset) > 24 * 60 * 60 * 1000) {
        fix('timeOffset invalid - clearing', () => { d.timeOffset = 0; });
    }

    // 5. Doses taken but no dose times: unrecoverable
    if (d.dosesTaken > 0 && (!d.firstDoseTime || !d.lastDoseTime)) {
        console.warn('🐕 WATCHDOG: doses without timestamps - resetting day');
        manualResetDay();
        return ['dosesTaken > 0 but missing dose times - reset'];
    }

    // 6. History
    if (!Array.isArray(state.history)) fix('history not an array - resetting', () => { state.history = []; });

    // 7. Recompute derived fields (interval, cap, next dose, dayCompleted)
    const before = JSON.stringify([d.currentInterval, d.nextDoseScheduled, d.effectiveTotalDoses, d.dayCompleted]);
    if (d.dosesTaken > 0 && d.effectiveTotalDoses < d.dosesTaken) d.effectiveTotalDoses = d.dosesTaken;
    calculateSchedule();
    if (d.dosesTaken > getCap()) fix('dosesTaken > cap', () => { d.effectiveTotalDoses = d.dosesTaken; });
    if (before !== JSON.stringify([d.currentInterval, d.nextDoseScheduled, d.effectiveTotalDoses, d.dayCompleted])) {
        issues.push('Schedule recalculated');
    }

    if (issues.length) {
        console.warn('🐕 WATCHDOG: Issues found and corrected:', issues);
        saveState();
    } else {
        console.log('✅ WATCHDOG: All states verified and correct');
    }
    return issues;
}
