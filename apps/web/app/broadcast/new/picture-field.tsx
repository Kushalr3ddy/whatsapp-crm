'use client';

import { useRef, useState, useTransition } from 'react';
import type { CampaignPicture } from '@/lib/crm';
import { uploadPictureAction } from '../actions';

/** Same limits the server enforces, checked here first so a wrong file is turned away before it is sent. */
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * One optional picture or GIF for the campaign. The message becomes its caption. The file is uploaded as soon as it is chosen,
 * and the form carries only its id (`mediaAssetId`). The server re-checks everything from the file's bytes.
 */
export function PictureField({ earlier }: { earlier: CampaignPicture[] }) {
  const [picture, setPicture] = useState<CampaignPicture | null>(null);
  // Pictures from before, plus any uploaded during this visit, so removing one and picking it again works without reloading.
  const [pool, setPool] = useState<CampaignPicture[]>(earlier);
  const [error, setError] = useState<string | null>(null);
  const [showEarlier, setShowEarlier] = useState(false);
  const [over, setOver] = useState(false);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  /** Checks the file, then uploads it. */
  function take(file: File | undefined) {
    setError(null);
    if (file === undefined) return;
    if (file.type === 'video/mp4' || /\.mp4$/i.test(file.name)) { setError('MP4 videos are not supported yet. Use a picture or a GIF.'); return; }
    if (!TYPES.includes(file.type)) { setError('That file type is not supported. Use a JPG, PNG, WebP or GIF.'); return; }
    if (file.size > MAX_BYTES) { setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The most is 5 MB. Make it smaller and try again.`); return; }
    const body = new FormData();
    body.set('file', file);
    start(async () => {
      const result = await uploadPictureAction(body);
      if (!result.ok || result.picture === undefined) { setError(result.error ?? 'Could not upload it.'); return; }
      const uploaded = result.picture;
      setPool((list) => [uploaded, ...list.filter((p) => p.id !== uploaded.id)]);
      setPicture(uploaded); setShowEarlier(false);
    });
  }

  return (
    <div>
      <input type="hidden" name="mediaAssetId" value={picture?.id ?? ''} />
      {picture === null ? (
        <div
          className={`rounded-xl border-2 border-dashed p-5 text-center text-sm text-muted ${over ? 'border-accent bg-accent-soft' : 'border-border'}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => { setOver(false); }}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]); }}
        >
          <p>{pending ? 'Uploading…' : 'Drop a picture or GIF here, or'}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { input.current?.click(); }}>Choose a file</button>
            {pool.length > 0 && <button type="button" className="btn btn-sm" onClick={() => { setShowEarlier(!showEarlier); }}>Use one I uploaded before</button>}
          </div>
          <input
            ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" aria-label="Picture or GIF" className="hidden"
            onChange={(e) => { take(e.target.files?.[0]); e.target.value = ''; }}
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {/* A safe re-encoded preview from our own server, never the original file (see /media/[id]/thumb). */}
          <img src={`/media/${picture.id}/thumb`} alt="Preview of the picture" className="max-h-44 max-w-56 rounded-lg border border-border" />
          <div className="text-sm">
            <p className="font-medium">{picture.filename ?? 'picture'}</p>
            <p className="text-xs text-muted">{(picture.sizeBytes / 1048576).toFixed(2)} MB, {picture.gif ? 'GIF' : picture.contentType.replace('image/', '').toUpperCase()}</p>
            {picture.gif && <p className="notice notice-warning mt-2">A GIF is sent as a short looping clip. The preview shows its first frame.</p>}
            <button type="button" className="btn btn-sm mt-2" onClick={() => { setPicture(null); }}>Remove</button>
          </div>
        </div>
      )}
      {error !== null && <p role="alert" className="notice notice-danger mt-2">{error}</p>}
      {showEarlier && picture === null && (
        <div className="mt-3">
          <p className="text-xs text-muted">Pictures you used before</p>
          <ul className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {pool.map((p) => (
              <li key={p.id}>
                <button type="button" className="card w-full p-2 text-left text-xs" onClick={() => { setPicture(p); setShowEarlier(false); }}>
                  <img src={`/media/${p.id}/thumb`} alt="" className="h-20 w-full rounded object-cover" />
                  <span className="mt-1 block truncate font-medium">{p.filename ?? 'picture'}</span>
                  <span className="text-muted">used {p.uses} {p.uses === 1 ? 'time' : 'times'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
