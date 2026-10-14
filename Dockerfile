# The alpha monolith: API, gateway and web UI in ONE image, run by infra/docker/entrypoint.sh.
#
# One container is a deliberate alpha shortcut. They are still three separate processes (a
# restart of the API does not drop a WhatsApp socket; docs/04-architecture.md), only supervised
# together. Splitting them later means three entrypoints from this same image, not a rewrite.
#
# Build:  docker build -t whatsapp-crm .
# Run:    see infra/compose/compose.yaml
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# Dependencies first, so a source-only change reuses this layer. The full install (dev
# dependencies included) is on purpose: the API and gateway run TypeScript through tsx, as
# they do in development, rather than from a compiled dist/ that nothing builds yet.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY scripts ./scripts
COPY infra/docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# The UI is built into the image; it reads CRM_API_URL at request time, so nothing is baked in.
RUN npm --workspace @crm/web run build \
 && chmod +x /usr/local/bin/entrypoint.sh \
 && mkdir -p /app/storage /app/state && chown -R node:node /app

USER node
EXPOSE 3000 3001
VOLUME ["/app/storage", "/app/state"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
