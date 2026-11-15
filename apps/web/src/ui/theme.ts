/** Dark monochrome palette for the DAW workspace. */
export const C = {
 bg: '#0b0b0c',
 panel: '#141416',
 raised: '#1d1d20',
 line: '#2b2b30',
 lineStrong: '#3a3a40',
 text: '#e8e8ea',
 muted: '#8d8d94',
 faint: '#5a5a61',
 accent: '#f4f4f5',
 note: '#d6d6da',
 noteSelected: '#ffffff',
 pending: '#9a9aa2',
 rec: '#eeeeee',
 warn: '#dddddd',
 ok: '#e8e8ea',
} as const;
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

/** Global styles for the workspace (scoped by the .vs root class). */
export const workspaceCss = `
 html, body { background: ${C.bg}; margin: 0; color: ${C.text}; }
 .vs { font-family: system-ui, sans-serif; font-size: 13px; color: ${C.text}; }
 .vs button { background: ${C.raised}; color: ${C.text}; border: 1px solid ${C.lineStrong}; border-radius: 4px; padding: 4px 9px; font: inherit; cursor: pointer; }
 .vs button:hover:not(:disabled) { border-color: ${C.muted}; }
 .vs button:disabled { opacity: .4; cursor: default; }
 .vs button[aria-pressed=true] { background: ${C.accent}; color: #111; border-color: ${C.accent}; }
 .vs button.rec { color: ${C.rec}; border-color: ${C.rec}; }
 .vs button.rec.on { background: ${C.rec}; color: #111; }
 .vs select, .vs input:not([type=range]):not([type=checkbox]) { background: ${C.raised}; color: ${C.text}; border: 1px solid ${C.lineStrong}; border-radius: 4px; padding: 3px 6px; font: inherit; }
 .vs input[type=range] { accent-color: ${C.accent}; }
 .vs :focus-visible { outline: 2px solid ${C.accent}; outline-offset: 1px; }
 .vs h2, .vs h3 { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: ${C.muted}; margin: 0 0 6px; font-weight: 600; }
 .vs details > summary { cursor: pointer; color: ${C.muted}; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; padding: 6px 0; }
 .vs section[aria-label] { border: none !important; padding: 0 !important; margin-top: 0 !important; }
 .vs select { max-width: 100%; min-width: 0; text-overflow: ellipsis; }
 .vs-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; min-width: 0; }
 .vs-grow { flex: 1 1 auto; }
 .vs-readout { display: grid; gap: 6px; min-width: 0; }
 .vs-meter { position: relative; height: 8px; background: ${C.raised}; border-radius: 4px; overflow: hidden; }
 .vs-pitch { display: flex; gap: 14px; align-items: flex-start; padding: 6px 8px; background: ${C.raised}; border-radius: 4px; min-width: 0; }
 .vs-cell { display: grid; gap: 1px; min-width: 40px; }
 .vs-cell small { color: ${C.faint}; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
 .vs-notice { display: grid; gap: 2px; min-width: 0; overflow-wrap: anywhere; }
 .vs-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
 .vs button.vs-link { background: none; border: none; padding: 0; color: ${C.muted}; text-decoration: underline; justify-self: start; }
 .vs-active { display: grid; gap: 6px; justify-items: start; padding: 8px; border: 1px solid ${C.lineStrong}; border-radius: 4px; background: ${C.raised}; }
 .vs-field { display: grid; gap: 3px; min-width: 0; }
 .vs details.vs-sub { border-top: 1px solid ${C.line}; }
 .vs details.vs-sub > summary { letter-spacing: .06em; }
`;
