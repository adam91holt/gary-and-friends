/**
 * The DOM overlay: the arcade select screen, the in-play telemetry HUD, the
 * game-over card, and the async loading skeleton shown until the WebGL scene
 * reports its first frame.
 *
 * Rendering-side (owns DOM, reads the store, never mutates game state except
 * through published store actions on explicit user intent). It subscribes to the
 * GameStore and re-renders on change — the store is the source of truth, this is
 * a projection of it, exactly like the test API.
 *
 * ── The split ───────────────────────────────────────────────────────────────
 * This file is the SHELL and the generic surfaces only:
 *   - the select screen frame (the grid itself is `ui/gameSelect.ts`),
 *   - score / best / one game-specific metric / game-over,
 *   - the loading skeleton and the sound toggle.
 * Everything highway-shaped — the convoy rail, near-miss toast, collect
 * flourish, speed instrument — lives in `ui/runnerHud.ts`, and component CSS
 * lives in `ui/hud.css`. A sibling adding a game adds its own telemetry module
 * and fills the generic metric slot; it does not edit this file.
 *
 * Design system: dark-first surfaces, the single owned --accent, a paired
 * display/mono type scale, motion only on state change (transform/opacity, with
 * a prefers-reduced-motion path), and one consistent inline-SVG icon set (no
 * emoji, no second icon library). The distinctive idea, extended from the runner
 * to the whole cabinet: the overlay is a hazard-taped roadside instrument
 * cluster, and the select screen is a WINDOW onto it — the game you have
 * highlighted is running live in 3D behind the panel, so choosing a game is
 * itself a camera move rather than a page transition.
 */
import './hud.css';
import { GAMES, gameEntry } from '../game/arcade/catalog.ts';
import type { ArcadeSnapshot, GameId } from '../game/arcade/contracts.ts';
import type { FriendPickup } from '../game/gameplay/run.ts';
import type { GameState, GameStore, GameStatus } from '../game/state.ts';
import { GameSelect, gameSelectTemplate } from './gameSelect.ts';
import { icon } from './icons.ts';
import { RunnerHud, runnerHudTemplate } from './runnerHud.ts';

const STATUS_TO_SCREEN: Record<GameStatus, string> = {
  menu: 'menu',
  playing: 'playing',
  gameover: 'gameover',
};

export interface HudHandlers {
  /** Any explicit user gesture — unlocks the AudioContext. */
  onUserGesture(): void;
  /** Toggle mute; returns the new muted state. */
  onToggleSound(): boolean;
  /** The player highlighted a game on the select grid. */
  onSelectGame(id: GameId): void;
  /** The player launched the highlighted game. */
  onLaunch(id: GameId): void;
  /** The player asked to go back to the cabinet from a finished run. */
  onBackToMenu(): void;
}

export class Hud {
  private readonly root: HTMLElement;
  private ready = false;

  /** The select grid. Owns its own roving tabindex and arrow navigation. */
  readonly select: GameSelect;
  /** Highway-specific surfaces. Hidden by CSS when another game is up. */
  private readonly runner: RunnerHud;

  // Cached dynamic nodes (generic surfaces only).
  private readonly scoreVal: HTMLElement;
  private readonly metricVal: HTMLElement;
  private readonly metricLbl: HTMLElement;
  private readonly metricRO: HTMLElement;
  private readonly scoreRO: HTMLElement;
  private readonly finalScore: HTMLElement;
  private readonly finalMetric: HTMLElement;
  private readonly finalMetricK: HTMLElement;
  private readonly finalMetricStat: HTMLElement;
  private readonly menuBest: HTMLElement;
  private readonly menuBestN: HTMLElement;
  private readonly overBest: HTMLElement;
  private readonly overBestN: HTMLElement;
  private readonly bestRO: HTMLElement;
  private readonly bestVal: HTMLElement;
  private readonly recordToast: HTMLElement;
  private readonly recordN: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly overEyebrow: HTMLElement;
  private readonly launchName: HTMLElement;
  private readonly launchBtn: HTMLButtonElement;
  private readonly launchLabel: HTMLElement;
  private readonly launchHint: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly playHint: HTMLElement;
  private readonly reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  private countFrame: number | null = null;

  /**
   * The best score to draw, for the SELECTED game. Presentation state only —
   * the HUD is *told* the number by the renderer, which owns the storage
   * adapter. The HUD never reads localStorage itself.
   */
  private best = 0;
  /** Whether the current game-over card is showing a run that set the record. */
  private bestIsNew = false;
  /** Latched so the mid-run "new record" toast fires exactly once per run. */
  private recordAnnounced = false;
  /** The last snapshot handed in by the renderer. Drives the metric slot. */
  private snapshot: ArcadeSnapshot | null = null;

  private prev: GameState;

  constructor(
    private readonly store: GameStore,
    private readonly handlers: HudHandlers,
  ) {
    const root = document.getElementById('hud');
    if (!root) throw new Error('#hud container not found');
    this.root = root;
    this.root.innerHTML = this.template();

    this.scoreVal = this.q('#ro-score .val');
    this.metricVal = this.q('#ro-friends .val');
    this.metricLbl = this.q('#ro-friends .lbl');
    this.metricRO = this.q('#ro-friends');
    this.scoreRO = this.q('#ro-score');
    this.finalScore = this.q('#final-score');
    this.finalMetric = this.q('#final-friends');
    this.finalMetricK = this.q('#final-metric-k');
    this.finalMetricStat = this.q('#final-metric-stat');
    this.menuBest = this.q('#menu-best');
    this.menuBestN = this.q('#menu-best-n');
    this.overBest = this.q('#over-best');
    this.overBestN = this.q('#over-best-n');
    this.bestRO = this.q('#ro-best');
    this.bestVal = this.q('#ro-best .val');
    this.recordToast = this.q('#record');
    this.recordN = this.q('#record-n');
    this.overTitle = this.q('#gameover-title');
    this.overEyebrow = this.q('#gameover-eyebrow');
    this.launchName = this.q('#launch-name');
    this.launchBtn = this.q<HTMLButtonElement>('#startBtn');
    this.launchLabel = this.q('#startBtn .lbl');
    this.launchHint = this.q('#launch-hint');
    this.playHint = this.q('#play-hint');
    this.soundBtn = this.q<HTMLButtonElement>('#soundBtn');

    this.runner = new RunnerHud((sel) => this.q(sel));

    this.select = new GameSelect(this.q('#game-grid'), {
      onHighlight: (id) => this.handlers.onSelectGame(id),
      onActivate: (id) => {
        this.handlers.onUserGesture();
        this.handlers.onLaunch(id);
      },
    });

    this.launchBtn.addEventListener('click', () => {
      this.handlers.onUserGesture();
      this.handlers.onLaunch(this.store.getState().selectedGame);
    });
    this.q<HTMLButtonElement>('#restartBtn').addEventListener('click', () => {
      this.handlers.onUserGesture();
      this.store.start();
    });
    this.q<HTMLButtonElement>('#menuBtn').addEventListener('click', () => {
      this.handlers.onUserGesture();
      this.handlers.onBackToMenu();
    });
    this.soundBtn.addEventListener('click', () => {
      // Unmuting is itself the user gesture that unlocks the AudioContext, so
      // the first thing you hear after enabling sound is the next real cue.
      this.handlers.onUserGesture();
      this.soundBtn.dataset.muted = String(this.handlers.onToggleSound());
    });

    this.prev = this.store.getState();
    // Paint the launch strip once up front: `render` only repaints it on a
    // CHANGE, so without this the boot game's title, controls and (crucially)
    // the enabled state of the start button would never be drawn at all.
    this.paintSelection(this.prev);
    this.select.setSelected(this.prev.selectedGame);
    this.store.subscribe((s) => this.render(s));
    this.render(this.prev);
  }

  /** Flash the near-miss toast (highway). No-op outside a run. */
  pulse(): void {
    if (this.store.getState().status !== 'playing') return;
    this.runner.pulse();
  }

  /** Announce a friend joining the conga line (highway). */
  collected(pickup: FriendPickup): void {
    if (this.store.getState().status !== 'playing') return;
    this.runner.collected(pickup);
  }

  /**
   * Hand the HUD the active runtime's snapshot. Called once a frame by the
   * renderer, which is what lets the score/metric instruments show a game's own
   * numbers without this file knowing which game is running.
   */
  setSnapshot(snapshot: ArcadeSnapshot): void {
    this.snapshot = snapshot;
    this.paintInstruments(this.store.getState());
  }

  /**
   * Set the persisted best for the selected game, and whether the run that just
   * ended set it.
   *
   * Told, never inferred: the renderer owns the storage adapter (the HUD has no
   * business touching `localStorage`), so the plaque and the playbar readout can
   * never disagree with what was actually written to disk.
   */
  setHighScore(best: number, isNew = false): void {
    this.best = best > 0 ? Math.floor(best) : 0;
    this.bestIsNew = isNew;
    this.paintBest();
  }

  /** Draw every game's record on its own card in the select grid. */
  setHighScores(bests: Readonly<Record<GameId, number>>): void {
    this.select.paintBests(bests);
  }

  /**
   * Announce that the live score has just passed the stored best, mid-run.
   * Fires at most once per run — the renderer latches on the crossing, and this
   * latches again so a re-entrant call can't restart the animation.
   */
  recordBroken(score: number): void {
    if (this.recordAnnounced) return;
    if (this.store.getState().status !== 'playing') return;
    this.recordAnnounced = true;
    this.recordN.textContent = String(Math.floor(score));
    this.recordToast.classList.remove('show');
    void this.recordToast.offsetWidth; // restart the animation
    this.recordToast.classList.add('show');
    this.bestRO.classList.add('beaten');
  }

  /** Reflect the audio state on the toggle (the renderer owns the mute flag). */
  setMuted(muted: boolean): void {
    this.soundBtn.dataset.muted = String(muted);
  }

  /** Called by the renderer once the first WebGL frame has landed. */
  setReady(): void {
    if (this.ready) return;
    this.ready = true;
    this.render(this.store.getState());
  }

  private render(s: GameState): void {
    this.root.dataset.screen = this.ready ? STATUS_TO_SCREEN[s.status] : 'loading';
    // Drives the CSS that shows/hides game-specific surfaces (the convoy rail
    // is a highway idea, so it is drawn only when the highway is on screen).
    this.root.dataset.game = s.selectedGame;

    if (s.selectedGame !== this.prev.selectedGame) this.paintSelection(s);

    // A toast must never outlive the run it belongs to (e.g. a crash landing
    // one frame after a near miss, or one frame after a pickup).
    if (s.status !== 'playing' && this.prev.status === 'playing') {
      this.runner.clearToasts();
    }

    // A fresh run empties the roster, exactly as it empties the conga line.
    // Driven off the store's own reset (friends back to 0) rather than a
    // separate signal, so the rail can never disagree with the counter.
    if (s.friends === 0 && this.prev.friends !== 0) this.runner.reset();
    if (s.status === 'playing' && this.prev.status !== 'playing') {
      this.runner.reset();
      // A new run has a record to beat again, however the last one ended.
      this.recordAnnounced = false;
      this.bestIsNew = false;
      this.recordToast.classList.remove('show');
      this.bestRO.classList.remove('beaten');
      this.paintBest();
      this.paintSelection(s);
    }
    // Returning to the cabinet re-focuses the card you came from, so a
    // keyboard-only player is never dropped at the top of the document.
    if (s.status === 'menu' && this.prev.status !== 'menu') {
      this.select.setSelected(s.selectedGame);
      this.paintSelection(s);
      this.runner.reset();
      this.select.focusCurrent();
    }

    this.paintInstruments(s);

    // Distance score changes many times per second; bump only on a readable
    // milestone instead of continuously restarting the animation.
    if (Math.floor(s.score / 25) > Math.floor(this.prev.score / 25)) {
      this.flash(this.scoreRO);
    }
    if (s.friends !== this.prev.friends) this.flash(this.metricRO);

    if (s.status === 'gameover' && this.prev.status !== 'gameover') {
      this.countFinalStats(s.score, this.snapshot?.metric?.value ?? 0);
      this.runner.paintConvoy();
      // The card leads with what happened. A record is a different headline
      // from a wreck, and burying it under "Wrecked!" wastes the only moment
      // in the game where the player has beaten themselves.
      this.overTitle.textContent = this.bestIsNew ? 'New record!' : 'Wrecked!';
      this.overEyebrow.textContent = `${gameEntry(s.selectedGame).shortTitle} · Run ended`;
    } else if (s.status !== 'gameover') {
      this.cancelCount();
      this.finalScore.textContent = String(s.score);
      this.finalMetric.textContent = String(this.snapshot?.metric?.value ?? 0);
    }

    this.prev = s;
  }

  /** Score, the game-specific metric, and the highway's speed instrument. */
  private paintInstruments(s: GameState): void {
    this.scoreVal.textContent = String(s.score);

    // The generic metric slot: whatever the active game calls its second
    // number. A game with none simply loses the instrument rather than showing
    // a permanently dead dial.
    const metric = this.snapshot?.metric ?? null;
    this.metricRO.classList.toggle('off', metric === null);
    this.finalMetricStat.classList.toggle('off', metric === null);
    if (metric) {
      this.metricLbl.textContent = metric.label;
      this.metricVal.textContent = String(metric.value);
      this.finalMetricK.textContent = metric.label;
    }

    this.runner.paintSpeed(s.speed);
  }

  /** Everything that names the selected game: launch strip, hints, headline. */
  private paintSelection(s: GameState): void {
    const entry = gameEntry(s.selectedGame);
    this.launchName.textContent = entry.title;
    this.launchBtn.setAttribute('aria-disabled', String(!entry.playable));
    this.launchLabel.textContent = entry.playable ? 'Start run' : 'Not built yet';
    this.launchHint.innerHTML = entry.controls
      .map((c) => `<span><b>${c.keys}</b> ${c.action}</span>`)
      .join('');
    // The in-play hint teaches THIS game's primary control, not the highway's.
    const primary = entry.controls[0];
    this.playHint.innerHTML = `<b>${primary.keys}</b> ${primary.action}`;
  }

  private countFinalStats(score: number, metric: number): void {
    this.cancelCount();
    if (this.reducedMotion.matches) {
      this.finalScore.textContent = String(score);
      this.finalMetric.textContent = String(metric);
      return;
    }

    const start = performance.now();
    const duration = 500;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) ** 3;
      this.finalScore.textContent = String(Math.round(score * eased));
      this.finalMetric.textContent = String(Math.round(metric * eased));
      this.countFrame = progress < 1 ? requestAnimationFrame(tick) : null;
    };
    this.finalScore.textContent = '0';
    this.finalMetric.textContent = '0';
    this.countFrame = requestAnimationFrame(tick);
  }

  /**
   * Redraw every surface that shows the selected game's best: the cabinet's
   * launch plaque, the game-over plaque and the in-play readout. One painter,
   * so the three can never drift.
   */
  private paintBest(): void {
    const label = this.best > 0 ? String(this.best) : '—';
    this.menuBestN.textContent = label;
    this.overBestN.textContent = label;
    this.bestVal.textContent = String(this.best);
    this.menuBest.classList.toggle('empty', this.best === 0);
    this.overBest.classList.toggle('empty', this.best === 0);
    this.bestRO.classList.toggle('empty', this.best === 0);
    // Only the game-over plaque wears the record state; the cabinet shows the
    // standing best, and a permanently-lit card would cheapen the moment.
    this.overBest.classList.toggle('new', this.bestIsNew);
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
    const runner = runnerHudTemplate();
    return `
      <div class="screen loading">
        <div class="skeleton" style="position:absolute;inset:0;">
          <div class="sk-bar">
            <div class="sk sk-pill"></div>
            <div class="sk sk-pill"></div>
            <div class="sk sk-pill wide"></div>
          </div>
          <div class="sk sk-sound"></div>
          <div class="sk-stage" style="position:absolute;inset:0;">
            <div class="sk-cabinet">
              <div class="sk sk-head"></div>
              <div class="sk-grid">
                ${GAMES.map(() => '<div class="sk sk-tile"></div>').join('')}
              </div>
              <div class="sk sk-launch"></div>
            </div>
          </div>
        </div>
      </div>

      <div class="screen menu">
        <div class="scrim"></div>
        <div class="cabinet">
          <div class="masthead">
            <p class="eyebrow">The cabinet</p>
            <h1 class="hero">GARY <span class="amp">AND HIS</span> FRIENDS</h1>
            <p class="tagline">Four games, one road cone. Pick a machine.</p>
          </div>
          ${gameSelectTemplate()}
          <div class="launch">
            <button class="btn" id="startBtn">${icon.play}<span class="lbl">Start run</span></button>
            <span class="meta">
              <span class="k">Selected</span>
              <span class="picked" id="launch-name">Endless Highway</span>
              <span class="legend" id="launch-hint"></span>
            </span>
            <div class="best empty" id="menu-best">
              <span class="ic">${icon.record}</span>
              <span class="meta">
                <span class="k">Best run</span>
                <span class="n" id="menu-best-n">—</span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <button class="sound" id="soundBtn" type="button"
              aria-label="Toggle sound" title="Toggle sound" data-muted="false">
        <span class="on">${icon.sound}</span><span class="off">${icon.muted}</span>
      </button>

      <div class="playbar">
        <div class="readout" id="ro-score">
          <span class="ic">${icon.score}</span>
          <span class="meta"><span class="lbl">Score</span><span class="val">0</span></span>
        </div>
        <!-- The generic game-specific metric slot. It keeps the highway's
             original element id because that id is load-bearing for the
             pre-arcade e2e contract — the same reasoning that keeps the
             highway on the un-namespaced high-score key. The LABEL and value
             are driven by whatever the active runtime's snapshot reports. -->
        <div class="readout" id="ro-friends">
          <span class="ic">${icon.friend}</span>
          <span class="meta"><span class="lbl">Friends</span><span class="val">0</span></span>
        </div>
        ${runner.speedReadout}
        <div class="readout best-ro" id="ro-best">
          <span class="ic">${icon.record}</span>
          <span class="meta"><span class="lbl">Best</span><span class="val">0</span></span>
        </div>
        <div class="play-hint" id="play-hint"><b>&larr; &rarr;</b> Switch lane</div>
      </div>

      ${runner.overlays}

      <div class="record" id="record">
        ${icon.record}<span>New record</span><span class="pts" id="record-n">0</span>
      </div>

      <div class="screen gameover">
        <div class="scrim"></div>
        <div class="card">
          <span class="crash">${icon.crash}</span>
          <p class="eyebrow" id="gameover-eyebrow" style="margin-top:12px;">Highway · Run ended</p>
          <h2 class="title" id="gameover-title">Wrecked!</h2>
          <div class="stats">
            <div class="stat"><div class="n" id="final-score">0</div><div class="k">Score</div></div>
            <!-- Same reasoning as #ro-friends: the generic metric stat keeps
                 the original element id so the pre-arcade contract holds. -->
            <div class="stat" id="final-metric-stat">
              <div class="n" id="final-friends">0</div>
              <div class="k" id="final-metric-k">Friends</div>
            </div>
          </div>
          <div class="best empty" id="over-best">
            <span class="ic">${icon.record}</span>
            <span class="meta">
              <span class="k">Best run</span>
              <span class="n" id="over-best-n">—</span>
            </span>
            <span class="tag">New</span>
          </div>
          <div class="convoy" id="convoy"></div>
          <button class="btn" id="restartBtn">${icon.play}<span>Run it back</span></button>
          <div>
            <button class="ghost" id="menuBtn" type="button">${icon.cabinet}<span>Back to cabinet</span></button>
          </div>
          <div class="legend">
            <span><b>Space</b> Restart</span>
            <span><b>Esc</b> Cabinet</span>
          </div>
        </div>
      </div>
    `;
  }
}
