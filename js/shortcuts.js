import { isTyping } from './io.js';
import { isModalOpen } from './ui/dialogs.js';

const CODE_KEYS = {
  BracketLeft: '[', BracketRight: ']', Equal: '=', Minus: '-', Slash: '/', Comma: ',',
  Period: '.', Backquote: '`', Backslash: '\\', Semicolon: ';', Quote: "'",
};
const MOD_ORDER = ['Ctrl', 'Alt', 'Shift'];

/** "Shift+Ctrl+z" → "Ctrl+Shift+Z" so action keys and events compare equal. */
export function normalizeCombo(combo) {
  const parts = combo.split('+');
  const key = parts.pop() || '+';
  const mods = MOD_ORDER.filter((m) => parts.includes(m));
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}

/** Layout-independent combo for a keyboard event (Cmd counts as Ctrl). */
export function comboFromEvent(e) {
  const c = e.code || '';
  let key;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^Numpad\d$/.test(c)) key = c.slice(6);
  else if (CODE_KEYS[c]) key = CODE_KEYS[c];
  else if (c === 'NumpadAdd' || c === 'NumpadSubtract') key = c;
  else key = e.key && e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

export function setupShortcuts(app, toolbar) {
  const map = new Map();
  for (const a of Object.values(app.actions)) {
    for (const k of a.keys || []) map.set(normalizeCombo(k), a);
  }

  window.addEventListener('keydown', (e) => {
    if (isModalOpen() || isTyping(e.target)) return;
    // Keep keyboard navigation working on focused controls.
    const onControl = e.target instanceof HTMLElement && e.target.closest('button, a, input, .menu-dropdown');
    if (onControl && (e.key === 'Tab' || e.key === 'Enter' || e.code === 'Space' || e.key.startsWith('Arrow'))) return;

    if (e.code === 'Space') {
      e.preventDefault();
      if (!app.spaceDown) {
        app.spaceDown = true;
        app.updateCursor();
      }
      return;
    }
    // The active tool gets first refusal (brush size, nudging, Enter/Esc for transforms…).
    if (app.doc && app.tool?.onKeyDown(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') {
      app.tool?.cancel?.();
      return;
    }

    const combo = comboFromEvent(e);
    const action = map.get(combo);
    if (action) {
      e.preventDefault();
      if (!action.enabled || action.enabled()) action.run();
      return;
    }

    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = combo.replace('Shift+', '');
    if (key === 'X' && !e.shiftKey) {
      e.preventDefault();
      app.swapColors();
    } else if (key === 'D' && !e.shiftKey) {
      e.preventDefault();
      app.resetColors();
    } else if (/^[A-Z]$/.test(key) && toolbar.selectByKey(key, e.shiftKey)) {
      e.preventDefault();
    }
  });

  const releaseSpace = () => {
    if (!app.spaceDown) return;
    app.spaceDown = false;
    app.updateCursor();
  };
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') releaseSpace();
  });
  window.addEventListener('blur', releaseSpace);
}
