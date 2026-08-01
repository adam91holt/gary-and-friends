/**
 * Highway-specific HUD surfaces: the convoy roster rail, the near-miss toast,
 * the friend-joined flourish, the speed instrument and the game-over convoy
 * recap.
 *
 * Split out of the shell deliberately. None of this means anything in Coneball
 * — a "convoy" is a highway idea — so it lives beside the game that owns it and
 * the generic HUD only knows how to show or hide it. When a sibling ticket adds
 * tower-specific telemetry, it adds a file like this one and touches nothing
 * here.
 *
 * Presentation only: it is TOLD what happened (`collected`, `pulse`) by the
 * renderer, and it never infers a pickup from a counter or reads the store for
 * anything it wasn't handed.
 */
import { intensityForSpeed } from '../game/gameplay/difficulty.ts';
import { FRIENDS } from '../game/friends/roster.ts';
import type { FriendPickup } from '../game/gameplay/run.ts';
import { NEAR_MISS_BONUS } from '../game/gameplay/run.ts';
import { icon } from './icons.ts';

export class RunnerHud {
  private readonly speedVal: HTMLElement;
  private readonly speedFill: HTMLElement;
  private readonly nearMiss: HTMLElement;
  private readonly collect: HTMLElement;
  private readonly collectName: HTMLElement;
  private readonly collectPts: HTMLElement;
  private readonly rosterMet: HTMLElement;
  private readonly convoy: HTMLElement;
  private readonly chips: HTMLElement[];
  private readonly chipCounts: HTMLElement[];

  /**
   * How many of each named friend are in tow. The HUD's own presentation state
   * — the store owns the *total*, this is only how the rail draws it — fed
   * exclusively by `collected()` from the simulation, never inferred.
   */
  private readonly tally: number[] = FRIENDS.map(() => 0);
  /** Names in join order, for the game-over convoy recap. */
  private readonly joinOrder: number[] = [];

  constructor(q: <T extends HTMLElement>(sel: string) => T) {
    this.speedVal = q('#ro-speed .val');
    this.speedFill = q('#ro-speed .bar > i');
    this.nearMiss = q('#nearmiss');
    this.collect = q('#collect');
    this.collectName = q('#collect-name');
    this.collectPts = q('#collect-pts');
    this.rosterMet = q('#roster-met');
    this.convoy = q('#convoy');
    this.chips = FRIENDS.map((_, i) => q(`#chip-${i}`));
    this.chipCounts = FRIENDS.map((_, i) => q(`#chip-n-${i}`));
  }

  /** Draw the speed instrument. Called every render while the highway is up. */
  paintSpeed(speed: number): void {
    this.speedVal.textContent = String(Math.round(speed * 4)); // stylised km/h
    // The bar reads the same difficulty curve the simulation ramps along, so
    // "bar full" genuinely means "top speed" rather than an invented ceiling.
    this.speedFill.style.transform = `scaleX(${intensityForSpeed(speed).toFixed(3)})`;
  }

  /**
   * Flash the near-miss toast. Called by the renderer when the simulation
   * reports Gary threaded a gap — the HUD stays a projection and never decides
   * that a near miss happened.
   */
  pulse(): void {
    this.nearMiss.classList.remove('show');
    void this.nearMiss.offsetWidth; // restart the animation
    this.nearMiss.classList.add('show');
  }

  /**
   * Announce a friend joining the conga line: name flourish + roster chip.
   * Called by the renderer from the simulation's `onFriend` callback — the HUD
   * is told *who* was collected, it never works it out from the count.
   */
  collected(pickup: FriendPickup): void {
    const index = Math.max(0, Math.min(FRIENDS.length - 1, pickup.variant));
    this.tally[index]++;
    this.joinOrder.push(index);
    this.paintRoster();

    const chip = this.chips[index];
    chip.classList.remove('pop');
    void chip.offsetWidth; // restart the animation
    chip.classList.add('pop');

    this.collect.style.setProperty('--tint', `var(--friend-${index + 1})`);
    this.collectName.textContent = pickup.name;
    this.collectPts.textContent = `+${pickup.points}`;
    this.collect.classList.remove('show');
    void this.collect.offsetWidth;
    this.collect.classList.add('show');
  }

  /** A toast must never outlive the run it belongs to. */
  clearToasts(): void {
    this.nearMiss.classList.remove('show');
    this.collect.classList.remove('show');
  }

  /** A fresh run empties the roster, exactly as it empties the conga line. */
  reset(): void {
    this.tally.fill(0);
    this.joinOrder.length = 0;
    for (const chip of this.chips) chip.classList.remove('pop');
    this.paintRoster();
    this.convoy.innerHTML = '';
  }

  /** Redraw the rail from the tally. Chips light once you've met that friend. */
  private paintRoster(): void {
    let met = 0;
    for (let i = 0; i < FRIENDS.length; i++) {
      const count = this.tally[i];
      if (count > 0) met++;
      this.chips[i].classList.toggle('met', count > 0);
      this.chipCounts[i].textContent = String(count);
    }
    this.rosterMet.textContent = String(met);
  }

  /**
   * The game-over recap: who actually came along, in join order. Capped so a
   * long convoy summarises ("+7 more") instead of blowing out the card.
   */
  paintConvoy(): void {
    const SHOWN = 8;
    const shown = this.joinOrder.slice(0, SHOWN);
    const rest = this.joinOrder.length - shown.length;
    const chips = shown
      .map(
        (i) =>
          `<span class="co" style="--tint: var(--friend-${i + 1});">${icon.cone}${FRIENDS[i].short}</span>`,
      )
      .join('');
    this.convoy.innerHTML =
      chips + (rest > 0 ? `<span class="co more">+${rest} more</span>` : '');
  }
}

/** The runner's own markup: speed instrument, rail, toasts, convoy recap. */
export function runnerHudTemplate(): { speedReadout: string; overlays: string } {
  return {
    speedReadout: `
      <div class="readout speed" id="ro-speed">
        <div class="row">
          <span class="ic">${icon.speed}</span>
          <span class="meta"><span class="lbl">Speed</span><span class="val">0</span></span>
        </div>
        <div class="bar"><i></i></div>
      </div>`,
    overlays: `
      <div class="roster" id="roster">
        <div class="cap">
          <span class="lbl">Convoy</span>
          <span class="tally"><b id="roster-met">0</b>/${FRIENDS.length}</span>
        </div>
        ${FRIENDS.map(
          (f, i) => `
        <div class="chip" id="chip-${i}" style="--tint: var(--friend-${i + 1});">
          <span class="g">${icon.cone}</span>
          <span class="nm">${f.short}</span>
          <span class="n" id="chip-n-${i}">0</span>
        </div>`,
        ).join('')}
      </div>

      <div class="nearmiss" id="nearmiss">
        ${icon.nearMiss}<span>Near miss</span><span class="pts">+${NEAR_MISS_BONUS}</span>
      </div>

      <div class="collect" id="collect">
        ${icon.cone}
        <span class="who" id="collect-name"></span>
        <span class="joined">joined</span>
        <span class="pts" id="collect-pts"></span>
      </div>`,
  };
}
