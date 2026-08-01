/**
 * The one icon set, used end to end by every overlay surface.
 *
 * Hand-drawn inline SVG on a single 24×24 grid, 2px stroke, round caps and
 * joins. That uniformity is the whole point: one family means the play glyph on
 * a game card and the cone glyph on the convoy rail read as the same object
 * drawn by the same hand. No second icon library, and no emoji — an emoji is
 * another vendor's typeface with another vendor's colour palette, and it would
 * be the loudest, least controllable thing on the screen.
 */

const ns =
  'stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const icon = {
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
  // The way back to the cabinet: a grid of four slots, matching the 2×2 select.
  cabinet: `<svg viewBox="0 0 24 24" ${ns}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.6"/></svg>`,
  // A generic instrument dial, for a game whose metric has no glyph of its own.
  gauge: `<svg viewBox="0 0 24 24" ${ns}><path d="M12 3a9 9 0 0 1 9 9"/><path d="M12 3a9 9 0 0 0-9 9"/><path d="M3 12h2.5M18.5 12H21M12 3v2.5"/><path d="M12 16.5 16 9"/><circle cx="12" cy="16.5" r="1.4"/></svg>`,
};

export type IconName = keyof typeof icon;
