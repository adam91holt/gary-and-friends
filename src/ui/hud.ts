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
import type { FriendPickup } from '../game/gameplay/run.ts';
import { NEAR_MISS_BONUS } from '../game/gameplay/run.ts';
import { FRIENDS } from '../game/friends/roster.ts';
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
  // A cone, in the same 24×24 stroke family — the roster rail's glyph.
  cone: `<svg viewBox="0 0 24 24" ${ns}><path d="M12 3 6.5 18h11z"/><path d="M9.2 11h5.6"/><path d="M4 21h16"/></svg>`,
  // The record mark: a cone on a podium step. Same family, same 2px stroke —
  // a trophy from another icon set would break the one-family rule.
  record: `<svg viewBox="0 0 24 24" ${ns}><path d="M12 2.5 7.5 14h9z"/><path d="M9.6 9h4.8"/><path d="M5 17.5h14v4H5z"/></svg>`,
  sound: `<svg viewBox="0 0 24 24" ${ns}><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="M16 9.2a4 4 0 0 1 0 5.6"/><path d="M18.6 6.6a7.6 7.6 0 0 1 0 10.8"/></svg>`,
  muted: `<svg viewBox="0 0 24 24" ${ns}><path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z"/><path d="m16.5 9.5 5 5M21.5 9.5l-5 5"/></svg>`,
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
/* Both composed screens are the same shot: card docked left, Gary on the right.
   The menu meets him standing proud; game-over leaves him flat on his back in
   the SAME frame, which is the joke — the composition is the setup, the
   squashed cone is the punchline. Their scrims are weighted left so they darken
   behind the type without dimming him. Below ~900px there is no room beside the
   card, so they re-centre and the scrim goes symmetric (the 3D rigs keep him
   visible under the card's offset). */
#hud .screen.menu,
#hud .screen.gameover { place-items: center start; }
#hud .screen.menu .card,
#hud .screen.gameover .card { margin-left: clamp(24px, 7vw, 104px); text-align: left; }
#hud .screen.menu .best,
#hud .screen.gameover .best { margin-left: 0; margin-right: auto; }
#hud .screen.menu .scrim,
#hud .screen.gameover .scrim {
  background: linear-gradient(100deg, rgba(10,10,18,0.9) 30%, rgba(10,10,18,0.34) 62%, rgba(10,10,18,0.62));
}
#hud .screen.menu .legend,
#hud .screen.gameover .legend { justify-content: flex-start; }
#hud .screen.gameover .stats,
#hud .screen.gameover .convoy { justify-content: flex-start; }
#hud .screen.gameover .crash { place-items: start; }
@media (max-width: 900px) {
  #hud .screen.menu,
  #hud .screen.gameover { place-items: center; }
  #hud .screen.menu .card,
  #hud .screen.gameover .card { margin-left: 0; text-align: center; }
  #hud .screen.menu .best,
  #hud .screen.gameover .best { margin-left: auto; }
  #hud .screen.menu .scrim,
  #hud .screen.gameover .scrim {
    background: radial-gradient(ellipse at 50% 55%, rgba(14,14,24,0.15), rgba(10,10,18,0.8) 78%);
  }
  #hud .screen.menu .legend,
  #hud .screen.gameover .legend { justify-content: center; }
  #hud .screen.gameover .stats,
  #hud .screen.gameover .convoy { justify-content: center; }
  #hud .screen.gameover .crash { place-items: center; }
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
  overflow: hidden;
}
/* Every card is capped with the hazard band — the motif that ties the DOM
   overlay to the cone on the road. Token-owned (--hazard); components never
   re-declare the stripe. */
#hud .card::before {
  content: "";
  position: absolute; top: 0; left: 0; right: 0; height: 6px;
  background: var(--hazard);
  opacity: 0.92;
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

/* Telemetry readouts (instrument-dense). Each carries a slim hazard rail down
   its left edge — the same token the cards are capped with, at instrument
   scale, so the bar reads as part of one striped machine. */
#hud .readout {
  position: relative; overflow: hidden;
  display: flex; align-items: center; gap: 10px;
  padding: 10px 14px 10px 16px; min-width: 116px;
  background: var(--surface-hud); border: 1px solid var(--hairline);
  border-radius: 12px; backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 var(--hairline-strong);
}
#hud .readout::before {
  content: "";
  position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--hazard-dim);
}
/* The live best: dimmer than the run's own numbers, because it is context, not
   telemetry — until you pass it, at which point it becomes the loudest thing
   in the bar. With no record yet there is nothing to chase, so the slot is not
   drawn at all — an instrument reading zero forever is worse than no
   instrument, and the bar recomposes around three readouts perfectly well. */
#hud .readout.best-ro { min-width: 104px; }
#hud .readout.best-ro.empty { display: none; }
#hud .readout.best-ro .val { font-size: 1.3rem; color: var(--text-dim); }
#hud .readout.best-ro .ic { color: var(--text-faint); }
#hud .readout.best-ro.beaten .val { color: var(--accent); }
#hud .readout.best-ro.beaten .ic { color: var(--accent); }
#hud .readout.best-ro.beaten::before { background: var(--hazard); }
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

/* The record-broken flourish: fired the instant the live score passes the
   stored best, mid-run. Same instrument language as the near-miss toast but
   inverted — solid hazard-orange plate, because passing your best is the one
   thing in the game worth interrupting the road for. */
#hud .record {
  /* Below the near-miss toast and the collect flourish, so all three can be
     in flight at once (they genuinely can) without ever colliding. */
  position: absolute; top: 232px; left: 50%;
  display: flex; align-items: center; gap: 9px;
  padding: 8px 16px 8px 12px; border-radius: 999px;
  color: var(--accent-ink);
  background: linear-gradient(180deg, var(--accent-2), var(--accent));
  border: 1px solid rgba(255,255,255,0.4);
  box-shadow: 0 10px 30px var(--accent-glow);
  font-size: var(--fs-label); font-weight: 700;
  letter-spacing: 0.18em; text-transform: uppercase;
  opacity: 0; transform: translate(-50%, 0);
  pointer-events: none;
}
#hud .record svg { width: 16px; height: 16px; }
#hud .record .pts {
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  letter-spacing: 0;
}
#hud .record.show { animation: record 1.5s var(--ease); }
@keyframes record {
  0%   { opacity: 0; transform: translate(-50%, 6px) scale(0.85); }
  12%  { opacity: 1; transform: translate(-50%, -4px) scale(1.08); }
  22%  { transform: translate(-50%, -4px) scale(1); }
  78%  { opacity: 1; transform: translate(-50%, -4px) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -18px) scale(1); }
}

/* ── The convoy roster ─────────────────────────────────────────────────────
   The committed idea for friends: a docked left-edge rail that is a *manifest*
   of the crew, not a number. Each of the five named cones has a chip, dim and
   unclaimed until you meet them, then lit in their own token colour with a
   tally of how many are in tow. It is deliberately instrument-DENSE — this is
   a scanning surface you read at a glance mid-run — and it gives the abstract
   friends count a cast, which is the whole charm of the epic. Mirrors the
   3D conga line: the rail fills as the tail grows. */
#hud .roster {
  position: absolute; left: 20px; top: 50%;
  transform: translateY(-50%);
  display: flex; flex-direction: column; gap: 6px;
  padding: 12px 12px 11px;
  border-radius: 14px;
  background: var(--surface-hud); border: 1px solid var(--hairline);
  backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 var(--hairline-strong);
  opacity: 0;
  transition: opacity 0.3s var(--ease);
  pointer-events: none;
}
#hud[data-screen="playing"] .roster,
#hud[data-screen="gameover"] .roster { opacity: 1; }
#hud .roster .cap {
  display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
  padding-bottom: 9px; margin-bottom: 3px;
  border-bottom: 1px solid var(--hairline);
}
#hud .roster .cap .lbl {
  font-size: 0.6rem; font-weight: 700; letter-spacing: 0.22em;
  text-transform: uppercase; color: var(--text-faint);
}
#hud .roster .cap .tally {
  font-family: var(--font-mono); font-size: 0.78rem; font-weight: 600;
  font-variant-numeric: tabular-nums; color: var(--text-dim);
}
#hud .roster .cap .tally b { color: var(--accent); font-weight: 600; }

/* One chip per named friend. Dense rows: glyph, name, count. */
#hud .chip {
  display: grid; grid-template-columns: 18px 1fr 20px;
  align-items: center; gap: 8px;
  padding: 4px 6px 4px 4px; border-radius: 8px;
  border: 1px solid transparent;
  transition: background 0.25s var(--ease), border-color 0.25s var(--ease);
}
#hud .chip .g {
  display: grid; place-items: center; width: 18px; height: 18px;
  color: var(--text-faint);
  transition: color 0.25s var(--ease), transform 0.25s var(--ease);
}
#hud .chip .g svg { width: 17px; height: 17px; }
#hud .chip .nm {
  font-size: 0.7rem; font-weight: 600; letter-spacing: 0.04em;
  color: var(--text-faint); white-space: nowrap;
  transition: color 0.25s var(--ease);
}
#hud .chip .n {
  font-family: var(--font-mono); font-size: 0.72rem; font-weight: 600;
  font-variant-numeric: tabular-nums; text-align: right;
  color: var(--text-faint); opacity: 0.45;
  transition: color 0.25s var(--ease), opacity 0.25s var(--ease);
}
/* Met: the chip lights in that friend's own token colour. */
#hud .chip.met {
  background: rgba(255,255,255,0.05);
  border-color: var(--hairline-strong);
}
#hud .chip.met .g { color: var(--tint); }
#hud .chip.met .nm { color: var(--text); }
#hud .chip.met .n { color: var(--tint); opacity: 1; }
#hud .chip.pop { animation: chip-pop 0.42s var(--ease); }
@keyframes chip-pop {
  0%   { transform: translateX(0) scale(1); }
  30%  { transform: translateX(4px) scale(1.05); }
  100% { transform: translateX(0) scale(1); }
}

/* Narrow viewports: the game-over card would sit on top of the rail, so the
   rail drops its names and becomes a compact column of tinted glyph+count —
   still a manifest, just at the density the space allows. */
@media (max-width: 760px) {
  #hud .roster { left: 12px; padding: 9px; gap: 4px; }
  #hud .roster .cap .lbl { display: none; }
  #hud .chip { grid-template-columns: 18px 18px; gap: 5px; }
  #hud .chip .nm { display: none; }
  #hud .chip .n { text-align: left; }
}

/* The name flourish — the moment a friend joins the line. Same instrument
   language as the near-miss toast, tinted to that friend, sitting below it so
   the two can never collide. */
#hud .collect {
  position: absolute; top: 178px; left: 50%;
  display: flex; align-items: center; gap: 10px;
  padding: 9px 16px 9px 12px; border-radius: 999px;
  background: var(--surface-hud);
  border: 1px solid var(--tint, var(--accent-2));
  box-shadow: 0 8px 26px rgba(0,0,0,0.45);
  backdrop-filter: blur(10px);
  opacity: 0; transform: translate(-50%, 0);
  pointer-events: none;
}
#hud .collect svg { width: 17px; height: 17px; color: var(--tint, var(--accent-2)); }
#hud .collect .who {
  font-size: 0.9rem; font-weight: 700; letter-spacing: -0.01em;
  color: var(--text);
}
#hud .collect .joined {
  font-size: var(--fs-label); font-weight: 600; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--text-faint);
}
#hud .collect .pts {
  font-family: var(--font-mono); font-size: 0.86rem; font-weight: 600;
  font-variant-numeric: tabular-nums; color: var(--tint, var(--accent-2));
}
#hud .collect.show { animation: collect 1.05s var(--ease); }
@keyframes collect {
  0%   { opacity: 0; transform: translate(-50%, 10px) scale(0.9); }
  16%  { opacity: 1; transform: translate(-50%, 0) scale(1.04); }
  26%  { transform: translate(-50%, 0) scale(1); }
  74%  { opacity: 1; transform: translate(-50%, 0) scale(1); }
  100% { opacity: 0; transform: translate(-50%, -14px) scale(1); }
}

/* Game-over stats. */
#hud .stats { display: flex; gap: 28px; justify-content: center; margin-top: 20px; }
#hud .stat .n {
  font-family: var(--font-mono); font-size: var(--fs-stat); font-weight: 600;
  font-variant-numeric: tabular-nums; color: var(--accent);
}
#hud .stat .k {
  font-size: var(--fs-label); letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--text-faint); margin-top: 4px;
}

/* ── The record plaque ─────────────────────────────────────────────────────
   The persisted best, drawn as a hazard-taped plate rather than another stat
   column. It reads as a thing bolted to the card — the one number that
   survives the run, so it should not look like the two that don't. Rows are
   deliberately tight: it is a label, not a section. */
#hud .best {
  position: relative;
  /* Its own row, sized to content: it must never flow inline beside the CTA,
     which is the next thing in the card and a completely different weight. */
  display: flex; align-items: center; gap: 11px;
  width: fit-content;
  margin: 18px auto 0; padding: 9px 16px 9px 13px;
  border-radius: 12px;
  background: rgba(255,255,255,0.045);
  border: 1px solid var(--hairline);
  overflow: hidden;
  transition: border-color 0.3s var(--ease), background 0.3s var(--ease);
}
#hud .best::before {
  content: "";
  position: absolute; left: 0; top: 0; bottom: 0; width: 4px;
  background: var(--hazard-dim);
}
#hud .best .ic { display: grid; place-items: center; color: var(--text-faint); transition: color 0.3s var(--ease); }
#hud .best .ic svg { width: 19px; height: 19px; }
#hud .best .k {
  font-size: var(--fs-micro); font-weight: 700; letter-spacing: 0.22em;
  text-transform: uppercase; color: var(--text-faint);
}
#hud .best .n {
  font-family: var(--font-mono); font-size: 1.24rem; font-weight: 600;
  font-variant-numeric: tabular-nums; color: var(--text-dim);
  line-height: 1; margin-top: 3px;
  transition: color 0.3s var(--ease);
}
#hud .best .meta { display: flex; flex-direction: column; align-items: flex-start; }
/* A menu with no record yet shouldn't advertise a zero. */
#hud .best.empty .n { color: var(--text-faint); }
/* New record: the plaque lights, the stripe goes full-strength, and the whole
   thing is stamped in. This is the loudest state in the overlay, and it should
   be — it happens once a session at best. */
#hud .best.new {
  background: rgba(255,122,26,0.13);
  border-color: var(--accent-glow);
}
#hud .best.new::before { background: var(--hazard); }
#hud .best.new .ic, #hud .best.new .n { color: var(--accent); }
#hud .best.new .k { color: var(--accent-2); }
#hud .best .tag {
  display: none;
  padding: 3px 8px; border-radius: 999px; margin-left: 2px;
  font-size: var(--fs-micro); font-weight: 700; letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent-ink); background: var(--accent-2);
}
#hud .best.new .tag { display: inline-block; }
#hud[data-screen="gameover"] .best.new { animation: stamp 0.5s var(--ease) 0.28s backwards; }
@keyframes stamp {
  0%   { opacity: 0; transform: scale(1.22); }
  60%  { opacity: 1; transform: scale(0.97); }
  100% { opacity: 1; transform: scale(1); }
}

/* Sound toggle — corner-docked, the only always-on control. It sits above the
   modal scrims on purpose: mute has to be reachable on every screen, including
   the one where the crash cue just played. */
#hud .sound {
  position: absolute; top: 20px; right: 20px; z-index: 2;
  display: grid; place-items: center;
  width: 38px; height: 38px; padding: 0;
  color: var(--text-dim);
  background: var(--surface-hud); border: 1px solid var(--hairline);
  border-radius: 11px; backdrop-filter: blur(10px); cursor: pointer;
  pointer-events: auto;
  transition: color 0.2s var(--ease), transform 0.15s var(--ease),
    border-color 0.2s var(--ease);
}
#hud .sound svg { width: 19px; height: 19px; }
#hud .sound:hover { color: var(--accent-2); border-color: var(--hairline-strong); transform: translateY(-1px); }
#hud .sound:active { transform: scale(0.94); }
#hud .sound:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 2px; }
#hud .sound[data-muted="true"] { color: var(--text-faint); }
#hud .sound .on { display: block; }
#hud .sound .off { display: none; }
#hud .sound[data-muted="true"] .on { display: none; }
#hud .sound[data-muted="true"] .off { display: block; }
/* Game-over: who actually came along. A row of tinted cone glyphs, one per
   friend collected, capped so a heroic run doesn't overflow the card. Reading
   the names back is the payoff for the whole verb. */
#hud .convoy {
  display: flex; flex-wrap: wrap; gap: 6px; justify-content: center;
  margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--hairline);
}
#hud .convoy:empty { display: none; }
#hud .convoy .co {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 4px 9px 4px 7px; border-radius: 999px;
  background: rgba(255,255,255,0.05); border: 1px solid var(--hairline);
  font-size: 0.7rem; font-weight: 600; color: var(--text-dim);
}
#hud .convoy .co svg { width: 14px; height: 14px; color: var(--tint); }
#hud .convoy .more {
  font-family: var(--font-mono); font-variant-numeric: tabular-nums;
  color: var(--accent);
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
/* The sound toggle resolves in place too — a control appearing out of nowhere
   after the first frame is the same broken promise as a card that jumps. */
#hud .skeleton .sk-sound { position: absolute; top: 20px; right: 20px; width: 38px; height: 38px; border-radius: 11px; }
/* Matches the real menu card's footprint, offset AND left dock, so the card
   doesn't jump across the screen when the first frame lands. */
#hud .skeleton .sk-card {
  width: min(90vw, 460px); height: 300px; border-radius: 20px;
  margin-bottom: 12vh;
}
/* Deliberately NO rail skeleton: the skeleton models the MENU, which is what
   the first frame resolves into, and the menu has no roster rail. Promising a
   shape that then vanishes is worse than not promising it — the rail arrives
   on its own transition when the run starts. */
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
  /* The rail must keep its centring transform; only the animation goes. */
  #hud .roster { transform: translateY(-50%) !important; }
  #hud .chip.pop { animation: none; }
  /* The collect flourish still appears — naming your friend is the payoff and
     feedback is not optional — it just fades instead of travelling. */
  #hud .collect { transform: translate(-50%, 0) !important; }
  #hud .collect.show { animation: collect-rm 1.05s linear; }
  @keyframes collect-rm {
    0%, 100% { opacity: 0; }
    16%, 74% { opacity: 1; }
  }
  #hud[data-screen="gameover"] .screen.gameover .crash,
  #hud[data-screen="gameover"] .screen.gameover .eyebrow,
  #hud[data-screen="gameover"] .screen.gameover .title,
  #hud[data-screen="gameover"] .screen.gameover .stats,
  #hud[data-screen="gameover"] .screen.gameover .btn,
  #hud[data-screen="gameover"] .best.new,
  #hud .sk::after { animation: none; }
  #hud .sound, #hud .best { transition: none; }
  /* A new record still announces itself — it just doesn't travel. */
  #hud .record { transform: translate(-50%, 0) !important; }
  #hud .record.show { animation: record-rm 1.5s linear; }
  @keyframes record-rm {
    0%, 100% { opacity: 0; }
    12%, 78% { opacity: 1; }
  }
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
  private readonly collect: HTMLElement;
  private readonly collectName: HTMLElement;
  private readonly collectPts: HTMLElement;
  private readonly rosterMet: HTMLElement;
  private readonly convoy: HTMLElement;
  private readonly chips: HTMLElement[];
  private readonly chipCounts: HTMLElement[];
  private readonly menuBest: HTMLElement;
  private readonly menuBestN: HTMLElement;
  private readonly overBest: HTMLElement;
  private readonly overBestN: HTMLElement;
  private readonly bestRO: HTMLElement;
  private readonly bestVal: HTMLElement;
  private readonly recordToast: HTMLElement;
  private readonly recordN: HTMLElement;
  private readonly overTitle: HTMLElement;
  private readonly soundBtn: HTMLButtonElement;
  private readonly reducedMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  );
  private countFrame: number | null = null;

  /**
   * How many of each named friend are in tow. The HUD's own presentation state
   * — the store owns the *total*, this is only how the rail draws it — fed
   * exclusively by `collected()` from the simulation, never inferred.
   */
  private readonly tally: number[] = FRIENDS.map(() => 0);
  /** Names in join order, for the game-over convoy recap. */
  private readonly joinOrder: number[] = [];

  /**
   * The best score to draw. Presentation state only — the HUD is *told* the
   * number by the renderer, which owns the storage adapter, exactly as it is
   * told who was collected. The HUD never reads localStorage itself.
   */
  private best = 0;
  /** Whether the current game-over card is showing a run that set the record. */
  private bestIsNew = false;
  /** Latched so the mid-run "new record" toast fires exactly once per run. */
  private recordAnnounced = false;

  private prev: GameState;

  constructor(
    private readonly store: GameStore,
    private readonly onUserGesture: () => void,
    private readonly onToggleSound: () => boolean,
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
    this.collect = this.q('#collect');
    this.collectName = this.q('#collect-name');
    this.collectPts = this.q('#collect-pts');
    this.rosterMet = this.q('#roster-met');
    this.convoy = this.q('#convoy');
    this.chips = FRIENDS.map((_, i) => this.q(`#chip-${i}`));
    this.chipCounts = FRIENDS.map((_, i) => this.q(`#chip-n-${i}`));
    this.menuBest = this.q('#menu-best');
    this.menuBestN = this.q('#menu-best-n');
    this.overBest = this.q('#over-best');
    this.overBestN = this.q('#over-best-n');
    this.bestRO = this.q('#ro-best');
    this.bestVal = this.q('#ro-best .val');
    this.recordToast = this.q('#record');
    this.recordN = this.q('#record-n');
    this.overTitle = this.q('#gameover-title');
    this.soundBtn = this.q<HTMLButtonElement>('#soundBtn');

    this.q<HTMLButtonElement>('#startBtn').addEventListener('click', () => {
      this.onUserGesture();
      this.store.start();
    });
    this.q<HTMLButtonElement>('#restartBtn').addEventListener('click', () => {
      this.onUserGesture();
      this.store.start();
    });
    this.soundBtn.addEventListener('click', () => {
      // Unmuting is itself the user gesture that unlocks the AudioContext, so
      // the first thing you hear after enabling sound is the next real cue.
      this.onUserGesture();
      this.soundBtn.dataset.muted = String(this.onToggleSound());
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

  /**
   * Announce a friend joining the conga line: name flourish + roster chip.
   * Called by the renderer from the simulation's `onFriend` callback — the HUD
   * is told *who* was collected, it never works it out from the count.
   */
  collected(pickup: FriendPickup): void {
    if (this.store.getState().status !== 'playing') return;

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

  /**
   * Set the persisted best to draw, and whether the run that just ended set it.
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

    // A toast must never outlive the run it belongs to (e.g. a crash landing
    // one frame after a near miss, or one frame after a pickup).
    if (s.status !== 'playing' && this.prev.status === 'playing') {
      this.nearMiss.classList.remove('show');
      this.collect.classList.remove('show');
    }

    // A fresh run empties the roster, exactly as it empties the conga line.
    // Driven off the store's own reset (friends back to 0) rather than a
    // separate signal, so the rail can never disagree with the counter.
    if (s.friends === 0 && this.prev.friends !== 0) this.resetRoster();
    if (s.status === 'playing' && this.prev.status !== 'playing') {
      this.resetRoster();
      // A new run has a record to beat again, however the last one ended.
      this.recordAnnounced = false;
      this.bestIsNew = false;
      this.recordToast.classList.remove('show');
      this.bestRO.classList.remove('beaten');
      this.paintBest();
    }

    this.scoreVal.textContent = String(s.score);
    this.friendsVal.textContent = String(s.friends);
    this.speedVal.textContent = String(Math.round(s.speed * 4)); // stylised km/h
    // The bar reads the same difficulty curve the simulation ramps along, so
    // "bar full" genuinely means "top speed" rather than an invented ceiling.
    const throttle = intensityForSpeed(s.speed);
    this.speedFill.style.transform = `scaleX(${throttle.toFixed(3)})`;

    // Distance score changes many times per second; bump only on a readable
    // milestone instead of continuously restarting the animation.
    if (Math.floor(s.score / 25) > Math.floor(this.prev.score / 25)) {
      this.flash(this.scoreRO);
    }
    if (s.friends !== this.prev.friends) this.flash(this.friendsRO);

    if (s.status === 'gameover' && this.prev.status !== 'gameover') {
      this.countFinalStats(s.score, s.friends);
      this.paintConvoy();
      // The card leads with what happened. A record is a different headline
      // from a wreck, and burying it under "Wrecked!" wastes the only moment
      // in the game where the player has beaten themselves.
      this.overTitle.textContent = this.bestIsNew ? 'New record!' : 'Wrecked!';
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

  /**
   * Redraw every surface that shows the best: the menu plaque, the game-over
   * plaque and the in-play readout. One painter, so the three can never drift.
   */
  private paintBest(): void {
    const label = this.best > 0 ? String(this.best) : '—';
    this.menuBestN.textContent = label;
    this.overBestN.textContent = label;
    this.bestVal.textContent = String(this.best);
    this.menuBest.classList.toggle('empty', this.best === 0);
    this.overBest.classList.toggle('empty', this.best === 0);
    this.bestRO.classList.toggle('empty', this.best === 0);
    // Only the game-over plaque wears the record state; the menu shows the
    // standing best, and a permanently-lit menu would cheapen the moment.
    this.overBest.classList.toggle('new', this.bestIsNew);
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

  private resetRoster(): void {
    this.tally.fill(0);
    this.joinOrder.length = 0;
    for (const chip of this.chips) chip.classList.remove('pop');
    this.paintRoster();
    this.convoy.innerHTML = '';
  }

  /**
   * The game-over recap: who actually came along, in join order. Capped so a
   * long convoy summarises ("+7 more") instead of blowing out the card.
   */
  private paintConvoy(): void {
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
          <div class="sk sk-sound"></div>
          <div class="sk-stage" style="position:absolute;inset:0;">
            <div class="sk sk-card"></div>
          </div>
        </div>
      </div>

      <div class="screen menu">
        <div class="scrim"></div>
        <div class="card">
          <p class="eyebrow">Endless Highway</p>
          <h1 class="hero">GARY <span class="amp">AND HIS</span> FRIENDS</h1>
          <p class="tagline">A road cone with places to be. Weave the three lanes,
            keep it clean, and pick up a friend or two.</p>
          <div class="best empty" id="menu-best">
            <span class="ic">${icon.record}</span>
            <span class="meta">
              <span class="k">Best run</span>
              <span class="n" id="menu-best-n">—</span>
            </span>
          </div>
          <button class="btn" id="startBtn">${icon.play}<span>Start run</span></button>
          <div class="legend">
            <span><b>Space</b> Start</span>
            <span><b>&larr; &rarr;</b> Lanes</span>
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
        <div class="readout best-ro" id="ro-best">
          <span class="ic">${icon.record}</span>
          <span class="meta"><span class="lbl">Best</span><span class="val">0</span></span>
        </div>
        <div class="play-hint"><b>&larr; &rarr;</b> Switch lane</div>
      </div>

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
      </div>

      <div class="record" id="record">
        ${icon.record}<span>New record</span><span class="pts" id="record-n">0</span>
      </div>

      <div class="screen gameover">
        <div class="scrim"></div>
        <div class="card">
          <span class="crash">${icon.crash}</span>
          <p class="eyebrow" style="margin-top:12px;">Run ended</p>
          <h2 class="title" id="gameover-title">Wrecked!</h2>
          <div class="stats">
            <div class="stat"><div class="n" id="final-score">0</div><div class="k">Score</div></div>
            <div class="stat"><div class="n" id="final-friends">0</div><div class="k">Friends</div></div>
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
          <div class="legend"><span><b>Space</b> Restart</span></div>
        </div>
      </div>
    `;
  }
}
