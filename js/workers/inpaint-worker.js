import { inpaint } from '../core/inpaint.js';

/* Content-Aware Fill off the main thread: { id, data, hole, w, h } in; progress, then the result, out. */
self.onmessage = (e) => {
  const { id, data, hole, w, h } = e.data;
  try {
    let last = 0;
    const out = inpaint(data, hole, w, h, {
      onProgress: (p) => {
        if (p - last < 0.02 && p < 1) return;
        last = p;
        self.postMessage({ id, progress: p });
      },
    });
    self.postMessage({ id, result: out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
