# CoolOps

Job management for **Cooling Service Melbourne**: leads → quotes → jobs → invoices → payments, plus scheduling, a technician mobile view, maintenance plans and reports. Built for Australian rules: AUD in integer cents, 10% GST, valid tax invoices, Melbourne time everywhere.

**Stack:** Next.js 15 (App Router, TypeScript strict) · PostgreSQL + Prisma · Auth.js v5 · Tailwind v4 + shadcn/ui · TanStack Table · FullCalendar · dnd-kit · Recharts · React PDF · Resend + React Email · Vitest.

## Run it locally

You need Node 20+, pnpm and a PostgreSQL 16 database. Either install Postgres on your computer (Postgres.app on Mac, the EDB installer on Windows, `apt install postgresql` on Linux) or point `DATABASE_URL` at a Postgres you created in Coolify.

```bash
pnpm install
cp .env.example .env          # set DATABASE_URL and AUTH_SECRET (openssl rand -base64 32)
pnpm prisma migrate dev       # create the schema
pnpm db:seed                  # realistic demo data (safe to re-run: it resets the data)
pnpm dev                      # http://localhost:3000
```

### Demo logins

All seeded users have the password **`ChangeMe123!`**. Change it under _My account_ (or delete the users) before going live.

| Email                | Name        | Role                                                                                               |
| -------------------- | ----------- | -------------------------------------------------------------------------------------------------- |
| admin@coolops.local  | Alex Morgan | Admin: everything, including costs, margins, users and settings                                    |
| office@coolops.local | Priya Shah  | Office: leads, clients, quotes, jobs, schedule, invoices, payments, reports (no costs or settings) |
| tech1@coolops.local  | Jack Wilson | Technician: My Jobs only, no prices                                                                |
| tech2@coolops.local  | Liam Chen   | Technician (gas fitter)                                                                            |

Technicians land on **My Jobs**, a phone-first view with big _On my way / Start / Complete_ buttons, checklist, photos, parts used, notes and customer signature.

## Scripts

| Command                                                                | What it does                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `pnpm dev` / `build` / `start`                                         | Next.js                                                                                          |
| `pnpm lint`                                                            | ESLint, zero warnings allowed                                                                    |
| `pnpm typecheck`                                                       | `tsc --noEmit`                                                                                   |
| `pnpm test`                                                            | Vitest: money/GST, numbering, permissions, invoice status, dates, rate limiting, lead validation |
| `pnpm format`                                                          | Prettier                                                                                         |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:reset` / `db:studio` | Prisma                                                                                           |

## Website enquiry form → leads

The contact form on your website posts to the lead webhook. Leads appear on the Leads board immediately, the office gets a notification and an email, and a repeat enquiry from the same email or phone within 24 hours is added to the existing lead instead of creating a duplicate.

```bash
curl -X POST http://localhost:3000/api/leads/webhook \
  -H "Content-Type: application/json" \
  -H "x-api-key: $LEAD_WEBHOOK_SECRET" \
  -d '{
    "name": "Jane Citizen",
    "email": "jane@example.com",
    "phone": "0412 345 678",
    "suburb": "Brunswick",
    "postcode": "3056",
    "service": "Split system service",
    "brand": "Daikin",
    "message": "Two units, one is making a rattling noise.",
    "utm_source": "google",
    "utm_medium": "cpc",
    "utm_campaign": "aircon-service",
    "gclid": "abc123",
    "site": "coolingservicemelbourne.com.au"
  }'
```

- `name` and one of `email` / `phone` are required. Everything else is optional.
- `utm_*` and `gclid` are stored, and a `gclid` (or `utm_source=google` with `cpc`) marks the lead source as _Google Ads_ so the Lead sources report shows ad ROI.
- **Several websites?** Point every site's form at the same URL with the same key and send `site` with that website's name. The lead shows which site it came from on the Leads board and table. If `site` is left out and the form posts from the browser, the site's domain is taken from the request automatically.
- Leave a hidden `website` field empty in your form: bots fill it in and are silently ignored.
- Limited to 10 requests per minute per IP. To post straight from the browser, list your site in `LEAD_WEBHOOK_ALLOWED_ORIGINS` (comma separated). Posting from your server (a WordPress / Webflow form handler) keeps the key private and is better.

## How the money works

- All amounts are integer cents. GST is 10%, applied per line (each line can be GST-free) and calculated once on the taxable subtotal so rounding never drifts. Logic lives in `src/lib/money.ts` with tests.
- Quotes, jobs, invoices and credit notes are numbered `Q-0001`, `J-0001`, `INV-0001`, `CN-0001` from a counter inside the same transaction. Prefixes and the next number (e.g. to continue from your old system) are in _Settings → Numbering_.
- Invoice status is derived from money and dates: Draft → Sent → Partially paid / Overdue → Paid, or Void. Credit notes reduce the balance. Jobs can be invoiced in full, or with deposit / progress claims that the final invoice deducts automatically.
- Tax invoice PDFs include the words "Tax Invoice", your ABN, the client (and their ABN), each line, GST and your bank details. Clients get a private link (`/i/<token>`) to view and download it; quotes have the same (`/q/<token>`) with online accept / decline.

## Daily reminders (cron)

`GET /api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`. It:

1. marks invoices overdue and emails reminders at 1, 7 and 14 days overdue (each once),
2. emails clients whose maintenance plan is due within 14 days and tells the office,
3. warns about technician licences (ARC, gas, electrical…) and equipment warranties expiring within 30 days,
4. expires quotes past their valid-until date.

Every reminder is de-duplicated, so running it twice does nothing extra. On Coolify it runs as a scheduled task (see Deploy below); `pnpm cron:reminders` calls the endpoint from inside the app container.

Without `RESEND_API_KEY`, emails are printed to the server log instead of sent, so you can try everything locally.

## Deploy on Coolify

Coolify builds and runs the container itself with Nixpacks, so the repo has no Dockerfile or docker-compose. `nixpacks.toml` pins Node 22 and makes the app run `prisma migrate deploy` on every start, so the database schema is always up to date.

1. **Database.** In your Coolify project, add a new resource: _PostgreSQL 16_. Start it and copy its internal connection URL (it looks like `postgres://postgres:...@<id>:5432/postgres`).
2. **App.** Add a new resource from your Git repo, build pack **Nixpacks**, port **3000**. Coolify reads the build and start commands from `package.json` and `nixpacks.toml`, so leave them empty.
3. **Environment variables** (from `.env.example`):
   - `DATABASE_URL`: the internal URL from step 1.
   - `AUTH_SECRET`: `openssl rand -base64 32`.
   - `AUTH_URL` and `APP_URL`: your domain, e.g. `https://app.coolingservicemelbourne.com.au`.
   - `RESEND_API_KEY` and `EMAIL_FROM` (a domain verified in Resend).
   - `LEAD_WEBHOOK_SECRET` and `CRON_SECRET`: long random strings.
   - `TZ=Australia/Melbourne` is optional; the app always uses Melbourne time anyway.
4. **File uploads** (job photos, signatures, logo). Easiest: keep `STORAGE_DRIVER=local`, set `STORAGE_LOCAL_DIR=/app/uploads`, and in the app's _Storages_ tab add a persistent volume mounted at `/app/uploads` so files survive redeploys. Or use `STORAGE_DRIVER=s3` with Cloudflare R2 / S3.
5. **Domain.** Set it under the app's _Domains_. Coolify issues the HTTPS certificate.
6. **Daily reminders.** In the app's _Scheduled Tasks_, add command `pnpm cron:reminders` with frequency `0 8 * * *`. Coolify runs schedules in the server's time zone, so set the server's timezone to `Australia/Melbourne` in Coolify (or use `0 21 * * *` in UTC, which is 8am during daylight saving and 7am in winter).
7. **Deploy.** Then load demo data once from the app's _Terminal_: `pnpm db:seed`. Or skip the seed for a clean start, but you need at least one admin user, so seeding and then editing the users is the quickest route. Fill in _Settings_ (ABN, bank details, logo, terms).

## Project layout

```
prisma/              schema (all phases), migrations, seed
src/app/(auth)       login
src/app/(app)        the staff app (dashboard, leads, clients, quotes, jobs, schedule, my-jobs, invoices, payments, maintenance, reports, team, settings, audit log)
src/app/(public)     client-facing quote (/q/[token]) and invoice (/i/[token]) pages
src/app/api          auth, lead webhook, PDFs, report CSVs, Xero export, cron, Stripe webhook (Phase 2), file serving
src/server/<module>  queries.ts (reads) and actions.ts (server actions: Zod validation, permission check, transaction, audit log, activity)
src/lib              money, dates (Melbourne), numbering, permissions, invoice status, storage, email, PDF, validations (shared Zod schemas)
src/components       UI (shadcn), data tables, forms, feature components
src/emails           React Email templates
```

Permissions are enforced in four places: middleware (routes), `src/lib/permissions.ts` (`can()`), every server action, and the UI.

## Phase 2 / 3 (stubbed, not built yet)

The database schema already covers these; code entry points are marked `TODO(Phase 2)` / `TODO(Phase 3)` and listed on the in-app _Integrations_ page.

- **Stripe card payments**: "Pay now" on invoices and automatic payment recording. `src/lib/payments/stripe.ts`, `/api/stripe/webhook`.
- **SMS** (Twilio or MessageMedia): on-my-way and reminder texts. `src/lib/sms`.
- **Xero / MYOB sync**: a Xero import CSV works today (`/api/export/xero`); live API sync is Phase 3. `src/lib/integrations/accounting.ts`.
- **Inventory & van stock**: `Supplier` and `InventoryItem` tables exist.
- **Client portal**: clients currently use secure one-off links.
- **Google Calendar sync** for technicians. `src/lib/integrations/google-calendar.ts`.
