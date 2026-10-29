// Adapted from turbogizzmo's macOS fork, commit 767fa70 (GPL-3.0-only).
// In ChatPlus's rich-text message box, WKWebView sometimes turns an arrow-key
// press into typed text instead of caret movement: Right Arrow arrives as an
// insertText of U+001D, the legacy Mac code for that key (Left/Up/Down are
// U+001C/U+001E/U+001F), which renders as a box while the caret stays put.
// Observed on a real ChatPlus server through beforeinput only. Control
// characters are never typed text, so block them there and perform the
// movement the key meant. Tab, newlines and all printable text are untouched.

const blocked = (code: number) =>
  (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) ||
  code === 0x7f;

export const isControlText = (text: string | null | undefined) =>
  !!text &&
  Array.from(text).some((character) => blocked(character.codePointAt(0)!));

type Direction = "forward" | "backward";
type Granularity =
  "character" | "word" | "line" | "lineboundary" | "documentboundary";

// Legacy Mac key codes: arrows, then Home (U+0001) and End (U+0004).
const MOVES = new Map<number, [Direction, Granularity]>([
  [0x1c, ["backward", "character"]],
  [0x1d, ["forward", "character"]],
  [0x1e, ["backward", "line"]],
  [0x1f, ["forward", "line"]],
  [0x01, ["backward", "lineboundary"]],
  [0x04, ["forward", "lineboundary"]],
]);

interface Modifiers {
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

interface GuardHost extends EventTarget {
  getSelection?: () => {
    modify?: (
      alter: "move" | "extend",
      direction: Direction,
      granularity: Granularity,
    ) => void;
  } | null;
}

export function moveFor(
  code: number,
  modifiers: Modifiers,
):
  | [alter: "move" | "extend", direction: Direction, granularity: Granularity]
  | null {
  const step = MOVES.get(code);
  if (!step) return null;
  let [direction, granularity] = step;
  // macOS conventions: Option moves by word, Cmd to the line or document edge.
  if (granularity === "character" && modifiers.altKey) granularity = "word";
  if (granularity === "character" && modifiers.metaKey)
    granularity = "lineboundary";
  if (granularity === "line" && modifiers.metaKey)
    granularity = "documentboundary";
  return [modifiers.shiftKey ? "extend" : "move", direction, granularity];
}

export function installArrowKeyGuard(host: GuardHost) {
  // beforeinput carries no modifier state; take it from the key that caused it.
  let modifiers: Modifiers = { shiftKey: false, altKey: false, metaKey: false };
  host.addEventListener(
    "keydown",
    (event) => {
      const { shiftKey, altKey, metaKey } = event as KeyboardEvent;
      modifiers = { shiftKey, altKey, metaKey };
    },
    true,
  );
  host.addEventListener(
    "beforeinput",
    (event) => {
      const data = (event as InputEvent).data;
      if (!isControlText(data)) return;
      event.preventDefault();
      const move =
        data!.length === 1 && moveFor(data!.codePointAt(0)!, modifiers);
      if (move) host.getSelection?.()?.modify?.(...move);
    },
    true,
  );
}

(() => {
  if (typeof window === "undefined") return;
  installArrowKeyGuard(window as unknown as GuardHost);
})();
