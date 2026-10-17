'use client';

import { useEffect, useRef, useState } from 'react';

/** Where the CRM sits on the 960x560 canvas, and the eight people it messages. */
const CRM = { x: 118, y: 244 };
const POS: Array<[number, number]> = [[520, 70], [520, 190], [520, 310], [520, 430], [740, 70], [740, 190], [740, 310], [740, 430]];
/** The three people who reply; the rest only read it. */
const REPLIERS = [1, 4, 6];
const SPARKS: Array<[number, number]> = [[-30, -26], [34, -34], [-12, -50], [24, 4]];

/** Head and shoulders, the default avatar shape. `lit` is the same shape in white, shown once they reply. */
function Silhouette({ cls }: { cls: string }) {
  return (
    <svg className={cls} viewBox="0 0 84 92" aria-hidden>
      <circle cx="42" cy="28" r="17" /><path d="M8 88c0-20 15-33 34-33s34 13 34 33z" />
    </svg>
  );
}

/** A bundle of cash drawn long and flat: wide front, thin top, narrow side, a yellow band around the middle. */
function Brick() {
  return (
    <svg viewBox="0 0 108 54" aria-hidden>
      <polygon points="84,22 104,6 104,34 84,50" fill="#23965b" />
      <rect x="4" y="22" width="80" height="28" fill="#2fae6d" />
      <polygon points="4,22 24,6 104,6 84,22" fill="#4ee3a0" />
      <polygon points="10,20 26,9 98,9 80,20" fill="none" stroke="#2fae6d" strokeWidth="1.1" opacity=".7" />
      <ellipse cx="54" cy="14" rx="11" ry="3.6" fill="#3bc885" stroke="#2fae6d" strokeWidth="1" />
      <polygon points="40,22 49.6,22 69.6,6 60,6" fill="#fdd68a" />
      <rect x="40" y="22" width="9.6" height="28" fill="#fbbf5a" />
    </svg>
  );
}

/**
 * The animation behind sign-in: the CRM messages eight people, three reply, they are served, and a stack
 * of cash grows with an arrow beside it. Decorative (hidden from assistive tech); every moving part is CSS
 * on one 14-second clock, so it costs no script after the first paint.
 *
 * The canvas is a fixed 960x560 and is scaled to whatever width the panel has.
 */
export function LeadScene() {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.66);

  useEffect(() => {
    const el = box.current;
    if (el === null) return undefined;
    const fit = () => { setScale(Math.min(1, el.clientWidth / 960)); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, []);

  return (
    <div ref={box} className="w-full" style={{ height: 560 * scale }} aria-hidden>
      <div className="scene" style={{ transform: `scale(${String(scale)})` }}>
        <div className="cap">
          <span className="c1"><b>1 · Message everyone</b></span><span className="c2"><b>2 · A few reply</b></span>
          <span className="c3"><b>3 · They get the service</b></span><span className="c4"><b>4 · Revenue goes up</b></span>
        </div>
        <svg className="lines" viewBox="0 0 960 560">
          {POS.map(([x, y]) => <line key={`${String(x)}-${String(y)}`} x1={CRM.x} y1={CRM.y} x2={x + 42} y2={y + 46} />)}
        </svg>
        <div className="crm">W<small>Your CRM</small></div>
        <div className="tally">
          <label>Revenue</label>
          <div className="stack">
            {[0, 1, 2, 3, 4].map((k) => (
              <span key={k} className="brick" style={{ ['--k' as string]: k, animationName: `sc-brick${String(k)}` }}><Brick /></span>
            ))}
          </div>
          <div className="arrow"><i className="head" /><i className="shaft" /></div>
        </div>
        {POS.map(([x, y], i) => {
          const rep = REPLIERS.indexOf(i);
          const dx = x + 42 - CRM.x - 17, dy = y + 46 - CRM.y - 12;
          return (
            <div key={i}>
              <div className={`sil ${rep >= 0 ? 'rep' : ''}`} style={{ left: x, top: y }}>
                <Silhouette cls="grey" />
                {rep >= 0 && (
                  <>
                    <Silhouette cls="lit" />
                    <div className="badge" style={{ animationDelay: `${String(rep * 0.25)}s` }}>
                      <svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
                    </div>
                    {SPARKS.map(([sx, sy], k) => (
                      <i key={k} className="spark" style={{ ['--sx' as string]: `${String(sx)}px`, ['--sy' as string]: `${String(sy)}px`, left: 34 + k * 3, top: 30, animationDelay: `${String(rep * 0.25 + k * 0.08)}s` }} />
                    ))}
                    <div className="note" style={{ animationDelay: `${String(rep * 0.3)}s` }} />
                    <div className="note" style={{ left: 44, animationDelay: `${String(rep * 0.3 + 0.35)}s` }} />
                    <div className="cash" style={{ animationDelay: `${String(rep * 0.3)}s` }}>
                      <svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.8" /></svg>+
                    </div>
                  </>
                )}
              </div>
              <div className="msg" style={{ left: CRM.x, top: CRM.y, ['--dx' as string]: `${String(dx)}px`, ['--dy' as string]: `${String(dy)}px`, animationDelay: `${String(i * 0.22)}s` }}>
                <i /><i /><i />
              </div>
              {rep >= 0 && (
                <div className="reply" style={{ left: x + 20, top: y + 30, ['--dx' as string]: `${String(x + 42 - CRM.x - 20)}px`, ['--dy' as string]: `${String(y + 46 - CRM.y - 30)}px`, animationDelay: `${String(rep * 0.2)}s` }}>
                  Hi, interested!
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
