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
   - `WA_PHONE_NUMBER_ID` = 1188057101050294
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
| Read/create/update normal clinic records | Yes | Yes | Yes | Yes |
| View staff directory | Yes | Yes | Yes | Yes |
| Add, edit, deactivate, or invite staff | Yes | No | No | No |
| Permanently delete records | Yes | Yes | No | No |
| Merge duplicate patients | Yes | Yes | No | No |
| View the activity log | Yes | No | No | No |
| Use the CSV export screen | Yes | No | No | No |

“Normal clinic records” currently includes front-desk, clinical, financial,
inventory, and compliance records. Receptionist and assistant are distinct
labels but intentionally have the same database permissions at present.
