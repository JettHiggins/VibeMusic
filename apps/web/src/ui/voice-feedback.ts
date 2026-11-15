import type { ServerMessage } from '@voicesynth/contracts';
export type HeardSpeech = Extract<ServerMessage, { type: 'speech-transcript' }>;

/** Display feedback follows a correlated response; it never applies or verifies audio. */
export function updateHeardSpeech(previous: HeardSpeech | null, message: ServerMessage): HeardSpeech | null {
 if (message.type === 'speech-transcript') return message.outcome === 'ignored' ? previous : message;
 if (!previous || previous.outcome !== 'interpreting') return previous;
 const id = message.type === 'command' ? message.command.id
  : message.type === 'error' || message.type === 'research-context' ? message.requestId
  : message.type === 'browser-action' || message.type === 'candidate-preview' ? message.id : null;
 if (!id || (id !== previous.utteranceId && !id.startsWith(`${previous.utteranceId}:`))) return previous;
 return { ...previous, outcome: message.type === 'error' ? 'refused' : message.type === 'research-context' ? 'research' : 'command',
  ...(message.type === 'error' ? { detail: message.message } : {}) };
}
