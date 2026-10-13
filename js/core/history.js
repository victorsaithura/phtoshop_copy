/**
 * Undo/redo stack shown in the History panel.
 * entries[0] is the initial state ("New" / "Open"); entries[index] is current.
 */
export class History {
  constructor(limit = 50, onChange = () => {}) {
    this.limit = limit;
    this.onChange = onChange;
    this.entries = [];
    this.index = -1;
    this.savedEntry = null;
  }

  reset(label) {
    this.entries = [{ label, undo: null, redo: null }];
    this.index = 0;
    this.savedEntry = this.entries[0];
    this.onChange();
  }

  push(label, undo, redo) {
    this.entries.length = this.index + 1; // drop the redo branch
    this.entries.push({ label, undo, redo });
    while (this.entries.length > this.limit + 1) this.entries.shift();
    this.index = this.entries.length - 1;
    this.onChange();
  }

  get current() { return this.entries[this.index]; }
  get canUndo() { return this.index > 0; }
  get canRedo() { return this.index < this.entries.length - 1; }
  get undoLabel() { return this.canUndo ? this.entries[this.index].label : ''; }
  get redoLabel() { return this.canRedo ? this.entries[this.index + 1].label : ''; }
  get dirty() { return this.current !== this.savedEntry; }

  markSaved() {
    this.savedEntry = this.current;
    this.onChange();
  }

  _step(dir) {
    if (dir < 0) {
      this.entries[this.index].undo();
      this.index--;
    } else {
      this.index++;
      this.entries[this.index].redo();
    }
  }

  undo() {
    if (!this.canUndo) return false;
    this._step(-1);
    this.onChange();
    return true;
  }

  redo() {
    if (!this.canRedo) return false;
    this._step(1);
    this.onChange();
    return true;
  }

  goTo(i) {
    i = Math.max(0, Math.min(i, this.entries.length - 1));
    if (i === this.index) return;
    while (this.index > i) this._step(-1);
    while (this.index < i) this._step(1);
    this.onChange();
  }
}
