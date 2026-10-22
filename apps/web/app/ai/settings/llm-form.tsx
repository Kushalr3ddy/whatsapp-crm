'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { LlmModel, LlmProbe, LlmSettings } from '@/lib/crm';
import { listModelsAction, removeLlmAction, saveLlmAction, testLlmAction } from '../actions';
import { ModelPicker } from './model-picker';

/** What to check for each kind of failure, in the order people usually find the cause. */
function checklist(kind: LlmProbe['problemKind'], providerLabel: string, custom: boolean): string[] {
  switch (kind) {
    case 'key': return [
      'The key was pasted whole, with no space or line break before or after it.',
      `It is a key for ${providerLabel}, not for another service.`,
      'The key is switched on in your account and is allowed to use this model.'
    ];
    case 'model': return [
      'The model name is spelled exactly as the provider lists it. Press Find models and pick it from the list.',
      'Your key is allowed to use that model (some need a paid plan or an approval).',
      ...(custom ? ['The address of the service is complete, usually ending in /v1.'] : [])
    ];
    case 'rate_limit': return ['Wait a minute and press Test it again.', `Your ${providerLabel} account still has credit or quota.`];
    case 'timeout': return ['Press Test it again; the provider may be busy.', 'Choose a smaller or faster model.'];
    case 'unreachable': return [
      ...(custom ? ['The address of the service is correct and starts with https://.'] : []),
      'This computer is online, and the provider is not having an outage.',
      ...(providerLabel.startsWith('Ollama') ? ['Ollama is running on this machine.'] : [])
    ];
    case 'response': return ['Choose a different model: this one answered in a form the app cannot use.'];
    case 'settings': return ['The provider, the key and the model are all filled in.'];
    default: return [];
  }
}

/**
 * Choose the provider, enter the key, pick a model, test it, and make it the one the install uses. The key is typed into a hidden box, sent
 * to the server and never shown again (only its last four characters). A blank key keeps the saved one for the same provider. "Use this" is
 * only offered after a passing test; a failing one can be used anyway, after saying so.
 */
export function LlmForm({ settings }: { settings: LlmSettings }) {
  const router = useRouter();
  const inUse = settings.provider !== null ? settings.providers.find((p) => p.id === settings.provider) : undefined;
  const [provider, setProvider] = useState(inUse?.id ?? '');
  const [baseUrl, setBaseUrl] = useState(inUse?.id === 'custom' ? settings.baseUrl ?? '' : '');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(inUse?.id === provider ? settings.model ?? '' : '');
  const [models, setModels] = useState<LlmModel[]>([]);
  const [probe, setProbe] = useState<LlmProbe | null>(null);
  const [probedFor, setProbedFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [failedStep, setFailedStep] = useState<'models' | 'test' | 'save'>('test');
  const [pending, start] = useTransition();

  const preset = settings.providers.find((p) => p.id === provider);
  const choice = { provider, ...(baseUrl !== '' ? { baseUrl } : {}), ...(apiKey !== '' ? { apiKey } : {}), ...(model !== '' ? { model } : {}) };
  const key = JSON.stringify([provider, baseUrl, apiKey, model]);
  const tested = probe !== null && probedFor === key;
  const sameAsSaved = provider === settings.provider && apiKey === '';
  const canKey = preset !== undefined && (!preset.needsKey || apiKey !== '' || (sameAsSaved && settings.keyLast4 !== null));

  /** Picks a provider and clears what belonged to the last one. */
  function pickProvider(id: string) {
    setProvider(id); setModels([]); setProbe(null); setError(null); setNotice(null); setApiKey('');
    setModel(id === settings.provider ? settings.model ?? '' : '');
    setBaseUrl(id === 'custom' && settings.provider === 'custom' ? settings.baseUrl ?? '' : '');
  }

  /** Asks the provider which models this key may use. */
  function findModels() {
    setError(null); setNotice(null);
    start(async () => {
      const r = await listModelsAction(choice);
      if (!r.ok || r.models === undefined) { setFailedStep('models'); setError(r.error ?? 'The provider did not answer.'); return; }
      setModels(r.models);
      if (r.models.length === 0) setNotice('The provider listed no models. Type a model name yourself.');
    });
  }

  /** Runs the two tiny test calls with the current choices. */
  function runTest() {
    setError(null); setNotice(null); setProbe(null);
    start(async () => {
      const r = await testLlmAction(choice);
      if (!r.ok || r.probe === undefined) { setFailedStep('test'); setError(r.error ?? 'The test did not run.'); return; }
      setProbe(r.probe); setProbedFor(key);
    });
  }

  /** Saves the choice: tested first by the server unless `anyway`. */
  function save(anyway: boolean) {
    setError(null); setNotice(null);
    start(async () => {
      const r = await saveLlmAction(choice, anyway);
      if (!r.ok) { setFailedStep('save'); setError(r.error ?? 'Something went wrong.'); return; }
      setApiKey(''); setModels([]); setProbe(null);
      setNotice(`Saved. The assistant uses ${preset?.label ?? provider}, model ${model}, from its next reply. No restart is needed.`);
      router.refresh();
    });
  }

  /** Turns the model off after a confirmation. */
  function turnOff() {
    setError(null); setNotice(null); setConfirmOff(false);
    start(async () => {
      const r = await removeLlmAction();
      if (!r.ok) { setError(r.error ?? 'Could not turn it off.'); return; }
      setProvider(''); setModel(''); setApiKey(''); setModels([]); setProbe(null);
      setNotice('The AI model is off and the key has been removed from the settings file.');
      router.refresh();
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-5">
      <section className="card p-5" aria-label="In use now">
        <h2 className="text-base font-semibold">In use now</h2>
        {settings.ready ? (
          <p className="mt-2 text-sm">
            <strong>{inUse?.label ?? settings.driver}</strong>, model <strong>{settings.model}</strong>
            {settings.keyLast4 !== null && <span className="text-muted"> · key ending {settings.keyLast4}</span>}
            <span className="block text-xs text-muted">
              Set {settings.source === 'file' ? 'from this page' : 'in the server’s environment (.env)'}. Changing it here applies from the next reply.
            </span>
          </p>
        ) : (
          <p className="notice notice-warning mt-2">No AI model is set up yet. Choose a provider below, enter its key, pick a model and test it.</p>
        )}
        {settings.ready && !confirmOff && <button type="button" className="btn btn-sm mt-3" onClick={() => { setConfirmOff(true); }}>Turn the AI model off</button>}
        {confirmOff && (
          <div className="notice notice-warning mt-3" role="alertdialog">
            Turning it off stops every AI reply, template and campaign wording until a model is set again, and removes the key from the settings file.
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn btn-sm btn-primary" disabled={pending} onClick={turnOff}>Yes, turn it off</button>
              <button type="button" className="btn btn-sm" onClick={() => { setConfirmOff(false); }}>Keep it</button>
            </div>
          </div>
        )}
      </section>

      <section className="card p-5" aria-label="Choose the AI">
        <h2 className="text-base font-semibold">Choose the AI</h2>

        <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
          1. Provider
          <select className="field font-normal" value={provider} onChange={(e) => { pickProvider(e.target.value); }}>
            <option value="" disabled>Choose a provider…</option>
            {settings.providers.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>

        {preset !== undefined && (
          <>
            {preset.id === 'custom' && (
              <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
                Address of the service
                <input className="field font-normal" placeholder="https://example.com/v1" value={baseUrl} onChange={(e) => { setBaseUrl(e.target.value); setProbe(null); }} />
                <span className="text-xs font-normal text-muted">Must start with https:// and be on the public internet.</span>
              </label>
            )}

            {preset.needsKey && (
              <label className="mt-3 flex flex-col gap-1 text-sm font-medium">
                2. API key
                <input
                  type="password" autoComplete="off" className="field font-normal" value={apiKey}
                  placeholder={sameAsSaved && settings.keyLast4 !== null ? `Saved, ending ${settings.keyLast4}. Leave blank to keep it.` : 'Paste the key'}
                  onChange={(e) => { setApiKey(e.target.value); setProbe(null); }}
                />
                <span className="text-xs font-normal text-muted">Get one: {preset.keyHelp}. It is stored in the server’s settings file and never shown again.</span>
              </label>
            )}
            {!preset.needsKey && <p className="mt-3 text-sm text-muted">{preset.keyHelp}.</p>}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button type="button" className="btn btn-sm" disabled={pending || !canKey || (preset.id === 'custom' && baseUrl === '')} onClick={findModels}>Find models</button>
              <span className="text-xs text-muted">Optional: lists what this provider offers. You can also type a model name.</span>
            </div>

            <div className="mt-3 flex flex-col gap-1">
              <label htmlFor="llm-model" className="text-sm font-medium">3. Model</label>
              <ModelPicker
                id="llm-model" value={model} models={models} recommended={preset.recommended}
                onChange={(next) => { setModel(next); setProbe(null); }}
              />
              {models.length > 0 && <span className="text-xs text-muted">{models.length} models found. Open the list, or start typing to narrow it.</span>}
              {preset.recommended !== null && model !== preset.recommended && (
                <button type="button" className="self-start text-xs underline" onClick={() => { setModel(preset.recommended ?? ''); setProbe(null); }}>
                  Use the model we tested: {preset.recommended}
                </button>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" className="btn" disabled={pending || !canKey || model === '' || (preset.id === 'custom' && baseUrl === '')} onClick={runTest}>
                {pending && probe === null ? 'Testing…' : '4. Test it'}
              </button>
              <button type="button" className="btn btn-primary" disabled={pending || !tested || !probe?.usable} onClick={() => { save(false); }}>Use this</button>
              <span className="text-xs text-muted">The test makes two tiny real calls (a fraction of a cent) and saves nothing.</span>
            </div>
          </>
        )}

        {probe !== null && probe.usable && (
          <div className="notice notice-success mt-3" role="status">
            It works. {probe.model} answered in {(probe.milliseconds / 1000).toFixed(1)} s{probe.toolCalling ? ' and can call functions.' : '.'}
            {probe.notes.map((n) => <span key={n} className="mt-1 block">{n}</span>)}
          </div>
        )}
        {probe !== null && !probe.usable && (
          <div className="notice notice-danger mt-3" role="alert">
            <strong>The test failed.</strong> {probe.problem}
            <p className="mt-2 text-sm font-medium">Please check:</p>
            <ul className="mt-1 list-disc pl-5 text-sm">
              {checklist(probe.problemKind, provider === 'custom' ? 'the service you entered' : preset?.label ?? 'the provider', provider === 'custom').map((c) => <li key={c}>{c}</li>)}
            </ul>
            <p className="mt-2 text-sm">Then press <em>Test it</em> again. Nothing has been changed.</p>
            <div className="mt-2">
              <button type="button" className="btn btn-sm" disabled={pending} onClick={() => { save(true); }}>Use it anyway</button>
              <span className="ml-2 text-xs text-muted">Not recommended: the assistant will not work until this is fixed.</span>
            </div>
          </div>
        )}
        {error !== null && (
          <div role="alert" className="notice notice-danger mt-3">
            <strong>{failedStep === 'models' ? 'Could not list the models.' : failedStep === 'test' ? 'Could not run the test.' : 'Could not save.'}</strong> {error}
            <p className="mt-1 text-sm">
              {failedStep === 'models'
                ? 'Check the key and, for Other, the address. You can still type a model name and press Test it.'
                : failedStep === 'test' ? 'Check the provider, the key, the model name and, for Other, the address, then try again. Nothing has been changed.'
                : 'Nothing was changed. Check the provider, key and model, press Test it, then Use this.'}
            </p>
          </div>
        )}
        {notice !== null && <p role="status" className="notice notice-success mt-3">{notice}</p>}
      </section>
    </div>
  );
}
