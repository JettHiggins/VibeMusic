import type { PitchSnap, SessionState } from '@voicesynth/contracts';
import { C } from './theme.ts';
import { KEY_NAMES, snapBlockedReason, withRoot, withScale } from './pitch-snap-ui.ts';

type TrackId = SessionState['tracks'][number]['id'];

/**
 * Optional key snapping. Off by default. Choosing a key only affects newly sung notes;
 * existing notes change only through the explicit, undoable snap button.
 */
export function PitchSnapControls({ settings, trackId, noteCount, enabled, onChange, onSnap }: {
 settings: PitchSnap | null;
 trackId: TrackId;
 noteCount: number;
 enabled: boolean;
 onChange: (settings: PitchSnap | null) => void;
 onSnap: () => void;
}) {
 const blocked = snapBlockedReason(settings, trackId, noteCount, enabled);
 return <div role="group" aria-label="Key snapping" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', margin: '6px 0 10px', color: C.text, fontSize: 12 }}>
  <label style={labelStyle}>Key
   <select aria-label="Key root" value={settings ? String(settings.root) : 'off'} disabled={!enabled} onChange={e => onChange(withRoot(settings, e.target.value))}>
    <option value="off">Off</option>
    {KEY_NAMES.map((name, i) => <option key={i} value={i}>{name}</option>)}
   </select>
  </label>
  <label style={labelStyle}>Scale
   <select aria-label="Key scale" value={settings?.scale ?? 'major'} disabled={!enabled || !settings} onChange={e => onChange(withScale(settings, e.target.value as PitchSnap['scale']))}>
    <option value="major">Major</option>
    <option value="minor">Minor</option>
   </select>
  </label>
  <button type="button" disabled={blocked !== null} title={blocked ?? 'Snaps this track\'s notes to the key at the next loop. Undo reverts it.'} onClick={onSnap}>Snap existing notes</button>

 </div>;
}

const labelStyle: React.CSSProperties = { display: 'flex', gap: 6, alignItems: 'center' };
