/** 3D brand tokens pinned to --accent / --accent-2 / --bg in index.html. */
export const ACCENT = 0xff7a1a;
export const ACCENT_2 = 0xffb347;
export const BG = 0x0e0e18;

/**
 * The friend shells, pinned to --friend-1..5 in index.html.
 *
 * Deliberately an accent-FAMILY palette of warms rather than five arbitrary
 * hues: the convoy has to read as Gary's people at a glance, and stay clearly
 * separate from the desaturated cool greys of oncoming traffic. None of them is
 * --accent itself — that exact orange stays Gary's alone.
 *
 * Indexed by friend `variant` (see src/game/friends/roster.ts).
 */
export const FRIEND_TINTS = [
  0xffd7a1, // Coneelia — soft amber cream
  0xd9743f, // Bartholocone — copper
  0xf4e9d6, // Sir Cones-a-lot — ivory
  0xffc266, // Tiny — bright honey
  0xc2542f, // Big Dave — deep rust
] as const;
