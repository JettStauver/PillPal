/**
 * Scheduler Module
 * Handles dose scheduling and interval calculations
 */

import { getState, getCap } from './state.js';

const HOUR = 60 * 60 * 1000;

export function calculateSchedule() {
    const state = getState();
    const s = state.settings;
    const d = state.data;

    // If we haven't started yet, interval is standard
    if (d.dosesTaken === 0) {
        d.currentInterval = s.standardInterval;
        d.nextDoseScheduled = null; // Next dose is whenever they click
        d.effectiveTotalDoses = s.totalDoses;
        d.dayCompleted = false;
        return;
    }

    if (s.intervalMode === 'fixed' || !s.useEndTime) {
        // FIXED INTERVAL MODE: Just use the standard interval always
        d.currentInterval = s.standardInterval;
        d.effectiveTotalDoses = s.totalDoses;
    } else {
        // ADAPTIVE INTERVAL MODE: shrink the interval to fit remaining doses before the end time
        const endTimeDate = new Date(d.firstDoseTime);
        endTimeDate.setHours(s.endHour, s.endMinute || 0, 0, 0);

        const dosesRemaining = s.totalDoses - d.dosesTaken;
        const timeRemainingHours = Math.max(0, (endTimeDate.getTime() - d.lastDoseTime) / HOUR);
        const step = s.step > 0 ? s.step : 0.5; // step <= 0 would loop forever

        let fits = dosesRemaining <= 0;
        let proposedInterval = s.standardInterval;
        while (!fits && proposedInterval >= s.minInterval) {
            if (proposedInterval * dosesRemaining <= timeRemainingHours) fits = true;
            else proposedInterval = Math.round((proposedInterval - step) * 1000) / 1000;
        }

        if (fits) {
            d.currentInterval = proposedInterval;
            d.effectiveTotalDoses = s.totalDoses;
        } else {
            // Doesn't fit even at min interval
            d.currentInterval = Math.min(s.minInterval, s.standardInterval);
            if (s.allowDoseReduction) {
                const maxFutureDoses = Math.floor(timeRemainingHours / d.currentInterval);
                const newTotal = Math.max(d.dosesTaken + maxFutureDoses, s.minDoses || 0, d.dosesTaken);
                d.effectiveTotalDoses = Math.min(newTotal, s.totalDoses);
            } else {
                d.effectiveTotalDoses = s.totalDoses;
            }
        }
    }

    d.dayCompleted = d.dosesTaken >= getCap();

    // Next dose = last dose + interval, plus any snoozes already used for it
    // (so reloads / settings saves don't silently drop snoozes)
    d.nextDoseScheduled = d.lastDoseTime + d.currentInterval * HOUR + (d.snoozeAddedMs || 0);
}
