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

| Command                                                                | What it does                                                                                                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev` / `build` / `start`                                         | Next.js                                                                                                                                                       |
| `pnpm lint`                                                            | ESLint, zero warnings allowed                                                                                                                                 |
| `pnpm typecheck`                                                       | `tsc --noEmit`                                                                                                                                                |
| `pnpm test`                                                            | Vitest: money/GST, numbering, permissions, invoice status, dates, rate limiting, lead validation, stock logic, SMS, Xero, Google Calendar, route optimisation |
| `pnpm format`                                                          | Prettier                                                                                                                                                      |
| `pnpm db:migrate` / `db:deploy` / `db:seed` / `db:reset` / `db:studio` | Prisma                                                                                                                                                        |

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
- Use the same payload contract for every website enquiry form (contact, quote request, call-back, service booking) so all enquiries land in Leads consistently.
- `utm_*` and `gclid` are stored, and a `gclid` (or `utm_source=google` with `cpc`) marks the lead source as _Google Ads_ so the Lead sources report shows ad ROI.
- **Several websites?** Point every site's form at the same URL with the same key and send `site` with that website's name. The lead shows which site it came from on the Leads board and table. If `site` is left out and the form posts from the browser, the site's domain is taken from the request automatically.
- Leave a hidden `website` field empty in your form: bots fill it in and are silently ignored.
- Limited to 10 requests per minute per IP. To post straight from the browser, list your site in `LEAD_WEBHOOK_ALLOWED_ORIGINS` (comma separated). Posting from your server (a WordPress / Webflow form handler) keeps the key private and is better.

## Inventory and van stock

Stock of common parts (capacitors, filters, refrigerant in kg, drain pumps, isolators, brackets…) is tracked per location: the **warehouse** plus **one van per technician**. Vans are created automatically for every active technician (and deactivated, not deleted, when someone leaves).

- **Inventory** (Admin menu) shows stock by location with filters, a **Low stock** view (total across all locations below the item's reorder level, with a suggested order quantity) and the **Movements** history. **Export CSV** downloads stock levels (all locations or the one you've picked).
- Every change is a row in the stock ledger (`StockMovement`: received, transfer, adjustment, used on job, returned from job) written in the same database transaction as the stock level, so quantities are always explained by the history. Logic lives in `src/lib/inventory.ts` (tested) and `src/server/inventory/service.ts`.
- **Parts used on jobs are deducted automatically.** When a tracked price book part is added under _Labour & parts_ (office job page) or _Parts & labour used_ (technician My jobs), it comes out of the van of the technician adding it, else the first assigned technician's van, else the warehouse. Removing the line puts it back where it came from. Lines copied from an accepted quote are not deducted until the office clicks **Take from stock** on the line. Stock may go negative; it's flagged in red everywhere and the office should recount or restock.
- **Receive stock** records a supplier delivery (supplier, docket number, items, quantities, cost) into the warehouse or a van, and can update the price book cost price (admin).
- **Low stock alert**: when an item's total first drops below its reorder level, admin and office get a notification, and the dashboard shows a _Low stock_ tile.
- **Suppliers** (Admin menu): add, edit, deactivate.
- Permissions: technicians see only their own van (read-only, _My jobs → My van stock_); office can view, receive, transfer and adjust stock and manage suppliers; only admin sees costs and stock value, and can stop tracking items or delete suppliers.

No environment variables are needed.

## SMS texts

Clients get texts from the business (each one can be switched off and reworded under **Settings → SMS**, admin only):

| Text                       | When                                                                         | Default |
| -------------------------- | ---------------------------------------------------------------------------- | ------- |
| On my way                  | A technician taps **On my way** (tech first name + business name)            | On      |
| Appointment reminder       | Daily reminder run, for every _Scheduled_ job tomorrow (once per job + date) | On      |
| Service due                | Daily run, plans due within 14 days, alongside the email (once per due date) | On      |
| Overdue invoice            | Daily run, at 1, 7 and 14 days overdue, alongside the email                  | Off     |
| One-off (office and admin) | **SMS** button on a client or job page: template picker, live count, send    |         |

- Templates use the same `{{placeholder}}` style as email templates; the editor shows a live preview with the character and SMS-segment count (160 characters per SMS, 70 if it contains emoji). Curly quotes and dashes are converted to plain ones before sending so they don't double the cost.
- Numbers are normalised to E.164 (`0412 345 678` → `+61412345678`). The client's phone, then alt. phone, then their primary contact's phone is tried; landlines, 13/1300/1800 and invalid numbers are skipped with the reason recorded.
- **No SMS** on a client (Edit client) stops every text to them. _Do not service_ clients get no appointment or service-due texts (same as the emails); on-my-way, overdue and one-off texts still work.
- Every text (sent, logged, skipped or failed) is stored in `SmsMessage` with the provider message id or error, and shows on the job / invoice / client timeline. Admins see everything under **Settings → SMS log**. Dedupe for the cron texts uses the `Reminder` table (channel `SMS`) like the email reminders.
- Code: `src/lib/sms` (phone normalisation, segment counting, templates, Twilio / MessageMedia request building; all unit-tested with a mocked `fetch`), `src/server/sms` (sending + logging, actions, queries).

| Variable                                           | What                                                                                                                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SMS_PROVIDER`                                     | `messagemedia` or `twilio`. Empty: texts are logged (status _Logged only_) and printed to the server console, never sent.                                                         |
| `MESSAGEMEDIA_API_KEY` / `MESSAGEMEDIA_API_SECRET` | MessageMedia REST API basic-auth key (MessageMedia Hub → Settings → API settings).                                                                                                |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN`         | Twilio Console → Account info.                                                                                                                                                    |
| `SMS_FROM`                                         | Sender: a number (`+614…`), an alphanumeric sender ID (max 11 chars, no replies) or, for Twilio, a Messaging Service SID (`MG…`). Required for Twilio, optional for MessageMedia. |
| `TWILIO_MESSAGING_SERVICE_SID`                     | Optional alternative to `SMS_FROM` for Twilio.                                                                                                                                    |

If the provider is chosen but a credential is missing, the app falls back to logging and the Integrations page says which variable is missing. The real Twilio / MessageMedia APIs were not called during development (no credentials); request building and response parsing are covered by tests.

## Xero (live sync)

One-way sync **CoolOps → Xero** over the Xero Accounting API (OAuth 2.0). Nothing comes back from Xero, so keep making changes in CoolOps.

| CoolOps                       | Xero                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client                        | Contact. Linked by stored ContactID, else matched by email, then name, else created (CoolOps client id in the read-only _Contact number_ field). Edits to a linked client are pushed. |
| Invoice sent / marked as sent | ACCREC invoice: number = CoolOps number, reference = job number, dates, due date, lines with quantity, unit price ex GST, account code and tax type.                                  |
| Invoice edited after sending  | The Xero invoice is updated (not once Xero has payments or credits on it).                                                                                                            |
| Invoice voided                | Voided in Xero (deleted if it's still a Xero draft). Never pushed → nothing to do.                                                                                                    |
| Credit note                   | ACCRECCREDIT credit note, allocated to the invoice (up to what the invoice still owes in Xero).                                                                                       |
| Payment                       | Payment against the invoice into the chosen bank account.                                                                                                                             |
| Refund (negative payment)     | Money paid out against a credit note on that invoice (Xero has no negative invoice payments). Issue the credit note first.                                                            |
| Payment removed               | The Xero payment is deleted.                                                                                                                                                          |

- **GST to the cent.** CoolOps calculates GST once on the taxable subtotal; Xero works per line. Each line is sent with an explicit `LineAmount` and `TaxAmount`, with the invoice's GST spread over the taxable lines so Xero's totals match CoolOps exactly. GST-free lines use the GST-free tax rate. Not GST registered → every line is GST free.
- **Outbox queue.** Every change writes a row to `XeroSyncJob` in the same database transaction. With _Sync automatically_ on, the queue is processed straight after the action responds (Next.js `after()`, non-blocking), and the daily cron catches up. With it off, only **Sync now** sends. Jobs run oldest first, one at a time (Xero allows 60 calls a minute). Failures retry after 1 min, 5 min, 30 min, 2 h, 6 h, then stop (6 attempts). Validation errors (e.g. a wrong account code) fail straight away. A 429 waits for Xero's `Retry-After` and doesn't use up an attempt. A dead token pauses the queue for 15 minutes.
- **No duplicates.** Xero IDs are stored on clients, invoices, credit notes and payments (`xeroContactId`, `xeroInvoiceId`, …) with a per-record sync status and error. Before creating an invoice or credit note it is looked up by number in Xero, and every create is sent with an `Idempotency-Key`.
- **Where to see it.** Invoice page: a _Xero_ card ("Xero: failed — reason" with **Retry**, or "Synced · Open in Xero", or **Push to Xero** for invoices sent before Xero was connected), plus "In Xero" / "Xero: failed" next to each payment and credit note. Admins: **Settings → Xero sync log** (filter, Retry, Retry all failed, Sync now) and the Integrations card (organisation, last sync, waiting / failed counts, Connect / Sync now / Settings / Disconnect).
- **Mapping** (**Settings → Xero**, admin): sales account (default 200), tax rate for GST lines (`OUTPUT`) and GST-free lines (`EXEMPTOUTPUT`), bank account for payments (picked from Xero's bank accounts), invoices sent as _Approved_ (default) or _Draft_, automatic or manual sync. Payments and allocations only work on approved invoices.
- **Tokens** (access + refresh) are encrypted at rest with AES-256-GCM using a key derived from `AUTH_SECRET` (HKDF), refreshed automatically (and by the daily cron so the 60-day refresh token never lapses). **Disconnect** revokes them at Xero and deletes them. Records keep their Xero links, so reconnecting the same organisation carries on; switching to a different organisation clears them.
- Permissions: admins connect, change settings and see the log; office staff see an invoice's Xero status and can click Retry; technicians see nothing.
- Code: `src/lib/xero` (OAuth URLs and token requests, API client with 401 refresh / 429 handling / throttle, payload builders, retry policy, token encryption; all unit-tested with a mocked `fetch`), `src/server/xero` (connection, queue triggers, sync worker, actions, queries), `src/app/api/integrations/xero/{connect,callback}`.

| Variable                                | What                                                                                                                                                             |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET` | From your app at developer.xero.com → My Apps (type _Web app_). Redirect URI: `{APP_URL}/api/integrations/xero/callback`. Empty: the card says _Not set up_.     |
| `XERO_SCOPES`                           | Optional. Default `offline_access accounting.transactions accounting.contacts accounting.settings.read`. Change only if Xero asks your app for different scopes. |
| `XERO_API_URL` / `XERO_IDENTITY_URL`    | Testing only: point the API / token calls at a mock server.                                                                                                      |

**MYOB** has no live sync: use the CSV export (**Integrations → Accounting export (CSV)**, `/api/export/xero`) and import it into MYOB. The CSV keeps working for Xero too.

The real Xero API was not called during development (no Xero app or organisation). Payload building, OAuth requests, token encryption and the retry rules are unit-tested; the full flow (connect, contacts, invoices, voids, credit notes with allocation, payments, payment deletion, 429 handling, validation errors) was clicked through in the browser against a local mock of the Xero endpoints. Try it against the Xero Demo Company before going live.

## Route optimisation

Plan each technician's day so they drive less: **Schedule → Plan route** (office and admin).

- **Where everything is.** Every site (`Property`) has a latitude/longitude. New and edited addresses are located in the background after saving (Next.js `after()`, never blocking the form); the daily cron and the admin button **Geocode missing addresses** (Integrations card, or **Settings → Routes**) catch up on anything missing. With `GOOGLE_MAPS_API_KEY` the Google Geocoding API is used (`region=au`, `components=country:AU`); if Google can't find the street, or without a key, the address is placed at the centre of its suburb from a built-in list of ~100 Melbourne suburbs (marked _approximate_). How each address was located is stored (`geocodeSource`: Google / suburb centre / demo).
- **Start and end point.** The business address (**Settings → Business**) is the depot, located the same way whenever it changes. A technician who takes the van home can **Start from home** (Team → the person → _Route start_, office or admin). **Settings → Routes**: the time technicians leave (default 07:00).
- **The plan.** Pick a technician and a day (the button uses the day shown in Day view). Their jobs that day are ordered for the least driving plus idle waiting, starting at the day start time, adding each job's booked length (else its estimate, else 2 h) and the drive between stops, rounding start times up to 5 minutes. Jobs that are **Emergency**, marked **Time fixed** (new switch in the job form, shown as a badge and a lock on the Schedule board), already under way / completed / on hold, or shared with another technician keep their time; the rest are re-sequenced around them. A fixed job that can't be reached in time is flagged. Up to 8 stops every order is checked (exact branch-and-bound search); above that nearest neighbour plus 2-opt / relocate improvement. The plan is never worse than the booked order.
- **Drive times.** With the key: Google Routes API `computeRouteMatrix` (traffic-aware at the departure time when the day is still ahead; one request per plan, up to 25 places). Without a key, or if Google fails: straight-line distance × 1.3 at 40 km/h, and the page says clearly that it's an estimate.
- **The page** shows driving now vs with the plan (minutes, km) and the saving, a map with numbered stops and the route (Google Static Maps image fetched through `/api/routes/static-map` so the key stays on the server; without a key a plain SVG plot scaled from the coordinates, no outside map tiles), and each stop's current vs proposed time and drive.
- **Apply new times** moves every changed job in one transaction through the same reschedule logic as drag-and-drop on the Schedule board (job timeline entry, audit log, Google Calendar update), notifies the technician, and stores the old times in `RoutePlan`. **Undo** puts them back (jobs moved again since are left alone). The apply is refused if a job moved after the plan was made.
- **Open in Google Maps**: a normal Google Maps directions link with the stops in order as waypoints, from and back to the depot / home (no API key needed; split into several links after 9 waypoints). Technicians see it on **My jobs** for today (from the depot before the day starts, else from where the phone is) and for their next few working days. Technicians can't open the planner.
- Code: `src/lib/routes` (haversine and estimates, solver, day planning, Google request building / parsing, Maps URLs, suburb centres; all unit-tested, Google with a mocked `fetch`), `src/server/routes` (geocoding, planning, actions, queries), `src/app/(app)/schedule/route`.

| Variable                                                                | What                                                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_MAPS_API_KEY`                                                   | A server API key from console.cloud.google.com with the **Geocoding API**, **Routes API** and **Maps Static API** enabled (restrict the key to those APIs). Empty: no Google calls at all; suburb-centre locations and straight-line estimates instead. |
| `GOOGLE_GEOCODING_URL` / `GOOGLE_ROUTES_URL` / `GOOGLE_STATIC_MAPS_URL` | Testing only: point the calls at a mock server.                                                                                                                                                                                                         |

The demo seed gives every site real Melbourne suburb coordinates (nudged per street), the depot in Braeside, and books Jack Wilson's next free weekday as a criss-cross of six jobs (one _Time fixed_ at 1 pm), so the planner works out of the box without a key. The Google APIs were **not** called during development (no key in the sandbox): request building and response parsing are unit-tested with a mocked `fetch`; everything else was clicked through in the browser in estimate mode.

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
4. expires quotes past their valid-until date,
5. texts (SMS) clients with a job scheduled tomorrow, clients whose plan is due within 14 days, and, if switched on, overdue invoices (see SMS texts below),
6. refreshes the Xero connection and, with automatic sync on, sends anything still waiting to Xero (see Xero above),
7. checks everyone's connected Google Calendar for the next 60 days and retries waiting calendar updates (see Google Calendar below),
8. locates site addresses that aren't on the map yet, for route planning (see Route optimisation below).

Every reminder is de-duplicated, so running it twice does nothing extra. On Coolify it runs as a scheduled task (see Deploy below); `pnpm cron:reminders` calls the endpoint from inside the app container.

Without `RESEND_API_KEY`, emails are printed to the server log instead of sent, so you can try everything locally.

## Deploy on Coolify

Coolify builds and runs the container itself with Nixpacks, so the repo has no Dockerfile or docker-compose. `nixpacks.toml` pins Node 22. `pnpm start` runs `prisma migrate deploy` before starting, and `pnpm db:seed` does too, so the database tables are always created and up to date.

1. **Database.** In your Coolify project, add a new resource: _PostgreSQL 16_. Start it and copy its internal connection URL (it looks like `postgres://postgres:...@<id>:5432/postgres`).
2. **App.** Add a new resource from your Git repo, build pack **Nixpacks**, port **3000**. Coolify reads the build and start commands from `package.json` and `nixpacks.toml`, so leave them empty.
3. **Environment variables** (from `.env.example`):
   - `DATABASE_URL`: the internal URL from step 1.
   - `AUTH_SECRET`: `openssl rand -base64 32`.
   - `AUTH_URL` and `APP_URL`: your domain, e.g. `https://app.coolingservicemelbourne.com.au`.
   - `RESEND_API_KEY` and `EMAIL_FROM` (a domain verified in Resend).
   - `LEAD_WEBHOOK_SECRET` and `CRON_SECRET`: long random strings.
   - Optional SMS: `SMS_PROVIDER` plus the provider's keys and `SMS_FROM` (see SMS texts above).
   - Optional Xero: `XERO_CLIENT_ID` and `XERO_CLIENT_SECRET` (see Xero above), then **Integrations → Connect to Xero**.
   - Optional Google Maps: `GOOGLE_MAPS_API_KEY` for real drive times in route planning (see Route optimisation below).
   - Optional Google Calendar: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (see Google Calendar below); each person then connects from **My account**.
   - `TZ=Australia/Melbourne` is optional; the app always uses Melbourne time anyway.
4. **File uploads** (job photos, signatures, logo). Easiest: keep `STORAGE_DRIVER=local`, set `STORAGE_LOCAL_DIR=/app/uploads`, and in the app's _Storages_ tab add a persistent volume mounted at `/app/uploads` so files survive redeploys. Or use `STORAGE_DRIVER=s3` with Cloudflare R2 / S3.
5. **Domain.** Set it under the app's _Domains_. Coolify issues the HTTPS certificate.
6. **Daily reminders.** In the app's _Scheduled Tasks_, add command `pnpm cron:reminders` with frequency `0 8 * * *`. Coolify runs schedules in the server's time zone, so set the server's timezone to `Australia/Melbourne` in Coolify (or use `0 21 * * *` in UTC, which is 8am during daylight saving and 7am in winter).
7. **Deploy.** Then load demo data once from the app's _Terminal_: `pnpm db:seed`. Or skip the seed for a clean start, but you need at least one admin user, so seeding and then editing the users is the quickest route. Fill in _Settings_ (ABN, bank details, logo, terms).

## Project layout

```
prisma/              schema (all phases), migrations, seed
src/app/(auth)       login
src/app/(app)        the staff app (dashboard, leads, clients, quotes, jobs, schedule, my-jobs, invoices, payments, maintenance, inventory, suppliers, reports, team, settings, audit log)
src/app/(public)     client-facing quote (/q/[token]) and invoice (/i/[token]) pages
src/app/api          auth, lead webhook, PDFs, report CSVs, Xero export + OAuth, Google Calendar OAuth, cron, file serving
src/server/<module>  queries.ts (reads) and actions.ts (server actions: Zod validation, permission check, transaction, audit log, activity)
src/lib              money, dates (Melbourne), numbering, permissions, invoice status, storage, email, SMS, Xero, Google Calendar, token encryption, outbox retry policy, PDF, validations (shared Zod schemas)
src/components       UI (shadcn), data tables, forms, feature components
src/emails           React Email templates
```

Permissions are enforced in four places: middleware (routes), `src/lib/permissions.ts` (`can()`), every server action, and the UI.

## Google Calendar sync

One way, **CoolOps → each person's own Google Calendar**. Everyone (technicians, office, admin) connects their own Google account; nothing comes back from Google, so keep scheduling in CoolOps.

- **What appears.** Every scheduled job you're assigned to becomes an event in your main Google calendar: title `J-0042 · Split system service · Client name` (a ✓ in front once the job is completed or invoiced, "On hold ·" while on hold), location = the site address, description = the job type, client phone(s), site address, priority (high / emergency), anyone else on the job, access / parking / pet / key notes, the job description and a link that opens the job in CoolOps (`/my-jobs/<id>` for technicians, `/jobs/<id>` for office and admin). Times are Melbourne (daylight saving included). **No prices or costs are ever sent.**
- **What keeps it in step.** Rescheduling (including drag and drop on the Schedule board), editing, reassigning (the event leaves the old technician's calendar and appears in the new one's), unscheduling, cancelling, completing and deleting a job all update or remove the event, as do changes to the client's phone or the site's address and access notes.
- **Outbox queue.** Each change writes a `GoogleCalendarTask` row in the same database transaction, which is processed straight after the action responds (Next.js `after()`, non-blocking). Failures retry after 1 min, 5 min, 30 min, 2 h, 6 h, then stop (6 attempts). Rate limits (429, or 403 `userRateLimitExceeded`) wait for Google's `Retry-After` without using up an attempt. An expired access token is refreshed automatically and the call retried; a dead refresh token marks the connection "needs reconnecting" and stops the retries. Events deleted in Google (404 / 410) are recreated.
- **No duplicates.** Each event id is derived from the user id and the job id, so a create that is retried after a timeout hits Google's 409 instead of making a second event, and the body is hashed so an unchanged job costs no API call.
- **Resync my calendar** (_My account_) re-sends the next 60 days, which also repairs events someone edited or deleted in Google. The daily cron does the same check for everyone connected.
- **Where to see it.** _My account_ → Google Calendar (connect, which Google account, how many upcoming jobs, last update, any error, Resync, Reconnect, Disconnect). Admins: the Integrations card lists who has connected, their Google account, counts and errors, with **Retry failed**; the Team page shows a _Calendar connected_ badge per person.
- **Tokens** (access + refresh) are encrypted at rest with AES-256-GCM using a key derived from `AUTH_SECRET` (HKDF; shared helper `src/lib/crypto.ts`, one key context per integration). **Disconnect** removes the user's upcoming CoolOps events from their calendar (past ones stay), revokes the grant at Google and deletes the tokens.
- Code: `src/lib/google-calendar` (OAuth URLs and token requests, API client with 401 refresh / rate-limit handling, event payloads and the create/update/delete diff; all unit-tested with a mocked `fetch`), `src/server/google-calendar` (connection, outbox triggers, sync worker, actions, queries), `src/app/api/integrations/google/{connect,callback}`, shared retry policy in `src/lib/outbox.ts`.

| Variable                                                                | What                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                             | From an OAuth client ID (type _Web application_) in Google Cloud console, with the Google Calendar API enabled. Redirect URI: `{APP_URL}/api/integrations/google/callback`. Empty: the card says _Not set up_ and nothing is sent. |
| `GOOGLE_AUTHORIZE_URL` / `GOOGLE_OAUTH_URL` / `GOOGLE_CALENDAR_API_URL` | Testing only: point the consent, token and API calls at a mock server.                                                                                                                                                             |

Scopes asked for: `openid`, `email` (to show which Google account is connected) and `https://www.googleapis.com/auth/calendar.events` (events only — CoolOps can't read the rest of the calendar). Google is asked for offline access with `prompt=consent`, so a refresh token comes back every time.

The real Google Calendar API was **not** called during development (no Google Cloud project). Event payloads (including Melbourne daylight saving), the create/update/delete diff, the OAuth URLs and the API client are unit-tested; connecting, event creation on scheduling, updates on drag-reschedule, the move on reassignment, deletion on cancel / unschedule, the 401 refresh, a rate limit, recreating an event deleted in Google, Resync and Disconnect were clicked through in the browser against a local mock of Google's endpoints.
