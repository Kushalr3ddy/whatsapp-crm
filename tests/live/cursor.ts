/**
 * A visible mouse pointer for recordings. Playwright's video does not draw the OS cursor, so this
 * script (added to every page before it loads) paints a ring that follows `mousemove`, shrinks on
 * press and leaves a short ripple on each click.
 */
export const CURSOR_OVERLAY = `
(() => {
  if (window.__liveCursor) return;
  window.__liveCursor = true;
  const make = () => {
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;' +
      'border:3px solid #e11d48;border-radius:50%;background:rgba(225,29,72,.18);z-index:2147483647;' +
      'pointer-events:none;transition:transform .08s ease-out;transform:translate(-100px,-100px)';
    document.documentElement.appendChild(ring);
    let x = -100, y = -100;
    const move = (e) => { x = e.clientX; y = e.clientY; ring.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    addEventListener('mousemove', move, true);
    addEventListener('mousedown', (e) => { move(e); ring.style.transform += ' scale(.7)'; }, true);
    addEventListener('mouseup', (e) => {
      move(e);
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:12px;height:12px;margin:-6px 0 0 -6px;' +
        'border:3px solid #e11d48;border-radius:50%;z-index:2147483646;pointer-events:none;' +
        'transition:transform .45s ease-out,opacity .45s ease-out;opacity:.9';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(4)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.documentElement) make(); else addEventListener('DOMContentLoaded', make);
})();
`;
