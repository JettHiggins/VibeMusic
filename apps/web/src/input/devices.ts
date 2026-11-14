/** Audio inputs; labels are only available after microphone permission was granted. */
export async function listAudioInputs(): Promise<{ deviceId: string; label: string }[]> {
 const devices = await navigator.mediaDevices.enumerateDevices();
 return devices.filter(d => d.kind === 'audioinput').map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
}
