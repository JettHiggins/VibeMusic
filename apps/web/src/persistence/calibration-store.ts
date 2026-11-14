import type { InputCalibration } from '../input/calibration.ts';
import type { ProcessingProfile } from '../input/processing-profile.ts';

/** Per-device input calibration. Contains only numbers; never audio. */
const KEY = 'voicesynth.input-calibration.v1';
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }

function storage(): KeyValueStore | null { try { return globalThis.localStorage ?? null; } catch { return null; } }

export function loadCalibration(deviceId: string | null, store = storage(), profile: ProcessingProfile = 'noisy-room'): InputCalibration | null {
 try {
  const all = JSON.parse(store?.getItem(KEY) ?? '{}') as Record<string, InputCalibration>;
  const device = deviceId ?? 'default';
  const value = all[`${device}|${profile}`] ?? (profile === 'music' ? all[device] : undefined);
  if (!value || value.version !== 1 || ![value.noiseFloorDb, value.latencyFrames, value.sampleRate].every(Number.isFinite)) return null;
  return value;
 } catch { return null; }
}

export function saveCalibration(calibration: InputCalibration, store = storage(), profile: ProcessingProfile = 'noisy-room') {
 if (!store) return;
 try {
  const all = JSON.parse(store.getItem(KEY) ?? '{}') as Record<string, InputCalibration>;
  all[`${calibration.deviceId ?? 'default'}|${profile}`] = calibration;
  store.setItem(KEY, JSON.stringify(all));
 } catch { /* Storage can be unavailable (private mode); calibration then lasts for this session only. */ }
}
