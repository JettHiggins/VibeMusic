import { z } from 'zod';
import { writeFileSync } from 'node:fs';
import { SessionState, SessionCommand, PerformanceEvent, PatchCandidate, ClientMessage, ServerMessage } from '../packages/contracts/src/index.ts';
for (const [name,schema] of Object.entries({SessionState,SessionCommand,PerformanceEvent,PatchCandidate,ClientMessage,ServerMessage})) writeFileSync(`packages/contracts/${name}.schema.json`, JSON.stringify(z.toJSONSchema(schema),null,2)+'\n');
