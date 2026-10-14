# Alpha container

One image (`Dockerfile` at the repo root) runs the API, the gateway and the web UI as three
supervised processes; Postgres is a second container. Migrations run on every start.

```bash
cp infra/compose/alpha.env.example infra/compose/.env   # fill the blanks (openssl rand -hex 32)
npm run alpha:up                                         # build and start
docker compose -f infra/compose/compose.yaml exec app \
  node_modules/.bin/tsx scripts/admin.ts org --name "Acme" --slug acme --email you@example.com
```

| Port | What |
|---|---|
| 3001 | web UI (sign in at `/login`) |
| 3000 | API (`/health`, `/ready`) |
| 5434 | Postgres, host side only; change `POSTGRES_HOST_PORT` if the dev database holds it |

Things to know:

- **Back up `ENCRYPTION_KEY` apart from the database.** Data lives in the `pgdata` and `storage`
  volumes; `docker compose down -v` deletes both.
- **Sign-in cookies are `Secure` in production mode.** Browsers accept that on
  `http://localhost`, but not on a plain-http LAN address. Reach it by `localhost` (an SSH tunnel
  works) or put TLS in front before using an IP.
- **The gateway connects out to WhatsApp from this host's IP.** Run the 72-hour spare-number test
  (`docs/29`) before trusting a datacenter address.
- If any one process dies the container exits and `restart: unless-stopped` brings it back.
