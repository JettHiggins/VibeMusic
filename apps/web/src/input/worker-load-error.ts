export type WorkerLoadErrorEvent = Pick<ErrorEvent, 'message' | 'filename' | 'lineno' | 'colno'>;

/** Keep the failed module URL and source location visible when a browser worker fails to load. */
export function formatWorkerLoadError(event: WorkerLoadErrorEvent) {
 const details: string[] = [];
 if (event.message.trim()) details.push(event.message.trim());
 if (event.filename.trim()) {
  const line = event.lineno > 0 ? `:${event.lineno}` : '';
  const column = event.colno > 0 ? `:${event.colno}` : '';
  details.push(`${event.filename.trim()}${line}${column}`);
 }
 const suffix = details.length ? ` (${details.join('; ')})` : '';
 return `Microphone analysis failed to load${suffix}. Restart npm run dev and reload the page; if it persists, run npm ci.`;
}
