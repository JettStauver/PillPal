/**
 * State Management Module
 * Handles application state, localStorage, and history management
 */

const KEY = 'pillTrackerState';
const HISTORY_LIMIT = 5;

export const DEFAULT_LABELS = {
    eatIdle: 'You Can Eat',
    eatYes: 'Yes Protein',
    eatNo: 'No Protein',
    eatTime: 'Protein Time',
    doseTime: 'Dose Time',
    takeFirst: 'Take First Pill',
    take: 'Take Pill',
    resetDay: 'Reset Day?',
    allDone: 'All Pills Finished',
};

export const DEFAULT_STATE = {
    settings: {
        // Mode settings
        intervalMode: 'fixed', // 'fixed' or 'adaptive'

        // Basic settings
        totalDoses: 4,
        endHour: 22,
        endMinute: 0,
        useEndTime: false, // If false, no end time constraint
        standardInterval: 4,

        // Adaptive mode settings (hidden when intervalMode === 'fixed')
        minInterval: 2,
        step: 0.5,
        allowDoseReduction: true, // If false, won't drop doses
        minDoses: 4, // Minimum doses to take (only used if allowDoseReduction is true)

        // Auto-reset settings
        autoResetEnabled: false, // Whether to automatically reset the day
        autoResetHour: 0,
        autoResetMinute: 0,

        // Snooze / eating window
        snoozeCount: 4,
        snoozeMinutes: 15,
        eatBeforeMin: 60, // no protein this long before a dose
        eatAfterMin: 60,  // no protein this long after a dose

        // Beep settings
        beepInterval1: 1,  // First minute: beep every N seconds
        beepInterval2: 30, // After 1 minute: beep every N seconds
        beepVolume: 0.25,

        // Appearance / layout
        ui: {
            theme: 'dark',
            fontScale: 1,
            clock24: false,
            swapSides: false,
            keepAwake: true,
            infoOrder: ['clock', 'eat', 'times', 'stats', 'endtime', 'tools'],
            actionOrder: ['take', 'snooze', 'undo'],
            toolOrder: ['backdate', 'settings', 'resetday'],
            hidden: [],
            labels: { ...DEFAULT_LABELS },
        },
    },
    history: [], // Stack for Undo
    data: {
        dosesTaken: 0,
        lastDoseTime: null, // timestamp
        firstDoseTime: null, // timestamp of the first dose of the day
        nextDoseScheduled: null, // timestamp
        currentInterval: 4,
        snoozesUsedForCurrent: 0,
        snoozeAddedMs: 0, // total delay added by snoozes to the current dose
        timeOffset: 0, // ms difference
        dayCompleted: false,
        effectiveTotalDoses: 4 // Stores the max achievable doses
    }
};

export const clone = o => JSON.parse(JSON.stringify(o));

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
// Fill keys missing from older saved state with defaults (recursively for plain objects)
function withDefaults(saved, defs) {
    if (!isObj(saved)) return clone(defs);
    const out = { ...saved };
    for (const k in defs) {
        if (isObj(defs[k])) out[k] = withDefaults(saved[k], defs[k]);
        else if (out[k] === undefined) out[k] = clone(defs[k]);
    }
    return out;
}

function load() {
    try {
        const s = withDefaults(JSON.parse(localStorage.getItem(KEY)), DEFAULT_STATE);
        if (!Array.isArray(s.history)) s.history = [];
        return s;
    } catch (e) {
        console.warn('Saved state unreadable, starting fresh', e);
        return clone(DEFAULT_STATE);
    }
}

let state = load();

export function getState() {
    return state;
}

export function setState(newState) {
    state = newState;
}

export function saveState() {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
        console.error('Could not save state', e);
    }
}

/** The day's dose cap. One definition used by every module. */
export function getCap() {
    const s = state.settings, d = state.data;
    if (s.intervalMode === 'fixed' || !s.useEndTime) return s.totalDoses;
    return d.effectiveTotalDoses || s.totalDoses;
}

export function pushHistory() {
    state.history.push(clone(state.data));
    while (state.history.length > HISTORY_LIMIT) state.history.shift();
}

let undoLock = false;
export const isUndoLocked = () => undoLock;

export function undoLastAction() {
    if (undoLock || state.history.length === 0) return;
    undoLock = true;
    // Clock override is a setting, not an action: keep the current one
    const offset = state.data.timeOffset;
    state.data = state.history.pop();
    state.data.timeOffset = offset;
    saveState();
    setTimeout(() => { undoLock = false; }, 1500);
}

export function getNow() {
    return new Date(Date.now() + (state.data.timeOffset || 0));
}

/**
 * Start of the current logical day. With auto-reset on, the day begins at the
 * reset time (e.g. 03:00), so a 23:00 dose still belongs to "today" at 01:00.
 * Returns null when auto-reset is off (day only ends by manual reset).
 */
export function getDayStart(now = getNow()) {
    const s = state.settings;
    if (!s.autoResetEnabled) return null;
    const start = new Date(now);
    start.setHours(s.autoResetHour || 0, s.autoResetMinute || 0, 0, 0);
    if (start > now) start.setDate(start.getDate() - 1);
    return start.getTime();
}
