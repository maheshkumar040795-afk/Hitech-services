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

---

## Update — Oct 2026: Technician ID + keep-alive

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-10-technician-id.sql` → **Run**.
(Fresh installs don't need it — `schema.sql` already includes it.)

- Every technician has a unique **Technician ID** (HT001, HT002 …). Existing technicians are numbered oldest first.
- Add / Edit technician: type an ID, or leave it blank to get the next free one. Duplicates are refused.
- The ID shows on technician cards, profile, assign drop-downs, order details, Excel exports and in the HT Jobs app.
- Technician Excel import accepts an optional **ID** column. In the order upload sheet, the **TECHNICIAN** column can be the ID or the name.
- `.github/workflows/keep-alive.yml` pings the database every 3 days so the free Supabase project is not auto-paused. It is not part of the website.

## Update — Oct 2026 (2): HT Jobs folder, Forgot PIN, ID Cards

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-10-forgot-pin.sql` → **Run**.

- **Technician app link is now `…/tech/`** (a real folder). iPhone drops the `#…` part of a link when adding to the Home Screen, so the old `…/#/tech` icon opened the office login. Old links redirect automatically. The HT Jobs app never shows the office login.
- **Forgot PIN:** HT Jobs login → Forgot PIN? → request goes to the office (red badge on *Technicians* + banner). Admin taps **Reset PIN & send** → new PIN on WhatsApp. Technicians can also WhatsApp/call the office (phone from *Settings → Company phone*).
- **ID Cards** (admin menu): the ID card generator (`1-Website/id-cards.html`, history stored in its own Firebase project). "Fill from technician" copies name, Technician ID and mobile.

## Update — Oct 2026 (3): Edit order, Google location, Reschedule, Cash / Online

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-10-orders-reschedule-payment.sql` → **Run**.

- **Edit order** (pencil icon on every order): fill in missed details, Google location URL, technician; for completed orders also amount + Cash/Online.
- **Google location URL** on each order (also an optional `LOCATION URL` column in the Excel upload). The technician's Map button opens that exact link.
- **Rescheduled** status: pick a new visit date (single order or bulk). Order date is kept; the job stays in the technician's Pending list under the new date. Logged in the order's comments.
- **Completed date** (date the technician actually finished, from `closed_at`) shown on each order line, in order details, Reports and Excel exports.
- **Cash / Online** when the technician marks a job completed (required when amount > 0). Shown on orders, exports, Reports and the Dashboard "Collected" card (cash vs online split).

## Update — Oct 2026 (4): crisp Audit Log

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-10-audit-trim.sql` → **Run**.

- Audit Log is now **order-wise**: each order shows who last modified it and its **last 3 changes**. Older entries are deleted automatically by the database (also per technician / user). Excel upload history keeps the last 20.
- Statistics cards removed; the page loads only one small list per page (20 orders).

## Update — Oct 2026 (5): 300 technicians, less data, weekly backup

- **Less data (free-plan safe):** HT Jobs downloads only the fields it shows, open jobs + jobs closed in the last 3 days (button for 30 days), and re-checks every 5 min while live updates are on (1 min if live updates drop). Office screens group live refreshes (one every 3 s at most); technician list cached 5 min.
- **Searchable technician picker** everywhere (orders row, bulk assign, new/edit order, filters, Reports, ID Cards): type ID, name, area or mobile; shows each technician's open jobs.
- **Technicians page:** filters Active / Working today / App not set up / Inactive, 24 cards at a time with "Show more".
- **Settings → Download full backup:** one Excel with Orders, Comments, Technicians, Bills, Users, Company. Do it weekly and keep in Google Drive.

## Update — Oct 2026 (6): new-job alerts on technicians' phones

- **Phone notification only** (no in-app sound or popup): "2 new jobs assigned to you" via web push, shown whether HT Jobs is open, closed or the phone is locked. A bulk assignment sends one notification; new jobs are highlighted as NEW in the app. Each technician taps **Turn on notifications** once in HT Jobs (iPhone: add HT Jobs to the Home Screen first, iOS 16.4+).

**One-time setup**
1. SQL Editor → run `2-Supabase-Setup/update-2026-10-job-alerts.sql`.
2. Edge Functions → Deploy new function → name **`notify-assign`** → paste `2-Supabase-Setup/functions/notify-assign/index.ts` → turn **off** "Verify JWT" → Deploy.
3. Edge Functions → Secrets → add `VAPID_PUBLIC_KEY` (same as `WEB_PUSH_PUBLIC_KEY` in config.js), `VAPID_PRIVATE_KEY` (kept privately — never put it in this repo), `VAPID_SUBJECT` = `mailto:you@yourdomain`.

## Update — Nov 2026: technician status, Rate Config, Technician Payout

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-11-status-rates-payout.sql` → **Run**.

- **Technician status** (Technicians page + Dashboard): Online now (HT Jobs open, live), Logged in (last seen …), Logged out, App not set up, Blocked — with counts and an "Online now" filter.
- **Rate Config** (admin menu): technician rate per service, tabs **Within Chennai** (pin 600xxx or no pin) / **Outside Chennai**. Shows services in orders that have no rate. "Apply rates to this month's completed jobs" re-applies after edits. Edit order → *Rate region* to override.
- **Technician Payout** (admin menu): completed jobs by day/range → per technician: earned (rates) − cash collected (− online, if online payments reach the technician; switch on the page) = **net pay**. "Paid on Amazon" jobs: nothing collected, full rate paid. Expand a technician to see each job; Export to Excel.
- **HT Jobs**: Mark Completed now has **Cash / Online / Paid on Amazon**. The rate is saved on the job at completion, so later rate changes don't alter past payouts.

## Update — Nov 2026 (2): order sheet in the Hi-Tech model format

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-11-order-sheet-format.sql` → **Run**.

- **Template** (Orders → Template) now has the model columns: DATE, SERVICE_ORDER_ID, CUSTOMER NAME, PHONE NUMBER, SERVICE, BRAND, PRODUCT_TYPE, LOCATION, PIN CODE, TECHNICIAN, STATUS.
- **Orders table, upload preview and Export** use the same column order. PRODUCT_TYPE is saved and shown (also in the order drawer and HT Jobs).
- **STATUS from the sheet** is kept as written (shown as "Sheet: …" under the status) and mapped: COMPLETED / Physically completed → Completed, NOT_SERVICED → Pending, CANCELLED / REJECTED → Rejected.

## Update — Nov 2026 (3): installed item + Collect amount / Paid on Amazon

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-11-installed-item.sql` → **Run**.

- **HT Jobs → Mark Completed:** 1) *What did you install?* — pick from the Rate Config list (e.g. TV Installation (50 - 55 inch), Washing Machine Installation). 2) *Payment* — **Collect amount** (then Cash or Online/UPI + amount) or **Paid on Amazon** (₹0).
- **Rate / payout** is taken from Rate Config for the **installed item** (Within/Outside Chennai), not the order's service text. If no item is picked, the service is used as before.
- Office sees the installed item under *Completed* in Orders, in the order drawer, in Export (`Installed Item`) and in Technician Payout. Edit order (completed) → *Installed item* to correct it.
- To add or rename items (e.g. "Refrigerator Installation"), edit the Rate Config list — technicians see the change next time they open the form.

## Update — Nov 2026 (4): Google Sheet import, technician suggestion by pin code, automatic daily backup

- **Orders → Google Sheet:** paste the link of a Google Sheet (shared as *Anyone with the link*) and its orders are read into the same preview as **Upload Excel**. Same columns as the Excel template. The link is remembered on that computer. The tab that is open when the link is copied is the one imported.
- **Technician suggestion:** when assigning an order, the picker lists the best matches for the order's pin code first under **Suggested**: technicians living at the same pin code, then those who already completed jobs there, then those nearby (same first 3 digits). Fewer open jobs comes first. Fill in each technician's **Pincode** on the Technicians page to get the most from it.
- **Automatic daily backup:** every night GitHub saves every table as a CSV file in a separate **private** repository. Setup and restore steps: `4-Daily-Backup/README.md`.

**One-time setup**
1. Google Sheet import: Edge Functions → Deploy new function → name **`fetch-sheet`** → paste `2-Supabase-Setup/functions/fetch-sheet/index.ts` → keep **Verify JWT on** → Deploy. (Without it the app still tries to read the sheet directly, but Google often refuses browsers.)
2. Daily backup: follow `4-Daily-Backup/README.md` (about 5 minutes).
3. Technician suggestion needs no setup and no SQL.

## Update — Nov 2026 (5): one payment choice — Collected from customer, or Paid on Amazon

No SQL to run.

- **Cash / Online removed everywhere.** The customer always pays the technician (cash or UPI), so a completed job is either **Collected from customer** (with the amount) or **Paid on Amazon** (₹0). Older jobs saved as Cash or Online both show as Collected from customer.
- **HT Jobs → Mark Completed:** *Collect from customer* (type the amount) or *Paid on Amazon*.
- **Orders:** the amount column is **Collected ₹**; a completed order shows Collected / Amazon. Edit order (completed) has Payment and *Collected from customer ₹*.
- **Technician Payout:** Earned (Rate Config) − Collected from customer = Net pay, per technician and per job. The "Online payment goes to" setting is gone: everything collected is deducted. Net ₹0 shows *settled, nothing to pay*.
- **Payout Export:** sheet *Summary* (one line per technician with job counts, earned, collected, net pay, and a TOTAL line) and sheet *Job details* (every job with rate, payment, collected and net, with a TOTAL line under each technician).
- **Orders → status Completed (office closes a job for a technician):** a popup asks *What was installed?* (Rate Config list) and *Payment* (Collected from customer + amount, or Paid on Amazon). The order is completed only after both are filled, so it always has a rate and the collection is deducted in Payout. Completing many selected orders at once is still one click: open each (pencil) to set the installed item and amount.

## Update — Nov 2026 (6): Cancelled status (Own Installation) + STATE and VENDOR NAME columns

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-11-cancel-state-vendor.sql` → **Run**.

- **Orders → Status → Cancelled** (row dropdown, or select orders → *→ Cancelled*): for orders the owner installed himself. After a confirm, the technician is removed, the Technician column shows **Own Installation**, and the job leaves that technician's HT Jobs and Technician Payout. The Audit Log keeps which technician it was taken from. Set the status back to Pending to assign a technician again.
- **Status filter** has *Cancelled (own installation)*. Export, Reports and the order drawer show *Own Installation* as the technician; Export has a *Cancelled On* column.
- **New columns STATE and VENDOR NAME**, right after DATE, in the Template, Upload Excel / Google Sheet (and preview), the Orders table, Export, Reports export, the order drawer and New / Edit order. Upload headers accepted: `STATE`; `VENDOR NAME` / `VENDOR` / `SELLER NAME`.
- Sheet STATUS `CANCELLED` still imports as **Rejected** (unchanged).

## Update — Nov 2026 (7): Installation photos in HT Jobs (Cloudinary)

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-11-job-photos.sql` → **Run**.

- **HT Jobs → Mark Completed:** new *Installation photos* section with **Take photo** (opens the camera) and **Upload from gallery** (pick several). Max **10 photos** per job. Each photo is made smaller on the phone (longest side 1600 px, JPEG ≈ 150–400 KB instead of 3–10 MB) and uploaded straight to Cloudinary while the technician fills the rest. Submit waits until all photos are uploaded; a failed photo shows *Retry*.
- With `PHOTOS_REQUIRED: true` (default) a job cannot be completed without at least 1 photo. Set it to `false` in `config.js` to make photos optional.
- Only the photo links are saved in Supabase (`orders.photos`), so the free database stays small.
- **Office:** order drawer shows the photos (click = full size), Orders shows "📷 3 photos" under *Completed*, Export has *Photos* and *Photo Links*. Audit Log records photo changes. HT Jobs *Done* cards show the photos too.
- Until Cloudinary is set up (both settings empty), the photo section is hidden and HT Jobs works as before.

### Cloudinary setup (one time, ~5 minutes, free)

1. Go to **cloudinary.com** → *Sign up for free* (no card needed). Use the Hitech office email.
2. After login, the **Cloud name** is shown at the top of the *Dashboard* (also in **Settings → API Keys**). Copy it, e.g. `dxyz12ab`. *(Do not copy the API Secret anywhere — it is not needed.)*
3. **Settings (gear icon) → Upload → Upload presets → Add upload preset**:
   - **Upload preset name:** `ht_jobs`
   - **Signing mode:** **Unsigned** ← required (the phone uploads without a secret key)
   - **Asset folder:** `hitech-jobs`
   - **Use filename / Unique filename:** leave default (unique names)
   - Optional, under *Upload control / Restrictions*: **Allowed formats** `jpg,jpeg,png,webp,heic`, **Max file size** `10 MB`
   - **Save**.
4. On GitHub open `1-Website/config.js` → ✏️ Edit → fill in:
   ```js
   CLOUDINARY_CLOUD_NAME: 'dxyz12ab',
   CLOUDINARY_UPLOAD_PRESET: 'ht_jobs',
   PHOTOS_REQUIRED: true,
   ```
   → **Commit changes**. The site redeploys by itself in about a minute. Technicians: close and reopen HT Jobs.
5. Test: open a job in HT Jobs → Mark Completed → Take photo → Submit. The photo appears in Cloudinary → *Media Library → hitech-jobs* and in the office order drawer.

**Free plan size:** 25 credits a month, where 1 credit = 1 GB stored *or* 1 GB viewed *or* 1,000 resized versions. At ~100 jobs × 3 photos a day (≈ 90 MB/day, ≈ 2.6 GB/month) the free plan lasts roughly **6–8 months** of stored photos. Watch *Dashboard → Usage*; when it gets near 25, delete old months in Media Library (filter by folder/date) or move to a paid plan. The app never asks Cloudinary for resized copies, so no credits go on transformations.

**Note:** a photo removed with ✕ before Submit stays in Cloudinary (unsigned uploads cannot delete). It is harmless; old unused photos go away with the monthly cleanup above.

## Update — Nov 2026 (8): technician suggestion by pin code AND area

No SQL to run.

When assigning an order (Orders row, bulk *Assign to…*, New / Edit order) the picker's **Suggested** list now matches the order's **Location** and **Pin Code** with each technician's **City / Area**, **District** and **Pincode** (Technicians page). Order of suggestions:
1. Same pin code & area  2. Same pin code  3. Same area (order Location = technician City/Area)  4. Already completed jobs at this pin code  5. Same district  6. Nearby pin code (same first 3 digits).
Within each group, the technician with fewer open jobs comes first. Common spelling differences are matched (Kancheepuram / Kanchipuram, Thiruvallur / Tiruvallur). Orders without a pin code still get suggestions by Location. Fill in City / Area, District and Pincode for every technician to get the best suggestions.

## Update — Nov 2026 (9): Repairs

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-11-repairs.sql` → **Run**. (Until then Orders, Payout and HT Jobs keep working as before; the Repairs screen shows a "run the SQL" message.)

- **New office screen "Repairs"** (menu under Orders). Works exactly like Orders: Template, Upload Excel, Google Sheet, New Repair, Export, assign technician (with pin code / area suggestions), Pending / Rescheduled / Completed / Rejected / Cancelled ("Own Repair"), Cash Collect, photos, order drawer, audit.
  Repairs and installations are kept apart by a new **Job type** on each order. All existing orders are installations. An Order ID can exist only once: uploading a repair with an Order ID that is already an installation (or the other way round) is reported as an error in the upload result, nothing is overwritten.
- **Rate Config → Repair rates** (new switch above Within / Outside Chennai). Add repair items with their Within Chennai and Outside Chennai rates. The same name may be in both lists with different rates. A completed repair takes its rate from the Repair list; an installation from the Installation list. *Apply rates to this month's completed jobs* updates both.
- **HT Jobs:** repair jobs show an orange **REPAIR** badge. *Mark Completed* asks **"What did you repair?"** with the Repair list. The salary cards show **Install × n ₹…** and **Repair × n ₹…** for previous and current month, then Collected and Net salary.
- **Technician Payout:** new **Installations** and **Repairs** columns (count and amount) and summary cards; job details have a *Type* column; Export has Installations / Installation earned / Repairs / Repair earned, and *Type* per job. Mark as paid covers both.
- Reports export and the order drawer show the Job Type. The Dashboard counts installations and repairs together.

## Update — Nov 2026 (10): Petrol allowance + Salary advance

**Run once:** Supabase → SQL Editor → paste `2-Supabase-Setup/update-2026-11-tech-finance.sql` → **Run**.

- **Technicians → green ₹ button** on each technician card (admins only) opens *Finance*: add **Petrol allowance (+)** or **Salary advance (−)** with amount, date and note; see and delete entries month by month. Every add / delete is in the Audit Log.
- **Net salary = Earned − Collected from customer + Petrol allowance − Salary advance**, counted in the month of the entry date.
- **Technician Payout:** new *Petrol* and *Advance* columns, Net pay includes them, the expanded row lists each entry, *Mark as paid* saves the amount including them, Export has the two columns and a *Petrol & Advance* sheet. A technician with only an advance / allowance in the period (no jobs) is listed too.
- **HT Jobs:** month cards show *Petrol +* and *Advance −*; tap a card for the full breakdown (installations, repairs, collected, petrol, advance, net salary, paid / balance) and every petrol / advance entry with date and note.
- Fixed: refreshing the office **Technicians** page (…/#/technicians) no longer jumps to the HT Jobs app.

## Update — Nov 2026 (11): password before delete, simpler bulk bar, "Installation Orders"

No SQL to run.

- Left menu / page title **Orders → Installation Orders**.
- Select rows on Installation Orders or Repairs → the bar now has only **Assign** and **Delete** (bulk → Pending / Completed / Rejected / Cancelled / Reschedule removed; each row's own Status dropdown is unchanged).
- **Every delete asks for the admin's login password** first: Installation Orders and Repairs (selected rows), Rate Config (delete a rate), Technicians → ₹ Finance (delete an entry), Technician Payout (*Undo* paid). A wrong password deletes nothing. The check uses a separate one-time login, so the admin stays logged in.
