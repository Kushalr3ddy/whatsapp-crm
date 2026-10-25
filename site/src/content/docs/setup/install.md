---
title: Install with Docker
description: Run the whole CRM, the web app, the API, the WhatsApp gateway and the database, with one command.
---

The CRM ships as one Docker image that runs the web app, the API and the WhatsApp gateway as three supervised processes, plus a second container for Postgres. You do not install Node or a database yourself.

## What you need

| | Minimum | Better |
|---|---|---|
| Memory | **2 GB** (add 1 to 2 GB of swap) | 4 GB, if you link several numbers and build on the same machine |
| Disk | 20 GB | more, for media and logs |
| Software | Docker, and Git to fetch the code | |

Each linked WhatsApp number adds roughly 30 to 60 MB. Building the image on the same machine briefly needs about 1 to 1.5 GB and a lot of CPU, so on a small server build elsewhere or be patient.

## Start it

1. Get the code and go into the folder.
2. Start everything:

   ```bash
   npm run alpha:up
   ```

   If you do not have Node, run the same thing directly: `bash infra/scripts/compose.sh up -d --build`.
3. Read the first-run details once:

   ```bash
   npm run alpha:logs
   ```

   They show the first administrator email (default `admin@example.com`) and a generated password. They are also kept in `/app/state/first-admin.txt` inside the container.
4. Open `http://localhost:3001/login` and sign in.

On first start it generates its own secrets, creates the database, applies the migrations and creates one organisation with an admin. Migrations run again on every start.

## Ports

| Port | What |
|---|---|
| 3001 | The web app (sign in at `/login`) |
| 3000 | The API (`/health` and `/ready` for checks) |
| 5434 | Postgres, on the machine itself only. Change `POSTGRES_HOST_PORT` if something else uses it |

## Do these things on day one

:::caution
**Back up the generated secrets, apart from the database.** The file `/app/state/secrets.env` holds the encryption key. If you lose it you lose every linked WhatsApp number and every stored message, and nothing can bring them back. Your data lives in three Docker volumes (`pgdata`, `storage`, `state`); `docker compose down -v` deletes all three.
:::

- **Use HTTPS on a real server.** Sign-in cookies are marked `Secure` in production, which browsers accept on `http://localhost` but not on a plain-http address like `http://192.168.1.20`. Reach the app as `localhost` (an SSH tunnel works) or put a TLS proxy such as Caddy in front. The repository includes a Caddy example in `infra/compose/Caddyfile`.
- **Try one spare number first.** The gateway connects to WhatsApp from your server's address. WhatsApp can treat a cloud server address more suspiciously than a home one, so link one spare number and watch delivery for a day or two before real numbers.
- **Keep the server updated.** To update, pull the new code and run `npm run alpha:up` again. Migrations run on start.

## Stop and look at the logs

```bash
npm run alpha:down      # stop; your data is kept
npm run alpha:logs      # follow the logs
```

Every process writes one JSON line per event. Useful lines to search for: `decrypt-failure burst` (a number's encryption session looks broken, so link it again), `sender not connected`, and `unhandled error`.

## Next

[Settings](../environment/) · [Link a WhatsApp number](../link-a-number/)
