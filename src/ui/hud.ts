/**
 * The DOM overlay: menu, in-play telemetry HUD, game-over card, and the async
 * loading skeleton shown until the WebGL scene reports its first frame.
 *
 * Rendering-side (owns DOM, reads the store, never mutates game state except
 * through published store actions on explicit user intent). It subscribes to the
 * GameStore and re-renders on change — the store is the source of truth, this is
 * a projection of it, exactly like the test API.
 *
 * Design system: dark-first surfaces, the single owned --accent, a paired
 * display/mono type scale, motion only on state change (transform/opacity, with
 * a prefers-reduced-motion path), and one consistent inline-SVG icon set (no
 * emoji, no second icon library). The distinctive idea: the whole overlay reads
 * as a retro highway instrument cluster — mono telemetry numerals, an accent
 * speed bar, a card that docks over the moving road rather than covering it.
 */
import { intensityForSpeed } from '../game/gameplay/difficulty.ts';
import { NEAR_MISS_BONUS } from '../game/gameplay/run.ts';
import type { GameState, GameStore, GameStatus } from '../game/state.ts';

/* ── Icon set (one family: 24×24, stroke 2, round caps) ───────────────────── */

const ns = 'stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

const icon = {
  score: `<svg viewBox="0 0 24 24" ${ns}><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6"/></svg>`,
  friend: `<svg viewBox="0 0 24 24" ${ns}><circle cx="9" cy="8" r="3.2"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6"/><path d="M17 14.4A5.5 5.5 0 0 1 20.5 20"/></svg>`,
  speed: `<svg viewBox="0 0 24 24" ${ns}><path d="M4 18a8 8 0 1 1 16 0"/><path d="M12 18l4-5"/><circle cx="12" cy="18" r="1"/></svg>`,
  play: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5v13l11-6.5z"/></svg>`,
  // Speed-lines chevron: the "you threaded that one" mark.
  nearMiss: `<svg viewBox="0 0 24 24" ${ns}><path d="M13 4 6 12l7 8"/><path d="M20 4l-7 8 7 8"/></svg>`,
  crash: `<svg viewBox="0 0 24 24" ${ns}><path d="M4 18h16L15.5 7h-7z"/><path d="M8 14h8M7 4 5.5 2M17 4l1.5-2M19 8l2-1"/></svg>`,
};

/* ── Component styles (tokens live in index.html :root) ────────────────────── */

const CSS = `
#hud * { box-sizing: border-box; margin: 0; }
#hud button { font-family: inherit; }

/* Screen containers cross-fade on state change. */
#hud .screen {
  position: absolute; inset: 0;
  display: grid; place-items: center;
  opacity: 0; transform: scale(0.985);
  transition: opacity 0.35s var(--ease), transform 0.35s var(--ease);
  pointer-events: none;
}
#hud[data-screen="loading"] .screen.loading,
#hud[data-screen="menu"] .screen.menu,
#hud[data-screen="gameover"] .screen.gameover {
  opacity: 1; transform: none; pointer-events: auto;
}
/* The playbar is not a modal screen — it lives at the top edge while playing. */
#hud .playbar {
  position: absolute; top: 0; left: 0; right: 0;
  display: flex; gap: 12px; justify-content: center;
  padding: 18px 20px;
  opacity: 0; transform: translateY(-14px);
  transition: opacity 0.3s var(--ease), transform 0.3s var(--ease);
  pointer-events: none;
}
#hud[data-screen="playing"] .playbar,
#hud[data-screen="gameover"] .playbar { opacity: 1; transform: none; }

/* Modal cards sit over a vignette that lets the road show through. */
#hud .scrim {
  position: absolute; inset: 0;
  background: radial-gradient(ellipse at 50% 55%, rgba(14,14,24,0.05), rgba(10,10,18,0.72) 78%);
}
/* The menu is a composed shot: card docked left, Gary posing on the right. Its
   scrim is weighted to the left so it darkens behind the type without dimming
   him. Below ~900px there's no room beside the card, so it re-centres and the
   scrim goes symmetric (the 3D rig keeps him visible under the card's offset). */
#hud .screen.menu { place-items: center start; }
#hud .screen.menu .card { margin-left: clamp(24px, 7vw, 104px); text-align: left; }
#hud .screen.menu .scrim {
  background: linear-gradient(100deg, rgba(10,10,18,0.9) 30%, rgba(10,10,18,0.34) 62%, rgba(10,10,18,0.62));
}
#hud .screen.menu .legend { justify-content: flex-start; }
@media (max-width: 900px) {
  #hud .screen.menu { place-items: center; }
  #hud .screen.menu .card { margin-left: 0; text-align: center; }
  #hud .screen.menu .scrim {
    background: radial-gradient(ellipse at 50% 55%, rgba(14,14,24,0.15), rgba(10,10,18,0.8) 78%);
  }
  #hud .screen.menu .legend { justify-content: center; }
}
/* Cards ride above centre so the road keeps running underneath them. */
#hud .card {
  position: relative;
  margin-bottom: 12vh;
  text-align: center;
  padding: 40px 44px;
  border-radius: 20px;
  background: var(--surface);
  border: 1px solid var(--hairline);
  backdrop-filter: blur(14px);
  box-shadow: 0 24px 60px rgba(0,0,0,0.5), inset 0 1px 0 var(--hairline-strong);
  max-width: min(90vw, 460px);
}

/* Type: eyebrow / hero / title / tagline. */
#hud .eyebrow {
  font-size: var(--fs-label); font-weight: 600;
  letter-spacing: 0.34em; text-transform: uppercase;
  color: var(--accent);
}
#hud .hero {
  font-size: var(--fs-hero); font-weight: 700; line-height: 0.94;
  letter-spacing: -0.02em; margin: 14px 0 0;
}
#hud .hero .amp { color: var(--accent); }
#hud .title {
  font-size: var(--fs-title); font-weight: 700; letter-spacing: -0.02em;
  line-height: 1.05; margin-top: 8px;
}
#hud .tagline {
  font-size: var(--fs-body); color: var(--text-dim);
  margin-top: 12px; line-height: 1.5;
}

/* Primary button. */
#hud .btn {
  display: inline-flex; align-items: center; gap: 10px;
  margin-top: 26px; padding: 14px 26px;
  font-size: 0.95rem; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent-ink);
  background: linear-gradient(180deg, var(--accent-2), var(--accent));
  border: none; border-radius: 12px; cursor: pointer;
  box-shadow: 0 10px 24px var(--accent-glow), inset 0 1px 0 rgba(255,255,255,0.35);
  transition: transform 0.12s var(--ease), box-shadow 0.2s var(--ease), filter 0.2s var(--ease);
}
#hud .btn svg { width: 18px; height: 18px; }
#hud .btn:hover { transform: translateY(-2px); box-shadow: 0 16px 34px var(--accent-glow); filter: brightness(1.06); }
#hud .btn:active { transform: translateY(0) scale(0.97); }
#hud .btn:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 3px; }

/* Controls legend. */
#hud .legend {
  display: flex; gap: 18px; justify-content: center;
  margin-top: 22px; color: var(--text-faint);
  font-size: var(--fs-label); letter-spacing: 0.1em; text-transform: uppercase;
}
#hud .legend b { color: var(--text-dim); font-weight: 700; }
#hud .play-hint {
  align-self: center; padding: 8px 11px; border-radius: 10px;
  color: var(--text-faint); background: var(--surface-hud);
  border: 1px solid var(--hairline); backdrop-filter: blur(10px);
  font-size: var(--fs-label); letter-spacing: 0.08em; text-transform: uppercase;
}
#hud .play-hint b { color: var(--accent-2); }

/* Telemetry readouts (instrument-dense). */
#hud .readout {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px; min-width: 116px;
  background: var(--surface-hud); border: 1px solid var(--hairline);
  border-radius: 12px; backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 var(--hairline-strong);
}
#hud .readout .ic {
  display: grid; place-items: center;
  width: 26px; height: 26px; color: var(--accent);
}
#hud .readout .ic svg { width: 20px; height: 20px; }
#hud .readout .meta { display: flex; flex-direction: column; line-height: 1; text-align: left; }
#hud .readout .lbl {
  font-size: 0.62rem; font-weight: 600; letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--text-faint);
}
#hud .readout .val {
  font-family: var(--font-mono); font-size: var(--fs-readout);
  font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
  color: var(--text); margin-top: 3px;
  transition: color 0.15s var(--ease);
}
#hud .readout.bump .val { animation: hud-bump 0.34s var(--ease); }
@keyframes hud-bump {
  0% { color: var(--accent); transform: scale(1); }
  35% { transform: scale(1.16); }
  100% { transform: scale(1); }
}

/* Speed readout gets a little accent bar showing throttle. */
#hud .speed { flex-direction: column; align-items: stretch; min-width: 148px; gap: 6px; }
#hud .speed .row { display: flex; align-items: center; gap: 10px; }
#hud .bar { height: 4px; border-radius: 999px; background: var(--hairline); overflow: hidden; }
#hud .bar > i {
  display: block; height: 100%; width: 100%;
  transform: scaleX(0); transform-origin: left center;
  background: linear-gradient(90deg, var(--accent-2), var(--accent));
  transition: transform 0.25s var(--ease);
}

/* Near-miss toast — the reward for the risky line. Sits under the playbar so it
   reads as instrument feedback, not a notification. Transform/opacity only. */
#hud .nearmiss {
  position: absolute; top: 124px; left: 50%;
  display: flex; align-items: center; gap: 8px;
  padding: 7px 14px 7px 11px; border-radius: 999px;
  color: var(--accent-2);
  background: var(--surface-hud); border: 1px solid var(--accent-glow);
  box-shadow: 0 6px 22px var(--accent-glow);
  backdrop-filter: blur(10px);
  font-size: var(--fs-label); font-weight: 700;
  letter-spacing: 0.18em; text-transform: uppercase;
  opacity: 0; transform: translate(-50%, -6px);
  pointer-events: none;
}
#hud .nearmiss svg { width: 15px; height: 15px; }
#hud .nearmiss .pts {
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  letter-spacing: 0; color: var(--accent);
}
#hud .nearmiss.show { animation: nearmiss 0.62s var(--ease); }
@keyframes nearmiss {
  0%   { opacity: 0; transform: translate(-50%, 2px) scale(0.94); }
  18%  { opacity: 1; transform: translate(-50%, -6px) scale(1); }
  70%  { opacity: 1; transform: translate(-50%, -8px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -16px) scale(1); }
}

/* Game-over stats. */
#hud .stats { display: flex; gap: 28px; justify-content: center; margin-top: 20px; }
#hud .stat .n {
  font-family: var(--font-mono); font-size: 2rem; font-weight: 600;
  font-variant-numeric: tabular-nums; color: var(--accent);
}
#hud .stat .k {
  font-size: var(--fs-label); letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--text-faint); margin-top: 4px;
}
#hud .crash { color: var(--danger); display: inline-grid; place-items: center; }
#hud .crash svg { width: 40px; height: 40px; }
#hud[data-screen="gameover"] .screen.gameover .crash,
#hud[data-screen="gameover"] .screen.gameover .eyebrow,
#hud[data-screen="gameover"] .screen.gameover .title,
#hud[data-screen="gameover"] .screen.gameover .stats,
#hud[data-screen="gameover"] .screen.gameover .btn {
  animation: rise 0.4s var(--ease) backwards;
}
#hud[data-screen="gameover"] .screen.gameover .eyebrow { animation-delay: 60ms; }
#hud[data-screen="gameover"] .screen.gameover .title { animation-delay: 120ms; }
#hud[data-screen="gameover"] .screen.gameover .stats { animation-delay: 180ms; }
#hud[data-screen="gameover"] .screen.gameover .btn { animation-delay: 240ms; }
@keyframes rise {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Loading skeleton — shapes matching the final layout, with a shimmer. ─── */
#hud .sk {
  position: relative; overflow: hidden;
  background: rgba(255,255,255,0.05);
  border: 1px solid var(--hairline); border-radius: 12px;
}
#hud .sk::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.09), transparent);
  transform: translateX(-100%); animation: hud-shimmer 1.15s infinite;
}
@keyframes hud-shimmer { 100% { transform: translateX(100%); } }
#hud .skeleton .sk-bar { position: absolute; top: 18px; left: 0; right: 0; display: flex; gap: 12px; justify-content: center; }
#hud .skeleton .sk-pill { width: 116px; height: 62px; }
#hud .skeleton .sk-pill.wide { width: 148px; }
/* Matches the real menu card's footprint, offset AND left dock, so the card
   doesn't jump across the screen when the first frame lands. */
#hud .skeleton .sk-card {
  width: min(90vw, 460px); height: 300px; border-radius: 20px;
  margin-bottom: 12vh;
}
#hud .skeleton .sk-stage { display: grid; place-items: center start; }
#hud .skeleton .sk-card { margin-left: clamp(24px, 7vw, 104px); }
@media (max-width: 900px) {
  #hud .skeleton .sk-stage { place-items: center; }
  #hud .skeleton .sk-card { margin-left: 0; }
}

/* Reduced-motion: kill transforms/shimmer, keep opacity legible. */
@media (prefers-reduced-motion: reduce) {
  #hud .screen, #hud .playbar { transition: opacity 0.2s linear; transform: none !important; }
  #hud .btn, #hud .readout .val, #hud .bar > i { transition: none; }
  #hud .readout.bump .val { animation: none; }
  #hud[data-screen="gameover"] .screen.gameover .crash,
  #hud[data-screen="gameover"] .screen.gameover .eyebrow,
  #hud[data-screen="gameover"] .screen.gameover .title,
  #hud[data-screen="gameover"] .screen.gameover .stats,
  #hud[data-screen="gameover"] .screen.gameover .btn,
  #hud .sk::after { animation: none; }
  /* The toast still appears (feedback is not optional) — it just fades rather
     than travelling. */
  #hud .nearmiss.show { animation: nearmiss-rm 0.62s linear; }
  @keyframes nearmiss-rm {
    0%, 100% { opacity: 0; }
    18%, 70% { opacity: 1; }
  }
}
`;

const STATUS_TO_SCREEN: Record<GameStatus, string> = {
  menu: 'menu',
  playing: 'playing',
  gameover: 'gameover',
};

export class Hud {
  private readonly root: HTMLElement;
  private ready = false;

  // Cached dynamic nodes.
  private readonly scoreVal: HTMLElement;
  private readonly friendsVal: HTMLElement;
  private readonly speedVal: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly scoreRO: HTMLElement;
  private readonly friendsRO: HTMLElement;
  private readonly finalScore: HTMLElement;
  private readonly finalFriends: HTMLElement;
  private readonly nearMiss: HTMLElement;
  private readonly reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  private countFrame: number | null = null;

  private prev: GameState;

  constructor(
    private readonly store: GameStore,
    private readonly onUserGesture: () => void,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.getElementById('hud');
    if (!root) throw new Error('#hud container not found');
    this.root = root;
    this.root.innerHTML = this.template();

    this.scoreVal = this.q('#ro-score .val');
    this.friendsVal = this.q('#ro-friends .val');
    this.speedVal = this.q('#ro-speed .val');
    this.speedFill = this.q('#ro-speed .bar > i');
    this.scoreRO = this.q('#ro-score');
    this.friendsRO = this.q('#ro-friends');
    this.finalScore = this.q('#final-score');
    this.finalFriends = this.q('#final-friends');
    this.nearMiss = this.q('#nearmiss');

    this.q<HTMLButtonElement>('#startBtn').addEventListener('click', () => {
      this.onUserGesture();
      this.store.start();
    });
    this.q<HTMLButtonElement>('#restartBtn').addEventListener('click', () => {
      this.onUserGesture();
      this.store.start();
    });

    this.prev = this.store.getState();
    this.store.subscribe((s) => this.render(s));
    this.render(this.prev);
  }

  /**
   * Flash the near-miss toast. Called by the renderer when the simulation
   * reports Gary threaded a gap — the HUD stays a projection and never decides
   * that a near miss happened.
   */
  pulse(): void {
    if (this.store.getState().status !== 'playing') return;
    this.nearMiss.classList.remove('show');
    void this.nearMiss.offsetWidth; // restart the animation
    this.nearMiss.classList.add('show');
  }

  /** Called by the renderer once the first WebGL frame has landed. */
  setReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.render(this.store.getState());
  }

  private render(s: GameState): void {
    this.root.dataset.screen = this.ready ? STATUS_TO_SCREEN[s.status] : 'loading';

    // A toast must never outlive the run it belongs to (e.g. a crash landing
    // one frame after a near miss).
    if (s.status !== 'playing' && this.prev.status === 'playing') {
      this.nearMiss.classList.remove('show');
    }

    this.scoreVal.textContent = String(s.score);
    this.friendsVal.textContent = String(s.friends);
    this.speedVal.textContent = String(Math.round(s.speed * 4)); // stylised km/h
    // The bar reads the same difficulty curve the simulation ramps along, so
    // "bar full" genuinely means "top speed" rather than an invented ceiling.
    const throttle = intensityForSpeed(s.speed);
    this.speedFill.style.transform = `scaleX(${throttle.toFixed(3)})`;

    if (s.score !== this.prev.score) this.flash(this.scoreRO);
    if (s.friends !== this.prev.friends) this.flash(this.friendsRO);

    if (s.status === 'gameover' && this.prev.status !== 'gameover') {
      this.countFinalStats(s.score, s.friends);
    } else if (s.status !== 'gameover') {
      this.cancelCount();
      this.finalScore.textContent = String(s.score);
      this.finalFriends.textContent = String(s.friends);
    }

    this.prev = s;
  }

  private countFinalStats(score: number, friends: number): void {
    this.cancelCount();
    if (this.reducedMotion.matches) {
      this.finalScore.textContent = String(score);
      this.finalFriends.textContent = String(friends);
      return;
    }

    const start = performance.now();
    const duration = 500;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      this.finalScore.textContent = String(Math.round(score * eased));
      this.finalFriends.textContent = String(Math.round(friends * eased));
      this.countFrame =
        progress < 1 ? requestAnimationFrame(tick) : null;
    };
    this.finalScore.textContent = '0';
    this.finalFriends.textContent = '0';
    this.countFrame = requestAnimationFrame(tick);
  }

  private cancelCount(): void {
    if (this.countFrame === null) return;
    cancelAnimationFrame(this.countFrame);
    this.countFrame = null;
  }

  private flash(el: HTMLElement): void {
    el.classList.remove('bump');
    void el.offsetWidth; // restart the animation
    el.classList.add('bump');
  }

  private q<T extends HTMLElement = HTMLElement>(sel: string): T {
    const el = this.root.querySelector<T>(sel);
    if (!el) throw new Error(`HUD element not found: ${sel}`);
    return el;
  }

  private template(): string {
    return `
      <div class="screen loading">
        <div class="skeleton" style="position:absolute;inset:0;">
          <div class="sk-bar">
            <div class="sk sk-pill"></div>
            <div class="sk sk-pill"></div>
            <div class="sk sk-pill wide"></div>
          </div>
          <div class="sk-stage" style="position:absolute;inset:0;">
            <div class="sk sk-card"></div>
          </div>
        </div>
      </div>

      <div class="screen menu">
        <div class="scrim"></div>
        <div class="card">
          <p class="eyebrow">Endless Highway</p>
          <h1 class="hero">GARY<span class="amp"> &amp; </span>FRIENDS</h1>
          <p class="tagline">A road cone with places to be. Weave the three lanes,
            keep it clean, and pick up a friend or two.</p>
          <button class="btn" id="startBtn">${icon.play}<span>Start run</span></button>
          <div class="legend">
            <span><b>Space</b> Start</span>
          </div>
        </div>
      </div>

      <div class="playbar">
        <div class="readout" id="ro-score">
          <span class="ic">${icon.score}</span>
          <span class="meta"><span class="lbl">Score</span><span class="val">0</span></span>
        </div>
        <div class="readout" id="ro-friends">
          <span class="ic">${icon.friend}</span>
          <span class="meta"><span class="lbl">Friends</span><span class="val">0</span></span>
        </div>
        <div class="readout speed" id="ro-speed">
          <div class="row">
            <span class="ic">${icon.speed}</span>
            <span class="meta"><span class="lbl">Speed</span><span class="val">0</span></span>
          </div>
          <div class="bar"><i></i></div>
        </div>
        <div class="play-hint"><b>&larr; &rarr;</b> Switch lane</div>
      </div>

      <div class="nearmiss" id="nearmiss">
        ${icon.nearMiss}<span>Near miss</span><span class="pts">+${NEAR_MISS_BONUS}</span>
      </div>

      <div class="screen gameover">
        <div class="scrim"></div>
        <div class="card">
          <span class="crash">${icon.crash}</span>
          <p class="eyebrow" style="margin-top:12px;">Run ended</p>
          <h2 class="title">Wrecked!</h2>
          <div class="stats">
            <div class="stat"><div class="n" id="final-score">0</div><div class="k">Score</div></div>
            <div class="stat"><div class="n" id="final-friends">0</div><div class="k">Friends</div></div>
          </div>
          <button class="btn" id="restartBtn">${icon.play}<span>Run it back</span></button>
          <div class="legend"><span><b>Space</b> Restart</span></div>
        </div>
      </div>
    `;
  }
}
