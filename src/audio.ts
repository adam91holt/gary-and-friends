/** Small, gesture-unlocked synth cues for the foundation interactions. */
export class GameAudio {
  muted = false;
  private context: AudioContext | null = null;

  /** Call only from a user gesture so browser autoplay policy is satisfied. */
  unlock(): void {
    if (this.context === null) this.context = new AudioContext();
    if (this.context.state === 'suspended') {
      void this.context.resume().catch(() => undefined);
    }
  }

  start(): void {
    this.tone(95, 210, 0.34, 0.055, 'sawtooth');
  }

  lane(): void {
    this.tone(180, 105, 0.11, 0.025, 'square');
  }

  crash(): void {
    this.tone(105, 38, 0.42, 0.14, 'triangle');
  }

  private tone(
    fromHz: number,
    toHz: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const context = this.context;
    if (this.muted || context === null || context.state === 'closed') return;
    if (context.state === 'suspended') {
      void context
        .resume()
        .then(() => {
          if (context.state === 'running') {
            this.tone(fromHz, toHz, duration, volume, type);
          }
        })
        .catch(() => undefined);
      return;
    }

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(toHz, now + duration);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }
}
