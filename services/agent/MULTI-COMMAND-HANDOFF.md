# Multiple spoken commands per segment

Your physical microphone test transcribed ?Groove, record kick. Groove, stop.? as one segment. The old interpreter issued only Record. The speech connection now splits on whole wake words, issues each command with a distinct ID in spoken order, and excludes the measured segment once before commands and classified coverage. This applies to normal and held/joined speech segments. No word-level timestamps are invented: all pieces retain the segment-start capture context; obsolete takes refuse all pieces.

A Record followed by Stop in the same result cancels the newly armed recording and keeps playback. Bare Stop while armed now also cancels recording; explicit Stop playback still stops transport. The optional mic self-check reports the same split.

Validation: speech harness covers idle/recording compound Record/Stop, unknown first command, deduplication, obsolete take rejection, span/coverage ordering and whole-word matching. Full backend suite results are recorded in the PR. Tests use scripted transcripts, not new human microphone evidence.

Next: WS1 reviews this focused PR against engine-integration, integrates it, then verifies with the actual browser speech sender and physical voice. Raw microphone audio and the exported conversation are not committed.
