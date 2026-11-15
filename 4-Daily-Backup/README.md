# Hitech Services — automatic daily backup

Every night at about 1:15 AM, GitHub copies the whole Supabase database into a **private**
repository of yours. It is free. Nothing is installed on your PC.

The backup contains customer names and phone numbers, so it must **not** be kept in the public
`Hitech-services` repository. That is why it needs its own private repository.

## One-time setup (about 5 minutes)

1. **Create the private repository.** GitHub → **+** → **New repository** → name `Hitech-backups`
   → choose **Private** → tick **Add a README file** → **Create repository**.
2. **Add the two files.** In the new repository:
   - **Add file → Create new file** → name it `backup.mjs` → paste the contents of
     `4-Daily-Backup/backup.mjs` → **Commit changes**.
   - **Add file → Create new file** → name it exactly `.github/workflows/daily-backup.yml`
     (typing the `/` makes the folders) → paste the contents of
     `4-Daily-Backup/.github/workflows/daily-backup.yml` → **Commit changes**.
3. **Add the secret key.** Supabase → **Project Settings → API keys** → copy the **service_role**
   (secret) key. Then in `Hitech-backups` → **Settings → Secrets and variables → Actions →
   New repository secret** → Name `SUPABASE_SERVICE_ROLE_KEY` → paste the key → **Add secret**.
   This key can read everything: paste it only here, never into a file or a chat.
4. **Take the first backup.** `Hitech-backups` → **Actions → Daily backup → Run workflow**.
   After about a minute there is a green tick and a `data/` folder with one file per table.

From then on it runs by itself every night. If a backup fails, GitHub emails you.

## Using a backup

- **Look at the data:** open `data/orders.csv` (or any other file) → **Download raw file** → open in Excel.
- **Go back to an earlier day:** **Commits** → pick the day → **Browse files** → download the file.
- **Put data back:** Supabase → **Table Editor** → the table → **Insert → Import data from CSV**.
  Restore `profiles` and `technicians` before `orders`.
- `data/LAST-BACKUP.txt` shows when the last backup ran and how many rows each table had.

## What is not in the backup

- **Passwords and PINs.** Supabase does not give these out. After a full rebuild, set them again
  on the Users and Technicians pages.
- **Phone notification registrations.** Technicians tap *Turn on alerts* again.

Keep using **Settings → Download full backup** once in a while as a second copy.
