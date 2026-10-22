// A stand-in AI provider for trying the AI settings tab without a real key: `GET /v1/models` lists 63 models and the chat endpoint answers
// "OK". The key it accepts is `stub-key`. Run it, then start the API with LLM_ALLOW_PRIVATE_BASE_URL=true (a private address is refused otherwise):
//   node tests/fixtures/llm-stub-provider.mjs &
//   LLM_ALLOW_PRIVATE_BASE_URL=true LLM_ENV_FILE=/tmp/llm-demo.env npm run dev
//   E2E_LLM_STUB=1 npx playwright test tests/e2e/ai-settings-picker.spec.ts
import { createServer } from 'node:http';
const names = ['gemini-3.1-flash-lite', 'gemini-3.1-pro', 'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-embedding', 'antigravity-preview-05-2026', 'antigravity-preview-latest', 'aqa', 'deep-research-max-preview-04-2026', 'gemma-3-27b-it', 'imagen-4', 'learnlm-2.0-flash'];
const data = Array.from({ length: 63 }, (_, i) => ({ id: i < names.length ? names[i] : `model-${String(i)}-preview`, name: i < 6 ? `Display name ${String(i)}` : undefined, context_length: i % 3 === 0 ? 1048576 : i % 3 === 1 ? 128000 : undefined }));
createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== 'Bearer stub-key') { res.writeHead(401).end('{}'); return; }
  if (req.url === '/v1/models') { res.end(JSON.stringify({ data })); return; }
  res.end(JSON.stringify({ model: 'gemini-3.1-flash-lite', usage: {}, choices: [{ message: { content: 'OK', tool_calls: [] } }] }));
}).listen(4545, '127.0.0.1');
