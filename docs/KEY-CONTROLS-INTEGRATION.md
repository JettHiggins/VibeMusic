# Reviewed key UI integration from PR 40

WS1 adopted only Leo's d68acd9846fed7fb116bdc2dd8d8030ef463d46e commit from PR #40. The browser-action executor commit 255c4dd is excluded pending the two reproduced lifecycle fixes in reviews/PR40-INPUT-ACTION-REVIEW.md. Git history retains the original owner commit, so the remaining PR can merge without duplicating the key controls.

Visible root/major/minor/Off settings affect new sung notes and shared-helper provisional previews. Raw performance MIDI remains untouched until authoritative commit. The explicit existing-track Snap uses next-loop and is undoable; changing the setting alone preserves existing music. No new calibration capability is advertised by this split.

Validation on the key-only combination: Node 227 passed/one optional skip; shared schema checks and production build passed. Chromium tests/browser/ws2-key-controls.js passed actual visible selection -> unchanged music -> explicit G-sharp-to-G snap -> Undo -> Off/disabled button. It uses real WASM and seeded music/synthetic silence, not physical microphone or human hearing. Prior actual-browser singing-path tests and exact-head engine CI remain documented in MUSICAL-CONTROLS-INTEGRATION.md.

Leo: continue fixing only the remaining executor lifecycle work; retarget PR #40 to engine-integration and preserve these integrated changes. Lenny: base new tools on current shared source. Whole-sentence endpointing, acoustic stop and real calibration/hands-free/fun acceptance remain open.
