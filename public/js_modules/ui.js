/**
 * UI Module
 * Handles all UI updates, display logic and appearance (theme / layout)
 */

import { getState, getNow, getCap, isUndoLocked, DEFAULT_LABELS } from './state.js';
import { isSnoozeLocked } from './actions.js';

const MIN = 60 * 1000;
const $ = id => document.getElementById(id);

// Customizable blocks. `fixed` ones can be moved but not hidden (would lock you out).
export const THEMES = {
    dark: ['Dark', '#0b0f17', '#fff'], light: ['Light', '#fff', '#000'], navy: ['Navy', '#061430', '#fff'],
    black: ['High Contrast', '#000', '#fff'], sepia: ['Sepia', '#f4ecd8', '#000'],
    forest: ['Forest', '#0a1f14', '#fff'], plum: ['Plum', '#1a0b24', '#fff'],
};
export const BLOCKS = {
    info: { clock: 'Clock & Date', eat: 'Eating Status', times: 'Protein / Dose Times', stats: 'Interval & Doses', endtime: 'Target End Time', tools: 'Small Buttons (fixed)' },
    action: { take: 'Take Pill (fixed)', snooze: 'Snooze', undo: 'Undo' },
    tool: { backdate: 'Log Earlier Dose', settings: 'Settings (fixed)', resetday: 'Reset Day' },
};
export const FIXED = ['tools', 'take', 'settings'];

/** Saved order, dropping unknown ids and appending new ones */
export function normOrder(order, group) {
    const keys = Object.keys(BLOCKS[group]);
    const o = (Array.isArray(order) ? order : []).filter(k => keys.includes(k));
    return [...o, ...keys.filter(k => !o.includes(k))];
}

export function applyAppearance(ui) {
    const root = document.documentElement;
    const theme = THEMES[ui.theme] ? ui.theme : 'dark';
    root.dataset.theme = theme;
    root.style.setProperty('--fs', Math.min(2, Math.max(0.5, Number(ui.fontScale) || 1)));
    document.body.classList.toggle('swap', !!ui.swapSides);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEMES[theme][1]);

    const hidden = new Set(ui.hidden || []);
    const place = (group, attr, order) => normOrder(order, group).forEach((id, i) => {
        const el = document.querySelector(`[${attr}="${id}"]`);
        if (!el) return;
        el.style.order = i;
        el.hidden = hidden.has(id) && !FIXED.includes(id);
    });
    place('info', 'data-block', ui.infoOrder);
    place('action', 'data-block', ui.actionOrder);
    place('tool', 'data-tool', ui.toolOrder);
}

// Write only on change: avoids DOM thrash every 500ms
const put = (el, text) => { if (el.textContent !== text) el.textContent = text; };
const html = (el, h) => { if (el._h !== h) { el.innerHTML = h; el._h = h; } };
const mark = (el, st) => { if (el.dataset.state !== st) el.dataset.state = st; };

export function fmtTime(t) {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: !getState().settings.ui.clock24 });
}
function fmtDur(ms) {
    const m = Math.max(0, Math.ceil(ms / MIN));
    const h = Math.floor(m / 60);
    return h ? `${h}h ${m % 60}m` : `${m}m`;
}

export function updateUI() {
    const now = getNow();
    const nowMs = now.getTime();
    const state = getState();
    const d = state.data;
    const s = state.settings;
    const L = { ...DEFAULT_LABELS, ...s.ui.labels };
    const cap = getCap();
    const eatAfter = (s.eatAfterMin ?? 60) * MIN;
    const eatBefore = (s.eatBeforeMin ?? 60) * MIN;

    // 1. Clock
    put($('clock-display'), fmtTime(now));
    put($('date-display'), now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));

    // Static labels (cheap; put() skips unchanged)
    put($('eat-time-label'), L.eatTime);
    put($('dose-time-label'), L.doseTime);

    // 2. Info Grid
    const reducedInterval = d.dosesTaken > 0 && d.currentInterval < s.standardInterval;
    put($('interval-display'), `${+Number(d.currentInterval).toFixed(2)}h`);
    $('reduced-interval-badge').hidden = !reducedInterval;
    mark($('interval-card'), reducedInterval ? 'bad' : '');

    const reducedDoses = cap < s.totalDoses;
    put($('doses-display'), `${d.dosesTaken} / ${cap}`);
    $('reduced-badge').hidden = !reducedDoses;
    mark($('doses-card'), reducedDoses ? 'bad' : '');

    put($('target-end-display'), s.useEndTime ? fmtTime(new Date(2000, 0, 1, s.endHour, s.endMinute || 0)) : 'N/A (Disabled)');

    // 3. Next dose / eating / buttons
    const btnTake = $('btn-take');
    const btnSnooze = $('btn-snooze');
    const eatPanel = $('eating-panel');
    const snoozeLabel = left => `<i class="fa-solid fa-bed"></i> ${left > 0 ? `${left} Snooze${left === 1 ? '' : 's'} (${s.snoozeMinutes}m)` : 'No Snoozes Left'}`;
    let take, eat, eatTimer, eatAt = null, snoozeOk = false;

    if (d.dosesTaken === 0) {
        // Not started yet
        put($('next-dose-display'), '--:--');
        mark($('dose-time-card'), '');
        take = { st: 'first', text: L.takeFirst, action: 'pill' };
        eat = 'idle';
        eatTimer = 'Timer starts after first pill';
    } else if (d.dosesTaken >= cap) {
        // Done
        put($('next-dose-display'), 'All Done');
        mark($('dose-time-card'), 'ok');
        if (nowMs - d.lastDoseTime < eatAfter) {
            eatAt = d.lastDoseTime + eatAfter;
            eat = 'no';
            eatTimer = `Wait ${fmtDur(eatAt - nowMs)}`;
        } else {
            eat = 'yes';
            eatTimer = 'All clear';
        }
        take = s.autoResetEnabled
            ? { st: 'done', text: L.allDone, action: 'none', disabled: true }
            : { st: 'reset', text: L.resetDay, action: 'reset' };
    } else {
        // In progress
        const next = d.nextDoseScheduled;
        const preStart = next - eatBefore;
        put($('next-dose-display'), fmtTime(next));
        const due = nowMs >= next;
        mark($('dose-time-card'), due ? 'due' : '');

        // Forbidden: eatAfter after last dose, or eatBefore before next dose (incl. overdue)
        if (nowMs - d.lastDoseTime < eatAfter) {
            eatAt = d.lastDoseTime + eatAfter;
            eatTimer = `Wait ${fmtDur(eatAt - nowMs)} (post-pill)`;
        } else if (nowMs >= preStart) {
            eatAt = next + eatAfter;
            eatTimer = due ? 'Take pill first' : `Pill in ${fmtDur(next - nowMs)} (pre-pill)`;
        }
        // Post-pill window ending inside the pre-pill window: no gap to eat in
        if (eatAt !== null && eatAt >= preStart && eatAt < next + eatAfter) eatAt = next + eatAfter;
        eat = eatAt === null ? 'yes' : 'no';
        if (eat === 'yes') eatTimer = `You have ${fmtDur(preStart - nowMs)} left`;

        take = due
            ? { st: 'due', text: L.take, action: 'pill' }
            : { st: 'wait', text: `Wait ${fmtDur(next - nowMs)}`, action: 'none', disabled: true };
        snoozeOk = true;
    }

    // Eating panel + protein time card
    mark(eatPanel, eat === 'no' ? 'bad' : 'ok');
    put($('eat-status-text'), eat === 'no' ? L.eatNo : eat === 'yes' ? L.eatYes : L.eatIdle);
    put($('eat-timer-text'), eatTimer);
    put($('next-eat-display'), eatAt === null ? (eat === 'idle' ? '--:--' : 'Now') : fmtTime(eatAt));
    mark($('eat-time-card'), eat === 'no' ? 'bad' : eat === 'yes' ? 'ok' : '');

    // Take button
    mark(btnTake, take.st);
    put(btnTake, take.text);
    btnTake.dataset.action = take.action;
    btnTake.disabled = !!take.disabled;

    // Snooze button
    const left = Math.max(0, s.snoozeCount - d.snoozesUsedForCurrent);
    html(btnSnooze, snoozeOk ? snoozeLabel(left) : `<i class="fa-solid fa-bed"></i> Snooze`);
    btnSnooze.disabled = !snoozeOk || left === 0 || isSnoozeLocked();

    // Undo button
    $('btn-undo').disabled = state.history.length === 0 || isUndoLocked();
}

export function updateLoadingText(newText) {
    const splashText = $('loading-splash-text');
    if (splashText) splashText.innerText = newText;
}
