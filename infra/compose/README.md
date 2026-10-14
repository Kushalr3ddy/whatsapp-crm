# Alpha container

One image (`Dockerfile` at the repo root) runs the API, the gateway and the web UI as three
supervised processes; Postgres is a second container. Migrations run on every start.

```bash
npm run alpha:up        # build and start: that is all
npm run alpha:logs      # the first-run admin email and password are printed here, once
```

On first start it generates its secrets, creates the database, applies migrations and creates
one organisation with an admin (`ADMIN_EMAIL`, default `admin@example.com`). The same details
are kept in `/app/state/first-admin.txt` inside the container.

| Port | What |
|---|---|
| 3001 | web UI (sign in at `/login`) |
| 3000 | API (`/health`, `/ready`) |
| 5434 | Postgres, loopback only; change `POSTGRES_HOST_PORT` if the dev database holds it |

Things to know:

- **Back up the generated secrets apart from the database.** `/app/state/secrets.env` holds
  `ENCRYPTION_KEY`. Data lives in the `pgdata`, `storage` and `state` volumes; `docker compose
  down -v` deletes all three.
- **Sign-in cookies are `Secure` in production mode.** Browsers accept that on
  `http://localhost`, but not on a plain-http LAN address. Reach it by `localhost` (an SSH tunnel
  works) or put TLS in front before using an IP.
- **The gateway connects out to WhatsApp from this host's IP.** Run the 72-hour spare-number test
  (`docs/29`) before trusting a datacenter address.
- If any one process dies the container exits and `restart: unless-stopped` brings it back.
