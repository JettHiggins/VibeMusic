import React from 'react';

export type IconName = 'play' | 'stop' | 'record' | 'undo' | 'clear' | 'metronome' | 'audio' | 'mic' | 'folder' | 'timing' | 'close' | 'search';
const paths: Record<IconName, React.ReactNode> = {
 play: <path d="m9 5 11 7-11 7Z" />,
 stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
 record: <circle cx="12" cy="12" r="6" />,
 undo: <><path d="M8 5 4 9l4 4M4 9h9a6 6 0 0 1 0 12" /></>,
 clear: <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6" /></>,
 metronome: <><path d="m8 3-4 18h16L16 3ZM12 17l5-11M7 17h10" /></>,
 audio: <><path d="m11 4-5 4H3v8h3l5 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></>,
 mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></>,
 folder: <path d="M3 6h7l2 3h9v11H3ZM3 9V4h7l2 2h7v3" />,
 timing: <><circle cx="12" cy="13" r="8" /><path d="M12 9v5l3 2M9 2h6M12 2v3M18 5l2 2" /></>,
 close: <path d="m6 6 12 12M6 18 18 6" />,
 search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>,
};
export function Icon({ name }: { name: IconName }) {
 return <svg width="19" height="19" viewBox="0 0 24 24" fill={name === 'record' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
