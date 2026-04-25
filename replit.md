# Freeform Mana

Sharded sandbox MMORPG (top-down, browser-based, permadeath). This repo is the
working implementation. Currently only the auth slice is built.

## Stack
- Node.js 20 + Express
- PostgreSQL (Replit-managed) accessed via `pg`
- `bcrypt` for password hashing, `express-session` + `connect-pg-simple` for sessions
- Vanilla HTML/CSS/JS client (PixiJS will be added when world rendering starts)

## Layout
- `server/index.js` — Express app, session middleware, static client, port 5000
- `server/db.js` — Postgres connection pool
- `server/auth.js` — `/api/auth/register`, `/login`, `/logout`, `/me`
- `client/` — static frontend (login + register UI, logged-in stub home)

## Database
Tables created via SQL (no ORM yet):
- `users(id, email, username, password_hash, created_at, last_login_at)`
- `session(sid, sess, expire)` — session store

## Run
- Workflow `Start application` runs `node server/index.js` on `0.0.0.0:5000`
- The preview pane is proxied to this port
- `SESSION_SECRET` is required in production; auto-generated in dev

## What's done
- Email/username + password registration with validation and bcrypt hashing
- Login (accepts email or username), logout, "who am I" endpoint
- Session cookies persisted in Postgres

## Next up (per design doc)
- Character creation (random race roll, gender, fixed 500 mana cap)
- Persist characters; permadeath flow (delete row on HP=0)
- WebSocket tick loop (20 Hz authoritative server) + PixiJS top-down client
