// Inline SVG icons (24×24, stroke = currentColor).
const P = {
  move: '<path d="M12 2v20M2 12h20"/><path d="m9 5 3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3"/>',
  'marquee-rect': '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.4"/>',
  'marquee-ellipse': '<ellipse cx="12" cy="12" rx="9" ry="7" stroke-dasharray="3 2.4"/>',
  brush: '<path d="m9.1 11.9 8-8.1a2.9 2.9 0 1 1 4.1 4.1l-8.1 8"/><path d="M7.1 14.9c-1.7 0-3 1.4-3 3 0 1.4-2.5 1.6-2 2 1.1 1.1 2.5 2 4 2 2.2 0 4-1.8 4-4a3 3 0 0 0-3-3z"/>',
  pencil: '<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/><path d="m15 5 4 4"/>',
  eraser: '<path d="m7 21-4.3-4.3a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21"/><path d="M22 21H7M5 11l9 9"/>',
  bucket: '<path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2a2 2 0 0 0 2.8 0z"/><path d="m5 2 5 5M2 13h15"/><path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4z"/>',
  gradient: '<defs><linearGradient id="pf-g1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="3" y="5" width="18" height="14" rx="1.5"/><rect x="3" y="5" width="18" height="14" rx="1.5" fill="url(#pf-g1)" stroke="none"/>',
  lasso: '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><circle cx="5" cy="16" r="2"/>',
  'polygon-lasso': '<path d="M5 15 3 6l8-3 10 6-3 10-9-2"/><circle cx="6" cy="17" r="2"/><path d="M6 19v3"/>',
  wand: '<path d="m21.6 3.6-1.2-1.2a1.2 1.2 0 0 0-1.7 0L2.4 18.7a1.2 1.2 0 0 0 0 1.7l1.2 1.2a1.2 1.2 0 0 0 1.7 0L21.6 5.3a1.2 1.2 0 0 0 0-1.7Z"/><path d="m14 7 3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>',
  clone: '<path d="M5 22h14"/><path d="M19.3 13.7a2.5 2.5 0 0 0-1.8-.7h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-1.5c0-.7-.3-1.3-.7-1.8z"/><path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/>',
  heal: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 6v12M18 6v12M10 10h.01M10 14h.01M14 10h.01M14 14h.01"/>',
  spot: '<circle cx="12" cy="12" r="5" stroke-dasharray="2.5 2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  dodge: '<circle cx="15" cy="9" r="5"/><path d="m11.5 12.5-8 8"/>',
  burn: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
  sponge: '<rect x="3" y="7" width="18" height="12" rx="3"/><circle cx="8" cy="12" r="1"/><circle cx="13" cy="14.5" r="1"/><circle cx="16" cy="10.5" r="1"/>',
  blur: '<path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/>',
  sharpen: '<path d="M12 3 21 20H3z"/>',
  smudge: '<path d="M8 13V4.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-2a1.5 1.5 0 0 1 3 0V12M14 10.5a1.5 1.5 0 0 1 3 0V12"/><path d="M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  'align-left': '<path d="M3 6h18M3 12h12M3 18h15"/>',
  'align-center': '<path d="M3 6h18M6 12h12M4.5 18h15"/>',
  'align-right': '<path d="M3 6h18M9 12h12M6 18h15"/>',
  'shape-rect': '<rect x="3" y="5" width="18" height="14" rx="1"/>',
  'shape-ellipse': '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  'shape-polygon': '<path d="M12 3 21 9.5 17.5 20h-11L3 9.5z"/>',
  'shape-line': '<path d="M4 20 20 4"/>',
  mask: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="4" fill="currentColor" fill-opacity=".35"/>',
  transform: '<rect x="5" y="5" width="14" height="14" stroke-dasharray="3 2"/><path d="M3 3h4v4H3zM17 3h4v4h-4zM3 17h4v4H3zM17 17h4v4h-4z"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  eyedropper: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3z"/>',
  hand: '<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="m21 21-5-5"/>',
  'zoom-in': '<circle cx="11" cy="11" r="7"/><path d="m21 21-5-5M11 8v6M8 11h6"/>',
  'zoom-out': '<circle cx="11" cy="11" r="7"/><path d="m21 21-5-5M8 11h6"/>',
  'sel-new': '<rect x="4" y="4" width="16" height="16" rx="1" fill="currentColor" fill-opacity=".35"/>',
  'sel-add': '<path d="M3 3h11v6h6v11H9v-6H3z" fill="currentColor" fill-opacity=".35"/>',
  'sel-subtract': '<path d="M3 3h11v6H9v5H3z" fill="currentColor" fill-opacity=".35"/><rect x="9" y="9" width="11" height="11" stroke-dasharray="2.5 2"/>',
  'sel-intersect': '<rect x="3" y="3" width="11" height="11" stroke-dasharray="2.5 2"/><rect x="10" y="10" width="11" height="11" stroke-dasharray="2.5 2"/><rect x="10" y="10" width="4" height="4" fill="currentColor"/>',
  'grad-linear': '<defs><linearGradient id="pf-g2"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="4" y="4" width="16" height="16" fill="url(#pf-g2)"/>',
  'grad-radial': '<defs><radialGradient id="pf-g3"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs><rect x="4" y="4" width="16" height="16" fill="url(#pf-g3)"/>',
  'grad-angle': '<rect x="4" y="4" width="16" height="16"/><path d="M12 12h8M12 12 6 5M12 12l-6 7" stroke-opacity=".8"/>',
  'grad-reflected': '<defs><linearGradient id="pf-g4"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset=".5" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><rect x="4" y="4" width="16" height="16" fill="url(#pf-g4)"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  'layer-new': '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 8v8M8 12h8"/>',
  duplicate: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  merge: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  swap: '<path d="M7 4h9a4 4 0 0 1 4 4v9"/><path d="m17 14 3 3 3-3M10 1 7 4l3 3"/>',
  'reset-colors': '<rect x="2" y="2" width="12" height="12" fill="currentColor"/><rect x="10" y="10" width="12" height="12"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  panels: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>',
};

const NS = 'http://www.w3.org/2000/svg';

export function icon(name, size = 18) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = P[name] || P['sel-new'];
  return svg;
}
