'use client';

import { useEffect, useRef, useState } from 'react';

/** Where the CRM tile's centre sits on the 960x560 canvas, and the eight people it messages. */
const CRM = { x: 236, y: 240 };
const POS: Array<[number, number]> = [[520, 70], [520, 190], [520, 310], [520, 430], [740, 70], [740, 190], [740, 310], [740, 430]];
/** Who says yes, who says no; everyone else never answers and fades to grey. */
const ACCEPT = [1, 4, 6];
const DECLINE = [2, 7];
const SPARKS: Array<[number, number]> = [[-30, -26], [34, -34], [-12, -50], [24, 4]];

/** Head and shoulders, the default avatar shape. The same shape is drawn in several colours and faded between them. */
function Silhouette({ cls }: { cls: string }) {
  return (
    <svg className={cls} viewBox="0 0 84 92" aria-hidden>
      <circle cx="42" cy="28" r="17" /><path d="M8 88c0-20 15-33 34-33s34 13 34 33z" />
    </svg>
  );
}

/** One support agent wearing a headset, drawn at a position and size; the collar is cut out in the CRM green. */
function Agent({ x, y, scale }: { x: number; y: number; scale: number }) {
  return (
    <g transform={`translate(${String(x)} ${String(y)}) scale(${String(scale)})`}>
      <path d="M-24 28C-24 12-12 3 0 3s24 9 24 25z" fill="currentColor" />
      <path d="M-7 4 0 14 7 4" fill="none" stroke="#138a4f" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="0" cy="-15" r="11" fill="currentColor" />
      <path d="M-14-17a14 14 0 0 1 28 0" fill="none" stroke="currentColor" strokeWidth="3" />
      <rect x="-19" y="-21" width="6" height="11" rx="3" fill="currentColor" />
      <rect x="13" y="-21" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M-15-10q0 11 11 11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="-3.5" cy="1" r="2.6" fill="currentColor" />
    </g>
  );
}

/** Your organisation: three headset-wearing agents, the middle one in front. */
function OrgIcon() {
  return (
    <svg viewBox="0 0 120 76" aria-hidden>
      <Agent x={22} y={42} scale={0.78} /><Agent x={98} y={42} scale={0.78} /><Agent x={60} y={36} scale={1} />
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

/** The service we send: a clipboard with two ticked rows. */
function Clipboard() {
  return (
    <svg viewBox="0 0 48 56" fill="none" stroke="#14532d" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="6" y="9" width="36" height="42" rx="7" fill="#fff" />
      <path d="M17 9V6.5a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4V9" fill="#fff" />
      <path d="M14 20h20" />
      <path d="M13 30l3.2 3.2 5.6-6.4M26 29h3.5M32 29h3.5" />
      <path d="M13 42l3.2 3.2 5.6-6.4M26 41h3.5M32 41h3.5" />
    </svg>
  );
}

/**
 * The animation behind sign-in and sign-up. Your organisation + our CRM message eight people; three say
 * they are interested (green), two decline (red), three never answer (grey); the CRM sends the service
 * to the interested, and a stack of cash with an arrow grows. Decorative, so hidden from assistive tech;
 * every moving part is CSS on one 14-second clock, so it costs no script after the first paint.
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
          <span className="c1"><b>1 · Your team + our CRM message everyone</b></span>
          <span className="c2"><b>2 · Some say yes, some say no</b></span>
          <span className="c3"><b>3 · We send the service to the interested</b></span>
          <span className="c4"><b>4 · Revenue goes up</b></span>
        </div>
        <svg className="lines" viewBox="0 0 960 560">
          {POS.map(([x, y]) => <line key={`${String(x)}-${String(y)}`} x1={CRM.x} y1={CRM.y} x2={x + 42} y2={y + 46} />)}
        </svg>
        <div className="frame" />
        <div className="org"><OrgIcon /></div>
        <div className="plus">+</div>
        <div className="crm">W</div>
        <div className="who">Your organisation + our CRM</div>
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
          const yes = ACCEPT.indexOf(i);
          const no = DECLINE.indexOf(i);
          const idle = yes < 0 && no < 0;
          const dx = x + 42 - CRM.x - 17, dy = y + 46 - CRM.y - 12;
          return (
            <div key={i}>
              <div className={`sil ${yes >= 0 ? 'acc' : ''} ${no >= 0 ? 'rej' : ''} ${idle ? 'idle' : ''}`} style={{ left: x, top: y }}>
                <Silhouette cls="blue" />
                {yes >= 0 && <Silhouette cls="green" />}
                {no >= 0 && <Silhouette cls="red" />}
                {idle && <Silhouette cls="grey" />}
                {yes >= 0 && (
                  <>
                    <div className="badge ok" style={{ animationDelay: `${String(yes * 0.2)}s` }}><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg></div>
                    {SPARKS.map(([sx, sy], k) => (
                      <i key={k} className="spark" style={{ ['--sx' as string]: `${String(sx)}px`, ['--sy' as string]: `${String(sy)}px`, left: 34 + k * 3, top: 30, animationDelay: `${String(yes * 0.25 + k * 0.08)}s` }} />
                    ))}
                    <div className="note" style={{ animationDelay: `${String(yes * 0.3)}s` }} />
                    <div className="note" style={{ left: 44, animationDelay: `${String(yes * 0.3 + 0.35)}s` }} />
                    <div className="cash" style={{ animationDelay: `${String(yes * 0.3)}s` }}>
                      <svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><circle cx="12" cy="12" r="2.8" /></svg>+
                    </div>
                  </>
                )}
                {no >= 0 && <div className="badge x"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></div>}
              </div>
              <div className="msg" style={{ left: CRM.x, top: CRM.y, ['--dx' as string]: `${String(dx)}px`, ['--dy' as string]: `${String(dy)}px`, animationDelay: `${String(i * 0.22)}s` }}>
                <i /><i /><i />
              </div>
              {yes >= 0 && (
                <>
                  <div className="reply yes" style={{ left: x + 12, top: y + 30, ['--dx' as string]: `${String(x + 42 - CRM.x - 12)}px`, ['--dy' as string]: `${String(y + 46 - CRM.y - 30)}px`, animationDelay: `${String(yes * 0.2)}s` }}>I&apos;m interested!</div>
                  <div className="doc" style={{ left: CRM.x, top: CRM.y, ['--dx' as string]: `${String(dx - 6)}px`, ['--dy' as string]: `${String(dy - 10)}px`, animationDelay: `${String(yes * 0.25)}s` }}><Clipboard /></div>
                </>
              )}
              {no >= 0 && (
                <div className="reply no" style={{ left: x + 14, top: y + 30, ['--dx' as string]: `${String(x + 42 - CRM.x - 14)}px`, ['--dy' as string]: `${String(y + 46 - CRM.y - 30)}px`, animationDelay: `${String(no * 0.25)}s` }}>No thanks</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
