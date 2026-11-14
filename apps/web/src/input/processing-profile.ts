export type ProcessingProfile = 'noisy-room' | 'music';

/** Stable capture requests: suppress room noise only in the explicitly selected noisy-room profile. */
export function captureConstraints(deviceId: string | undefined, profile: ProcessingProfile): MediaTrackConstraints {
 return {
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  echoCancellation: false,
  noiseSuppression: profile === 'noisy-room',
  autoGainControl: false,
  channelCount: 1,
 };
}
