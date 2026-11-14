/**
 * A cancellable run tied to an audio clock (guided calibration and silence measurement).
 * It always settles: when the clock reaches `endAt`, when cancelled, or when the clock's
 * AudioContext closes (its currentTime then stops advancing, so waiting for `endAt` would hang).
 * Cleanup callbacks (e.g. stopping scheduled click nodes) run exactly once, whichever way it ends.
 */
export interface RunClock { now(): number; closed(): boolean }
export interface RunTimers { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void }
export type RunOutcome = 'done' | 'cancelled';

export class TimedRun {
 readonly settled: Promise<RunOutcome>;
 private resolve!: (outcome: RunOutcome) => void;
 private handle: unknown;
 private cleanups: (() => void)[] = [];
 private finished = false;

 constructor(private clock: RunClock, private endAt: number, onTick: () => void, tickMs = 100,
  private timers: RunTimers = { setInterval: (fn, ms) => setInterval(fn, ms), clearInterval: h => clearInterval(h as ReturnType<typeof setInterval>) }) {
  this.settled = new Promise(resolve => { this.resolve = resolve; });
  this.handle = timers.setInterval(() => {
   if (this.clock.closed()) { this.finish('cancelled'); return; }
   onTick();
   if (this.clock.now() >= this.endAt) this.finish('done');
  }, tickMs);
 }

 /** Register cleanup to run when the run ends (any outcome). Runs immediately if already ended. */
 onEnd(cleanup: () => void) { if (this.finished) cleanup(); else this.cleanups.push(cleanup); }

 cancel() { this.finish('cancelled'); }

 get active() { return !this.finished; }

 private finish(outcome: RunOutcome) {
  if (this.finished) return;
  this.finished = true;
  this.timers.clearInterval(this.handle);
  for (const c of this.cleanups.splice(0)) { try { c(); } catch { /* a node may already be stopped */ } }
  this.resolve(outcome);
 }
}
