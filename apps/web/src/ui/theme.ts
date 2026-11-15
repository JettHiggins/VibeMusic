/** Dark monochrome palette for the DAW workspace. */
export const C = {
 bg: '#0b0b0c',
 panel: '#141416',
 raised: '#1d1d20',
 line: '#2b2b30',
 lineStrong: '#3a3a40',
 text: '#e8e8ea',
 muted: '#8d8d94',
 faint: '#80808a',
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
export const workspaceCss = ` html { color-scheme: dark; }
 .vs { padding-bottom: env(safe-area-inset-bottom); }
 .vs button, .vs a, .vs summary { touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
 .vs h1, .vs h2, .vs h3 { text-wrap: balance; scroll-margin-top: 90px; }
 .vs .vs-icon-button { display: inline-flex; align-items: center; justify-content: center; width: 38px; height: 38px; flex: none; padding: 0; border-color: transparent; background: transparent; border-radius: 6px; }
 .vs .vs-icon-button:hover:not(:disabled) { background: ${C.raised}; border-color: ${C.lineStrong}; }
 .vs .vs-icon-button[aria-pressed=true], .vs .vs-primary { background: ${C.accent}; color: #111; }
 .vs-toolbar { position: sticky; top: 0; z-index: 30; background: ${C.bg}; border-bottom: 1px solid ${C.line}; padding: 12px max(12px, env(safe-area-inset-left)); }
 .vs-toolbar-controls { display: flex; align-items: center; justify-content: center; gap: 5px; flex-wrap: wrap; }
 .vs-toolbar-divider { width: 1px; height: 22px; margin: 0 7px; background: ${C.line}; }
 .vs-tempo { display: flex; align-items: center; font-family: ${MONO}; font-variant-numeric: tabular-nums; }
 .vs-tempo > span { display: grid; justify-items: center; min-width: 36px; font-size: 14px; }
 .vs-tempo small { color: ${C.muted}; font-size: 9px; letter-spacing: .06em; }
 .vs-position { color: ${C.muted}; font-family: ${MONO}; font-variant-numeric: tabular-nums; min-width: 36px; text-align: center; }
 .vs-toolbar-error { max-width: 720px; margin: 8px auto 0; overflow-wrap: anywhere; text-align: center; color: ${C.text}; }
 .vs-voice { display: flex; align-items: center; gap: 6px; width: 176px; min-width: 0; }
 .vs-voice-copy { display: grid; gap: 2px; min-width: 0; font-size: 11px; color: ${C.muted}; }
 .vs-voice-copy > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
 .vs-heard { max-width: 125px; color: ${C.text}; }
 .vs .vs-mic-button { position: relative; border: 1px solid ${C.lineStrong}; }
 .vs .vs-mic-button[aria-pressed=true] { background: ${C.raised}; color: ${C.muted}; }
 .vs-voice[data-active=true] .vs-mic-button { color: ${C.text}; border-color: ${C.accent}; }
 .vs-voice[data-active=true] .vs-mic-button::after { content: ''; position: absolute; inset: -4px; border: 1px solid ${C.muted}; border-radius: 10px; pointer-events: none; animation: vs-listening 1.1s ease-out infinite; }
 @keyframes vs-listening { from { transform: scale(.95); opacity: .8; } to { transform: scale(1.12); opacity: 0; } }
 .vs-timing-dialog { color: ${C.text}; background: ${C.panel}; width: min(420px, calc(100vw - 48px)); max-height: calc(100dvh - 48px); box-sizing: border-box; border: 1px solid ${C.lineStrong}; border-radius: 10px; padding: 24px; overscroll-behavior: contain; overflow-y: auto; }
 .vs-timing-dialog::backdrop { background: #000b; }
 .vs-dialog-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
 .vs .vs-dialog-heading h2 { margin: 0; font-size: 16px; text-transform: none; letter-spacing: 0; color: ${C.text}; }
 .vs-timing-dialog p { line-height: 1.6; color: ${C.muted}; }
 .vs-timing-steps { display: flex; gap: 20px; padding: 16px 0 24px; justify-content: space-between; }
 .vs-timing-steps > span { display: grid; gap: 6px; font-size: 11px; color: ${C.muted}; }
 .vs-timing-steps b { font-size: 24px; color: ${C.text}; font-weight: 500; font-variant-numeric: tabular-nums; }
 .vs-dialog-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
 .vs-dialog-actions button { min-height: 36px; }
 .vs-generation { display: flex; align-items: center; gap: 12px; padding: 12px 20px; background: ${C.raised}; border-bottom: 1px solid ${C.lineStrong}; min-width: 0; }
 .vs-generation-copy { display: grid; gap: 3px; min-width: 0; flex: 1; }
 .vs-generation-description { color: ${C.muted}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
 .vs-generation[data-error=true] .vs-generation-description { white-space: normal; overflow-wrap: anywhere; }
 .vs-generation progress { width: min(140px, 18vw); height: 4px; accent-color: ${C.accent}; }
 .vs-generation a { color: ${C.text}; text-underline-offset: 3px; white-space: nowrap; }
 .vs-generation a:hover { color: white; }
 .vs-spinner { display: inline-block; width: 15px; height: 15px; border: 2px solid ${C.lineStrong}; border-top-color: ${C.accent}; border-radius: 50%; flex: none; animation: vs-spin .85s linear infinite; }
 .vs-ready-dot { width: 8px; height: 8px; border-radius: 50%; background: ${C.accent}; flex: none; margin: 4px; }
 @keyframes vs-spin { to { transform: rotate(360deg); } }
 .vs-research { scroll-margin-top: 90px; min-width: 0; }
 .vs-research form { display: grid; gap: 8px; }
 .vs-research .vs-generate-button { display: flex; align-items: center; gap: 8px; justify-content: center; min-height: 34px; }
 .vs-research p { overflow-wrap: anywhere; }
 .vs-sound-option { display: grid; gap: 10px; padding: 12px 0; border-bottom: 1px solid ${C.line}; }
 .vs-skip-link { position: fixed; left: 12px; top: -100px; background: ${C.accent}; color: #111; padding: 10px; z-index: 100; }
 .vs-skip-link:focus-visible { top: 12px; }
 @media (max-width: 720px) { .vs-session-popup { position: fixed !important; top: calc(var(--vs-top, 64px) + 8px) !important; right: 12px !important; max-height: calc(100dvh - var(--vs-top, 64px) - 24px); overflow: auto; overscroll-behavior: contain; } .vs-toolbar { padding: 8px; } .vs-toolbar-controls { gap: 2px; } .vs-toolbar-divider { margin: 0 3px; } .vs-voice { width: 150px; } }
 @media (prefers-reduced-motion: reduce) { .vs-spinner, .vs-voice[data-active=true] .vs-mic-button::after { animation: none; } .vs-generation progress:not([value]) { display: none; } .vs-voice[data-active=true] .vs-mic-button::after { opacity: .6; } }

 html, body { background: ${C.bg}; margin: 0; color: ${C.text}; }
 .vs { font-family: system-ui, sans-serif; font-size: 13px; color: ${C.text}; }
 .vs-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
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
