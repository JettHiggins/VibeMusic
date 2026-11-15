import { SessionState } from '@voicesynth/contracts';

/**
 * Versioned local save and JSON import/export of musical state.
 * The envelope is ours (Workstream 2); the payload is the shared SessionState v1 contract.
 * Applying a loaded session to the engine needs a replace/load command from Workstream 1.
 */
export const FORMAT = 'voicesynth-session';
export const FORMAT_VERSION = 1;
export interface SessionFile { format: typeof FORMAT; formatVersion: typeof FORMAT_VERSION; savedAt: string; name: string; session: SessionState }

export function toSessionFile(session: SessionState, name: string, now = new Date()): SessionFile {
 return { format: FORMAT, formatVersion: FORMAT_VERSION, savedAt: now.toISOString(), name: name.trim() || 'Untitled', session: SessionState.parse(session) };
}

export function exportSession(session: SessionState, name: string, now?: Date) { return JSON.stringify(toSessionFile(session, name, now), null, 1); }

/** Accepts our envelope or a bare SessionState; rejects anything else with a readable reason. */
export function importSession(text: string): SessionFile {
 let raw: unknown;
 try { raw = JSON.parse(text); } catch { throw new Error('Not a JSON file'); }
 if (!raw || typeof raw !== 'object') throw new Error('Not a VoiceSynthesizer session');
 const value = raw as Partial<SessionFile> & { version?: unknown };
 if (value.format === undefined && value.version === 1) return toSessionFile(parse(raw), 'Imported session');
 if (value.format !== FORMAT) throw new Error('Not a VoiceSynthesizer session');
 if (value.formatVersion !== FORMAT_VERSION) throw new Error(`Unsupported session file version ${String(value.formatVersion)}`);
 return { format: FORMAT, formatVersion: FORMAT_VERSION, savedAt: typeof value.savedAt === 'string' ? value.savedAt : new Date(0).toISOString(), name: typeof value.name === 'string' && value.name.trim() ? value.name : 'Untitled', session: parse(value.session) };
}

function parse(session: unknown) {
 const result = SessionState.safeParse(session);
 if (!result.success) throw new Error(`Session is invalid: ${result.error.issues.slice(0, 3).map(i => `${i.path.join('.') || 'session'} ${i.message}`).join('; ')}`);
 const ids = result.data.tracks.map(t => t.id);
 if (new Set(ids).size !== ids.length) throw new Error('Session is invalid: duplicate track IDs');
 return result.data;
}

const KEY = 'voicesynth.sessions.v1';
export interface KeyValueStore { getItem(key: string): string | null; setItem(key: string, value: string): void }
const storage = (): KeyValueStore | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function listSaved(store = storage()): { name: string; savedAt: string }[] {
 return readAll(store).map(({ name, savedAt }) => ({ name, savedAt })).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
export function saveLocal(session: SessionState, name: string, store = storage(), now?: Date) {
 if (!store) throw new Error('Browser storage is unavailable; export a file instead');
 const file = toSessionFile(session, name, now);
 const all = readAll(store).filter(f => f.name !== file.name);
 all.push(file);
 store.setItem(KEY, JSON.stringify(all));
 return file;
}
export function loadLocal(name: string, store = storage()): SessionFile {
 const file = readAll(store).find(f => f.name === name);
 if (!file) throw new Error(`No saved session named “${name}”`);
 return file;
}
function readAll(store: KeyValueStore | null): SessionFile[] {
 try {
  const raw = JSON.parse(store?.getItem(KEY) ?? '[]');
  if (!Array.isArray(raw)) return [];
  // Skip corrupt or future entries rather than losing every save.
  return raw.flatMap(entry => { try { return [importSession(JSON.stringify(entry))]; } catch { return []; } });
 } catch { return []; }
}
