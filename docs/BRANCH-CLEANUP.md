# Integrated branch retirement

The following old remote branch tips are included in the reviewed integration ancestry. These 20 refs were retired atomically after ledger publication at 7ca2e74, using exact-SHA leases so a teammate's newer push could not be deleted. All commits remain reachable through engine-integration. Local branches/worktrees are not deleted. Current ws3 capability/validation/proposal branches, ws1/speech-capture, main/integration and all nonancestor tips remain intact. ui-input-fixes is retained because its exact tip is not an ancestor, even though equivalent fixes/tests are present.

| Retired remote branch | Preserved tip |
| --- | --- |
| agent-clap-retrieval | 0465dd7f53167fe343dcaa03f1cddcda2253b5f7 |
| agent-issue3-tests | 75f41811e9c79e46e64bad8648e9047517939d2e |
| agent-local-stt | d637213face25f6561402129367a6226e6d6bc9c |
| agent-recording-usability | b8613d633a965f28ec694a62456b5effd635b4d3 |
| agent-sound | 3a6272409b4afc43c2eef24ed7b88922ee613092 |
| agent-sound-research | 8fae6aac32bf44267d1321d4f0f3ec15b0b2c336 |
| agent-speech-pipeline | c62613de07776def391c1e8fdd01d0db122092f7 |
| agent-speech-transport | 49ca90be1faa00ceb9dceabdd46141dc914f308b |
| ui-input | 3426beefb6a09858f41fcec93f33c942a5cce2b1 |
| ui-melody | e5db75050fcedfe2218d6bd0d4969092a7768196 |
| ws1/dev-worklet-sync | 248585ab7fd0732de87ec3e516cd543a4c6ba383 |
| ws1/integration-preview | 0b95ca15d7ea2c78954f65e1a6b71cfd512e444e |
| ws1/recording-consumer | 4d6c90ccb50a491dad91e8e3de6d0073506e5337 |
| ws1/recording-usability | ece7d8016d121ad72b29443477dc3fe1b46c4ede |
| ws2-calibration-ux | 10113cf4a3e2f527f66855353ee0a6c5b8d8f4eb |
| ws2-mic-loader-diagnostics | d34f10ee28ce95a415bd823c2e6feae0a8bfae4c |
| ws2-mic-testing | 11c5553cbd7521d9509cb48d2b3c1c7f83140d98 |
| ws2-speech-capture-notes | 538e5a370dd1fb2019e17c8ec0b9aa886cb6af5d |
| ws2-workspace | 98976525285de86c1895ae57c6891df637df2966 |
| ws2/recording-consumer | cfa89a2849849e22e0e652838f651e9ba18762cd |

After retirement, teammates can run `git fetch origin --prune`. Preserve local work and create future capability branches from origin/engine-integration. A local branch may show a gone upstream; do not force-push it back as new work.
