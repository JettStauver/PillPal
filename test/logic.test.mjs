// Logic self-check for scheduler/actions/watchdog. Run: npm test
import assert from 'node:assert/strict';

const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
globalThis.window = { confirm: () => true };

// Freeze "now" so tests are deterministic
let NOW = new Date(2026, 10, 14, 8, 0).getTime();
Date.now = () => NOW;
const at = (h, m = 0, dayDelta = 0) => new Date(2026, 10, 14 + dayDelta, h, m).getTime();

const S = await import('../public/js_modules/state.js');
const A = await import('../public/js_modules/actions.js');
const { runWatchdog } = await import('../public/js_modules/watchdog.js');
const fresh = (settings = {}) => { S.setState(S.clone(S.DEFAULT_STATE)); Object.assign(S.getState().settings, settings); return S.getState(); };


// 1. Fixed mode: interval + cap
let s = fresh();
assert.ok(A.takePill());
assert.equal(s.data.nextDoseScheduled, at(12));
NOW = at(12); A.takePill(); NOW = at(16); A.takePill(); NOW = at(20); A.takePill();
assert.equal(s.data.dosesTaken, 4);
assert.equal(A.takePill(), false, 'cap enforced');
assert.equal(s.data.dayCompleted, true);

// 2. History limit is 5
assert.equal(s.history.length, 4);
s = fresh(); NOW = at(8);
for (let i = 0; i < 4; i++) { A.takePill(); NOW += 5 * 3600e3; }
s.settings.totalDoses = 10; for (let i = 0; i < 4; i++) A.takePill();
assert.equal(s.history.length, 5);

// 3. Snooze: refused snooze adds no history; overdue snooze counts from now; survives recalculation
s = fresh(); NOW = at(8);
A.snooze(); assert.equal(s.history.length, 0, 'no snooze before first pill');
A.takePill(); NOW = at(13); // due 12:00, 1h overdue
A.snooze();
assert.equal(s.data.nextDoseScheduled, at(13, 15));
runWatchdog(); // recalculates schedule
assert.equal(s.data.nextDoseScheduled, at(13, 15), 'snooze survives recalculation');

// 4. Auto reset at 03:00: a 23:00 dose survives midnight, resets at 03:00
s = fresh({ autoResetEnabled: true, autoResetHour: 3 });
NOW = at(23); A.takePill();
NOW = at(1, 0, 1); A.checkReset(); runWatchdog();
assert.equal(s.data.dosesTaken, 1, 'not reset at midnight');
NOW = at(3, 0, 1); A.checkReset();
assert.equal(s.data.dosesTaken, 0, 'reset at 03:00');
assert.equal(s.history.length, 0, 'reset clears undo');

// 5. Backdated dose before reset hour is clamped, not wiped
s = fresh({ autoResetEnabled: true, autoResetHour: 6 });
NOW = at(8); A.takePillAt(at(5, 30)); A.checkReset();
assert.equal(s.data.dosesTaken, 1);
assert.equal(s.data.firstDoseTime, at(6));

// 6. Adaptive: step 0 doesn't hang; end before last dose doesn't go negative
s = fresh({ intervalMode: 'adaptive', useEndTime: true, endHour: 10, step: 0, minDoses: 1 });
NOW = at(8); A.takePill();
assert.ok(s.data.effectiveTotalDoses >= s.data.dosesTaken);
assert.equal(S.getCap(), 2);

// 7. Undo keeps clock offset
s = fresh(); NOW = at(8); A.takePill(); s.data.timeOffset = 1234; S.undoLastAction();
assert.equal(s.data.dosesTaken, 0); assert.equal(s.data.timeOffset, 1234);

// 8. Future timestamps (after clearing a clock override) are clamped, day kept
s = fresh(); NOW = at(8); A.takePill(); s.data.lastDoseTime = s.data.firstDoseTime = at(11); runWatchdog();
assert.equal(s.data.dosesTaken, 1); assert.equal(s.data.lastDoseTime, at(8));

// 9. Old saved state gains new keys
store.pillTrackerState = JSON.stringify({ settings: { totalDoses: 3 }, data: { dosesTaken: 1 }, history: [] });
const fresh2 = await import('../public/js_modules/state.js?reload');
assert.equal(fresh2.getState().settings.totalDoses, 3);
assert.equal(fresh2.getState().settings.snoozeCount, 4);
assert.equal(fresh2.getState().settings.ui.theme, 'dark');
store.pillTrackerState = '{';
const fresh3 = await import('../public/js_modules/state.js?corrupt');
assert.equal(fresh3.getState().data.dosesTaken, 0, 'corrupt storage -> defaults');

// 10. Idle reset: skipped last dose doesn't carry into next morning
s = fresh({ idleResetHours: 16 });
NOW = at(8); A.takePill();             // next due 12:00
NOW = at(12) + 15.9 * 3600e3; A.checkReset(); assert.equal(s.data.dosesTaken, 1);
NOW = at(12) + 16.1 * 3600e3; A.checkReset(); assert.equal(s.data.dosesTaken, 0, 'idle reset');
s = fresh({ idleResetHours: 0 }); NOW = at(8); A.takePill(); NOW = at(8, 0, 3); A.checkReset();
assert.equal(s.data.dosesTaken, 1, 'idle reset off');

console.log('logic ok');
