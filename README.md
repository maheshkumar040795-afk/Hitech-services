# Hitech Services — v2 (Supabase)

Office dashboard (web) + **HT Jobs** technician app (installable mobile web app, no APK) on **Supabase free plan**.
No server, no Docker, no Redis. **No npm needed to deploy or to check locally.**

```
hitech-services/
├── 1-Website/          ← ★ READY WEBSITE. Double-click index.html to check locally. Upload its contents to GitHub.
│   └── config.js          ← the only file you edit (Supabase URL + key)
├── 2-Supabase-Setup/
│   ├── schema.sql                     ← run once in Supabase SQL Editor (tables, security rules, functions)
│   └── functions/admin-users/index.ts ← Edge Function: creates logins (needs the secret key, so it runs on Supabase)
└── 3-Source-Code/      ← developers only (React, needs npm). Its index.html is NOT the website.
```

| Who | Where | Login with |
|---|---|---|
| Admin / Office staff | `https://htservice.in` (laptop/desktop) | email + password |
| Technician | `https://htservice.in/#/tech` (phone, installed as **HT Jobs**) | mobile number + PIN |

---

## 1. Create the Supabase project (10 min)

1. Go to **supabase.com** → New project → Region **South Asia (Mumbai)** → set a database password (save it).
2. **SQL Editor** → New query → paste all of `2-Supabase-Setup/schema.sql` → **Run**. (Safe to run again later.)
3. **Authentication → Sign In / Providers → Email**
   - Turn **OFF** "Allow new users to sign up" ← important; only the admin creates logins.
   - "Confirm email" can stay as is (logins are created already confirmed).

## 2. Deploy the Edge Function

**Edge Functions → Deploy a new function → Via Editor** → name it exactly **`admin-users`** → paste
`2-Supabase-Setup/functions/admin-users/index.ts` → **Deploy**. Keep *Verify JWT* **on**.

(Or with the CLI: `supabase functions deploy admin-users`.)

## 3. Create the first admin

1. **Authentication → Users → Add user → Create new user** → email `reyas@htservice.in`, a password, tick **Auto Confirm User**.
2. **SQL Editor** → run (change name/email):
```sql
insert into public.profiles (id, name, login, role)
select id, 'Reyas', email, 'ADMIN' from auth.users where email = 'reyas@htservice.in';
```
All other users (office staff, technicians) are created from inside the app.

## 4. Put your keys in `1-Website/config.js`

Open `1-Website/config.js` in Notepad / VS Code and fill:
```js
SUPABASE_URL: 'https://abcdefgh.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOi...   (or sb_publishable_...)',
```
Supabase → **Project Settings → API** → Project URL and the **anon / publishable** key.
This key is meant to be public (security is enforced by the database). **Never** put the `service_role` / secret key here.

## 5. Check locally (no npm)
Double-click **`1-Website/index.html`** → it opens in Chrome → office login.
Technician app locally: add `#/tech` to the end of the address bar (`…/index.html#/tech`).
(Install-to-home-screen only works once it's online on https — everything else works locally.)

## 6. Deploy on GitHub Pages (free)
1. GitHub → **New repository** (e.g. `hitech-services`, can be Private on paid plans; Public on free).
2. **Add file → Upload files** → drag in **everything inside the `1-Website` folder** (index.html, config.js, assets, icons, …
   including the hidden `.nojekyll` file) → Commit.
3. Repository **Settings → Pages** → Source: *Deploy from a branch* → Branch **main**, folder **/ (root)** → Save.
   After ~1 minute it's live at `https://<username>.github.io/hitech-services/`.
4. Custom domain: **Settings → Pages → Custom domain** = `htservice.in` → Save → tick **Enforce HTTPS** when available.
   At your domain registrar (GoDaddy) add the DNS records GitHub shows (4 × `A` records to GitHub Pages IPs, and `CNAME www → <username>.github.io`).
5. Later changes to keys: edit `config.js` directly on GitHub (pencil icon) → Commit. No rebuild.

Links to share:
- Office: `https://htservice.in`
- Technicians: `https://htservice.in/#/tech` (the Technicians page → *Reset PIN & share* fills this in automatically)

## (Only if the source code changes) Rebuild `1-Website/`
```bash
cd 3-Source-Code
npm install
npm run dev      # live preview while coding, uses 3-Source-Code/.env  (http://localhost:5173/#/tech)
npm run build    # writes a fresh ../1-Website folder — copy your filled config.js back into it afterwards
```

---

## Daily workflow

**Office (web)**
1. **Orders → Upload Excel**: preview → Import. You can upload the same Amazon sheet again safely (see the rules below).
2. Assign jobs: use the **Technician** dropdown on each row, or tick many rows → **Assign to… → Assign**.
   Filter **Technician = ⚠ Unassigned** to see what's left.
3. Watch the **Dashboard**. When a technician completes a job it updates live: status, amount, who did it and when.

**Admin one-time setup per technician**
Technicians → Add Technician (name + **mobile**) → open the technician → **Enable app login** → a 6-digit PIN is suggested →
**Save** → **Send on WhatsApp** (sends the `…/#/tech` link, mobile and PIN).

**Technician (phone)**
1. Open the link in Chrome → **Install** (iPhone: Safari → Share → Add to Home Screen) → the **HT Jobs** icon appears.
2. Log in with mobile + PIN. This is a one-time step; it stays logged in.
3. **Pending** tab = my jobs. Each job has buttons for **Call**, **Map** (Google Maps) and WhatsApp.
4. **Mark Completed** → enter the amount collected → Submit, or **Can't Complete** → choose a reason.
5. New jobs appear automatically with a vibration and a "NEW" badge while the app is open.
6. A technician can fix a mistake (edit the amount or re-open the job) until midnight. After that only the office can change it.

## Excel upload rules
Columns (any order, any capitalisation): `DATE, ORDER ID, CUSTOMER NAME, PHONE NO, SERVICE, BRAND, LOCATION, ADDRESS, PIN CODE, TECHNICIAN, STATUS, COMMENTS`.
Only **ORDER ID** and **CUSTOMER NAME** are required. Download **Template** on the Orders page.
- If an ORDER ID already exists, the order is **updated, not duplicated**.
- STATUS / TECHNICIAN from the file only change orders that are **still Pending**. A re-upload never undoes completed work and never touches the amount.
- An unknown technician name is added automatically. Give them a mobile number and app login afterwards.
- DATE accepts Excel dates, `M/D/YYYY` (Amazon format), `DD-MM-YYYY` and `YYYY-MM-DD`. A blank date means today.
- Max 5000 rows per file. If two people upload at the same moment, the second gets "please try again".

## Security (enforced by the database, not just the screens)
- Technicians can read **only their own** jobs, and can change only status, amount and notes, through one checked function.
- Office staff: orders, upload, assign, technicians, billing. Admin: plus reports, audit log, users and settings.
- Every status, amount and assignment change is written to the **Audit Log** automatically, with who made it and when.
- When a login is disabled, that person loses access immediately, even if they were already logged in.

## Free plan notes
- Daily use keeps the project awake. Free projects pause after 1 week with no activity; you can resume them from the dashboard.
- **No automatic backups on the free plan.** Once a week: Reports → pick a wide date range → **Export Excel** and keep the file.
- Check usage now and then: Supabase → Project → **Usage** (database limit is 500 MB; this app uses roughly 50–100 MB per year).

## Moving data from the old system
1. Old app → Reports → Export Excel (all dates) → in the new app: Orders → Upload Excel. The column names match.
2. Old app → Technicians → Export → in the new app: Technicians → Import. Then enable app logins.

## What changed from v1
- Removed: Express server, Redis, Docker, nginx, certbot, Twilio SMS (it was never actually sending).
- Fixed: Billing save (was always failing), admin password reset, the "To" date filter, search across all pages,
  bill numbers clashing, and dashboard dates in IST.
- New: technician logins and the HT Jobs app; per-row and bulk assignment; upload preview with row errors;
  New Order form; company details for bills in Settings; amount-collected KPIs; order history drawer.

## Known limits
- Alerts arrive while HT Jobs is **open** (or when it's reopened). Phone push notifications with the app closed are not included.
- Actions need internet. With no signal, the app says so and nothing is lost; submit again when back online.
