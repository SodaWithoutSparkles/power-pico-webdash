// Audio alert for detector events. Uses Web Audio API (ponytail: no deps).
// AudioContext must be created/resumed after a user gesture (connect/start button).

let audioCtx: AudioContext | null = null;

// Must be called after a user gesture (connect/start button click).
export function unlockAudio(): void {
    if (!audioCtx) {
        audioCtx = new AudioContext();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

export function playDetectorBeep(channel: 'v' | 'i'): void {
    if (!audioCtx || audioCtx.state === 'suspended') return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    // Different frequency per channel: V=high (880 Hz), I=low (440 Hz).
    osc.frequency.value = channel === 'v' ? 880 : 440;
    osc.type = 'square';
    gain.gain.value = 0.1;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.15);
}
