/**
 * The game-select grid: four cards, the accessible way.
 *
 * ── Why a layout grid and not a menu ────────────────────────────────────────
 * `role="menu"` promises a menubar's whole keyboard contract (type-ahead,
 * submenus, Escape-to-close semantics, first-character navigation) that this
 * screen does not implement, and screen readers announce it as an application
 * menu rather than as the game chooser it plainly is. So this follows the
 * WAI-ARIA **layout grid** pattern instead: `role="grid"` with `role="row"` /
 * `role="gridcell"` wrappers, and a real `<button>` inside every cell.
 *
 * ── Roving tabindex ─────────────────────────────────────────────────────────
 * Exactly one card is in the tab order at a time (`tabindex="0"`, the rest
 * `-1`), so Tab moves past the grid rather than through four stops, and the
 * arrow keys move *within* it. That is the standard composite-widget contract.
 *
 * ── Native activation, exactly once ─────────────────────────────────────────
 * The cards are real `<button>`s, so the browser already fires `click` on Enter
 * AND on Space. This component therefore handles ONLY the four arrow keys and
 * lets the browser own activation — which is why Space can never both activate
 * a card and be re-read by the shell as a `primary` action. The shell's global
 * keydown listener skips any event whose target is inside this grid (see
 * `ownsEvent`), so there is exactly one handler per keystroke.
 */
import { GAMES, GRID_COLUMNS } from '../game/arcade/catalog.ts';
import type { ArcadeAction, GameId } from '../game/arcade/contracts.ts';
import { moveCursor } from '../game/arcade/input.ts';
import { icon } from './icons.ts';

export interface GameSelectHandlers {
  /** The cursor moved to a different card (hover/arrow/focus). */
  onHighlight(id: GameId): void;
  /** A card was activated — open that game. */
  onActivate(id: GameId): void;
}

export class GameSelect {
  private readonly cards: HTMLButtonElement[];
  private index = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly handlers: GameSelectHandlers,
  ) {
    this.cards = GAMES.map((game) => {
      const el = this.root.querySelector<HTMLButtonElement>(
        `#gcard-${game.id}`,
      );
      if (!el) throw new Error(`Game card not found: ${game.id}`);
      return el;
    });

    this.cards.forEach((card, i) => {
      // Activation is the browser's: `click` already covers mouse, touch,
      // Enter and Space on a native button. Nothing here re-implements it.
      card.addEventListener('click', () => {
        this.focusIndex(i, false);
        this.handlers.onActivate(GAMES[i].id);
      });
      // Arrow keys only. Everything else — including Space and Enter — falls
      // through to the button's native behaviour.
      card.addEventListener('keydown', (e) => this.onKeyDown(e, i));
      // Focus reaching a card by any route (Tab, click, programmatic) is the
      // cursor moving, so the roving tabindex and the selection agree.
      //
      // Focus is the ONLY thing that moves the cursor. Hover deliberately does
      // not: it would split the cursor in two — keyboard focus on one card and
      // the live 3D showing another — and it would let the mouse merely
      // resting somewhere after an unrelated click silently change which game
      // is selected. Hover still gets its own :hover affordance in CSS.
      card.addEventListener('focus', () => this.focusIndex(i, false));
    });

    this.paintTabindex();
  }

  /** Which card the cursor is on. */
  get selected(): GameId {
    return GAMES[this.index].id;
  }

  /**
   * Does this keyboard event belong to the grid?
   *
   * The shell asks before routing a global keystroke, so a key pressed while a
   * card has focus is handled once — here — instead of twice. This is the
   * mechanism behind "native button activation never double-fires".
   */
  ownsEvent(target: EventTarget | null): boolean {
    return target instanceof Node && this.root.contains(target);
  }

  /** Move the cursor from a normalized action (the shell's keyboard/swipe path
   *  when focus is NOT already inside the grid). */
  handleAction(action: ArcadeAction): void {
    if (action === 'primary') {
      this.handlers.onActivate(this.selected);
      return;
    }
    const next = moveCursor(this.index, GAMES.length, GRID_COLUMNS, action);
    if (next !== this.index) this.focusIndex(next, true);
  }

  /** Point the cursor at a game without stealing focus (store -> UI sync). */
  setSelected(id: GameId): void {
    const next = GAMES.findIndex((g) => g.id === id);
    if (next < 0 || next === this.index) return;
    this.index = next;
    this.paintTabindex();
  }

  /** Put DOM focus on the current card — used when the menu becomes visible. */
  focusCurrent(): void {
    this.cards[this.index].focus();
  }

  private onKeyDown(e: KeyboardEvent, from: number): void {
    const action = ARROW_ACTIONS[e.key];
    if (!action) return;
    // Only now do we claim the event: arrows would otherwise scroll the grid's
    // own overflow container out from under the focused card.
    e.preventDefault();
    const next = moveCursor(from, GAMES.length, GRID_COLUMNS, action);
    this.focusIndex(next, true);
  }

  private focusIndex(next: number, moveFocus: boolean): void {
    this.index = next;
    this.paintTabindex();
    if (moveFocus) this.cards[next].focus();
    this.handlers.onHighlight(GAMES[next].id);
  }

  /** Exactly one card in the tab order; `aria-current` marks the chosen one. */
  private paintTabindex(): void {
    this.cards.forEach((card, i) => {
      const current = i === this.index;
      card.tabIndex = current ? 0 : -1;
      card.setAttribute('aria-current', String(current));
    });
  }

  /** Update the per-card best scores. Called whenever a record changes. */
  paintBests(bests: Readonly<Record<GameId, number>>): void {
    for (const game of GAMES) {
      const el = this.root.querySelector<HTMLElement>(`#gbest-${game.id}`);
      if (!el) continue;
      const best = bests[game.id] ?? 0;
      el.textContent = best > 0 ? String(best) : '—';
    }
  }
}

/** Only the arrows are claimed here; Space/Enter stay native. */
const ARROW_ACTIONS: Readonly<Record<string, ArcadeAction | undefined>> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/**
 * The grid's markup. Row wrappers are `display: contents` so the CSS grid still
 * lays cells out directly — the rows exist for assistive technology, which
 * needs them to report "row 2 of 2, column 1 of 2".
 */
export function gameSelectTemplate(): string {
  const rows: string[] = [];
  for (let start = 0; start < GAMES.length; start += GRID_COLUMNS) {
    const cells = GAMES.slice(start, start + GRID_COLUMNS)
      .map((game) => {
        const cast = [
          game.cast.gary
            ? `<span class="gary" title="Gary">${icon.cone}</span>`
            : '',
          ...game.cast.friends.map(
            (i) =>
              `<span style="--tint: var(--friend-${i + 1});">${icon.cone}</span>`,
          ),
        ].join('');
        // Only the primary control on the card. Two hints always truncated
        // mid-word at this width, and half a control hint teaches nothing —
        // the full scheme is one keystroke away in the launch strip.
        const primary = game.controls[0];
        const keys = `<b>${primary.keys}</b> ${primary.action}`;
        // The accessible name says everything the card shows, in reading order,
        // so a screen-reader user gets the same comparison a sighted player
        // makes at a glance — including whether the slot is playable yet.
        const label = [
          game.title,
          game.playable ? '' : 'coming soon',
          game.description,
          `Controls: ${game.controls.map((c) => `${c.keys} ${c.action}`).join(', ')}`,
        ]
          .filter(Boolean)
          .join('. ');
        return `
          <div role="gridcell">
            <button type="button" class="gcard" id="gcard-${game.id}"
                    data-game="${game.id}" tabindex="-1" aria-current="false"
                    aria-label="${escapeAttr(label)}">
              <span class="shot">
                <img src="${game.preview}" alt="" width="480" height="300"
                     loading="lazy" decoding="async" />
                ${game.playable ? '' : '<span class="soon">Soon</span>'}
              </span>
              <span class="body">
                <span class="gname">${game.title}</span>
                <span class="cast" aria-hidden="true">${cast}</span>
                <span class="gdesc">${game.description}</span>
                <span class="foot">
                  <span class="keys" aria-hidden="true">${keys}</span>
                  <span class="gbest" aria-hidden="true">Best
                    <span class="n" id="gbest-${game.id}">—</span>
                  </span>
                </span>
              </span>
            </button>
          </div>`;
      })
      .join('');
    rows.push(`<div role="row">${cells}</div>`);
  }

  return `
    <div class="grid" role="grid" id="game-grid"
         aria-label="Choose a game">${rows.join('')}</div>`;
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
