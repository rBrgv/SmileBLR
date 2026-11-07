# Smile Bengaluru — Platform

Monorepo for the Smile Bengaluru digital platform.

```
smileblr/
├── apps/
│   ├── web/        Marketing site (smilebengaluru.com) — static, GitHub Pages
│   └── clinic/     Clinic management app — React + Vite + Vercel functions
└── supabase/
    └── migrations/ Versioned database schema (source of truth)
```

## Deploys

| App | Host | How |
|---|---|---|
| apps/web | GitHub Pages (repo rBrgv/SmileBLR) | push index.html |
| apps/clinic | Vercel (root directory = `apps/clinic`) | git push → auto build |
| supabase | Supabase project `smile` (cdvrkcrcpmaqaaffdfgm) | run migrations in SQL editor, in order |

## Clinic app — local dev

```bash
cd apps/clinic
npm install
cp .env.example .env    # fill VITE_SUPABASE_ANON_KEY
npm run dev
```

## Vercel setup (one time)

1. vercel.com → New Project → import this repo
2. Root Directory: `apps/clinic`  ·  Framework: Vite
3. Environment variables:
   - `VITE_SUPABASE_URL` = https://cdvrkcrcpmaqaaffdfgm.supabase.co
   - `VITE_SUPABASE_ANON_KEY` = (anon public key)
   - `WA_ACCESS_TOKEN` = (Meta permanent token — server only)
   - `WA_PHONE_NUMBER_ID` = 1339431522582768
   - `WA_APP_SECRET` = (Meta app secret — verifies inbound webhook signatures)
   - `WA_VERIFY_TOKEN` = (random webhook setup token — must match Meta Business Manager)
   - `INTERNAL_API_KEY` = (long random key for trusted server callers of /api/wa-send; never expose it in browser code)
4. Deploy. App at https://<project>.vercel.app — later map clinic.smilebengaluru.com via CNAME.

WhatsApp automation lives in `apps/clinic/api/wa-send.js` — the Meta token never reaches the browser.

## Staff roles and access

Every login must be linked through `staff.user_id` to an active staff row. An
authenticated account that is unlinked or inactive has no clinic-data access.

| Capability | Admin | Doctor | Receptionist | Assistant |
|---|:---:|:---:|:---:|:---:|
| Read all clinic records | Yes | Yes | Yes | Yes |
| Register patients, appointments, bookings, waitlist, recalls | Yes | Yes | Yes | Yes |
| Invoices, payments and receipts | Yes | Yes | Yes | Yes |
| Record vitals | Yes | Yes | No | Yes |
| Medical history, tooth chart, consultations, prescriptions, treatment plans and records, consent forms | Yes | Yes | No | No |
| Mark a follow-up call as done | Yes | Yes | Yes | Yes |
| View the staff directory | Yes | Yes | Yes | Yes |
| Add, edit, deactivate, or invite staff | Yes | No | No | No |
| Permanently delete records | Yes | Yes | No | No |
| Merge duplicate patients | Yes | Yes | No | No |
| Archive a patient | Yes | No | No | No |
| Clinic settings, WhatsApp conversations, activity log, CSV export | Yes | No | No | No |

Clinical writes are restricted in the database itself (migration 017), not just
hidden in the interface. Every update to a record keeps the previous version in
`record_changes` (migration 026), so editing is open but nothing is lost.

## First handoff

See [the handoff runbook](docs/first-handoff.md) for migration 016, source reconciliation, staff rehearsal, and backup/restore acceptance. Run clinic regression tests with `cd apps/clinic && npm test`.
