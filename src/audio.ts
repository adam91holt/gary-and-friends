/**
 * Procedurally synthesised cues — every sound in the game is an oscillator and
 * an envelope built at runtime. No asset fetch, so nothing to preload and
 * nothing for a strict CSP to block.
 *
 * Degrades gracefully at every step: no `AudioContext` in the environment, a
 * context that never unlocks, or a muted player all take the same silent path,
 * and none of them can throw into the render loop.
 *
 * The cues are tuned as a set, not individually. Everything Gary *survives*
 * falls in pitch; the two good things — a friend joining, and beating your best
 * — are the only cues that rise, so the road has an audible sense of good news.
 */

/** Master gain applied to every cue, so mixing happens in one place. */
const MASTER = 1;

export class GameAudio {
  private mutedState = false;
  private context: AudioContext | null = null;
  private unavailable = false;

  /** Whether cues are silenced. Read by the HUD to draw the toggle. */
  get muted(): boolean {
    return this.mutedState;
  }

  set muted(value: boolean) {
    this.mutedState = value;
  }

  /** Flip mute and report the new state (the HUD's speaker button). */
  toggleMute(): boolean {
    this.mutedState = !this.mutedState;
    return this.mutedState;
  }

  /** Call only from a user gesture so browser autoplay policy is satisfied. */
  unlock(): void {
    if (this.unavailable) return;
    try {
      if (this.context === null) {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) {
          this.unavailable = true;
          return;
        }
        this.context = new Ctor();
      }
      if (this.context.state === 'suspended') {
        void this.context.resume().catch(() => undefined);
      }
    } catch {
      // No audio in this environment. The game is unaffected.
      this.unavailable = true;
    }
  }

  start(): void {
    this.tone(95, 210, 0.34, 0.055, 'sawtooth');
  }

  lane(): void {
    this.tone(180, 105, 0.11, 0.025, 'square');
  }

  /** Doppler-ish whoosh as a vehicle rushes past inches away. */
  nearMiss(): void {
    this.tone(520, 190, 0.16, 0.03, 'sine');
  }

  /**
   * A friend joins the line: a rising two-note chirp. Deliberately one of only
   * two cues in the game that go UP, so a pickup is audibly the good thing.
   */
  friend(): void {
    this.tone(440, 660, 0.1, 0.035, 'triangle');
    this.later(85, () => this.tone(660, 990, 0.14, 0.03, 'triangle'));
  }

  /**
   * The crash: a comedy honk on top of the impact thud. The honk is what turns
   * a failure state into a joke — Gary is a road cone, he is allowed to be
   * funny about being flattened.
   */
  crash(): void {
    this.tone(105, 38, 0.42, 0.14, 'triangle');
    this.tone(240, 150, 0.3, 0.05, 'sawtooth');
    this.later(150, () => this.tone(180, 96, 0.26, 0.045, 'square'));
  }

  /**
   * New personal best: a rising three-note arpeggio, the only fanfare in the
   * game. It has to be unmistakably *different* from the pickup chirp, or the
   * rarest event on the road would sound like the most common one.
   */
  highScore(): void {
    this.tone(523, 528, 0.14, 0.04, 'triangle');
    this.later(110, () => this.tone(659, 664, 0.14, 0.04, 'triangle'));
    this.later(220, () => this.tone(784, 1046, 0.42, 0.05, 'triangle'));
  }

  private later(ms: number, run: () => void): void {
    if (this.mutedState || this.unavailable) return;
    setTimeout(run, ms);
  }

  private tone(
    fromHz: number,
    toHz: number,
    duration: number,
    volume: number,
    type: OscillatorType,
  ): void {
    const context = this.context;
    if (this.mutedState || this.unavailable) return;
    if (context === null || context.state === 'closed') return;
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

    try {
      const now = context.currentTime;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(fromHz, now);
      oscillator.frequency.exponentialRampToValueAtTime(toHz, now + duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume * MASTER, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    } catch {
      // A cue failing must never take the frame down with it.
    }
  }
}
