# First clinic handoff

Code changes are ready for validation; production cutover is not yet verified.
WhatsApp automation is a separate phase.

The clinic mainly used Click4Appointments for patient registration, with occasional other entries; most clinical and financial history is offline. The first handoff therefore focuses on the patient directory. Keep paper records as the historical reference and enter relevant history when a patient next visits. Full historical treatment, appointment and billing backfill is not required for this handoff.

## Release order

1. Export the current database and the contents of the `xray-images` storage bucket. Record where the backups are stored and who can restore them. Keep the original Click4Appointments exports.
2. Run `scripts/handoff-preflight.sql` in the target database and review the results. Resolve missing migrations, unexpected staff access, negative invoices, and invalid totals before proceeding.
3. Apply `supabase/migrations/016_handoff.sql` once, in the SQL editor, before deploying the new UI. It runs in a transaction. It adds import provenance, permits missing patient phone numbers, and adds payment amounts plus an audit trail. Paid invoices are backfilled including tax; legacy partial amounts remain unknown and require reconciliation.
4. Deploy the clinic app. The new importer/payment UI depends on migration 016. Avoid keeping old app tabs open: reload all staff browsers after release.
5. Sign in with the actual staff accounts that will use the app on day one. Verify an inactive or unlinked login receives the access message. The SQL tests exercise the checked-in policies, but cannot establish which policies are deployed.

Fresh databases can replay migrations 001–016. Migration 014's index was corrected to index the timestamp directly; the previous timezone-dependent date cast prevented PostgreSQL from creating the index. If an earlier execution of 014 failed partway through, inspect which statements were applied before completing that migration; do not blindly rerun table creation statements.

## Source reconciliation

The locally reviewed final patient CSV has 825 rows, 825 distinct source IDs, and 471 missing phone numbers. All rows pass the new importer validation. The appointment history export has 11 rows from occasional use. Review any entries that affect upcoming visits; a complete historical appointment archive is outside this handoff.

The patient import preserves source fields including age, registration date, last visit, medical summary, and pending-payment text under “Original Click4Appointments record.” Age is not converted into an invented birth date. Source pending-payment text is not treated as a verified invoice balance. Consent is not assumed.

Use the single admin Patient Import screen. Patient + medical history are saved atomically. Identical source IDs/rows can be retried without reinserting; changed source rows and possible existing duplicates are reported for review. Records previously imported without source IDs may need manual matching. Reconcile those records rather than deleting and reimporting them.

Run the read-only checker before importing:

```sh
node scripts/reconcile-handoff.mjs /path/to/final-patients.csv
```

After migration, pause record editing and use Data Export → Download all records (JSON). Compare the export to the original CSV:

```sh
node scripts/reconcile-handoff.mjs /path/to/final-patients.csv /path/to/clinic-records.json
```

The report contains aggregate counts and CSV row numbers, not patient names. Review missing/changed patient rows and spot-check names, available phone numbers and retained notes. Confirm upcoming visits against the diary or paper schedule. Only carry forward balances that staff verify from their offline records; an empty digital ledger does not mean a patient has no old dues. Review any occasional imported invoices before relying on their payment status. Historical financial totals and unused clinical modules are not migration acceptance criteria.

## Staff rehearsal

For day one, rehearse with the staff who will actually use the app:

- Sign in, find an older imported patient beyond the first 500 records, and open a patient without a phone number.
- Spot-check a few imported records against Click4Appointments. Add or update a patient; record consent only when obtained.
- If appointments will be managed in the app immediately, create and reschedule one visit and confirm its date and time. Otherwise keep the existing diary until staff adopt scheduling.
- If billing will be used immediately, test one invoice and partial payment on a synthetic patient. For example, ₹10,000 billed and ₹4,000 received must leave ₹6,000 due. Verify the printed balance and payment history. Keep older paper balances separate until verified and entered.
- Export the patient records and confirm that the backup owner knows how to recover them.

Treatment charting, prescriptions, file uploads, recurring appointments and refunds can be introduced as staff adopt those workflows. Rehearse each before relying on it; they do not all need to be part of the initial patient-directory handoff.

Dashboard collections are grouped by invoice date, not receipt date; the labels make this explicit. The payment editor captures cumulative net received and a reason/reference for each change. It does not implement a separate accounting cashbook or allocate refunds to individual receipts.

## Backup and recovery acceptance

The JSON export covers all current public record tables with pagination and counts, including medical history and file metadata. It preserves structured values. It is an operational export, not a database restore image: it excludes file bytes, auth accounts, schema, and infrastructure settings. Tables are read sequentially, so pause edits while exporting.

Before final handoff, restore a database backup to a separate staging project and copy/restore the storage objects. Verify patient counts and staff access. Include invoice balances and uploaded files in the restore check if those features already contain real data; empty, unused modules need no sample records. Record the backup time, restored project, person responsible, and restore result. No production backup or restore was performed by this code change.

## Verification completed locally

- Production Vite build.
- Node regression tests for IST recurrence, month-end behavior, financial arithmetic, capped pagination, and CSV validation.
- Isolated PostgreSQL replay of migrations and tests for atomic import rollback, retry behavior, payment concurrency, audit preservation, and active/inactive staff RLS.
- Read-only validation of the 825-row final patient export.
- Headless Chrome smoke test with synthetic data: patient search beyond 500, source-ID import, partial payment, rescheduling, recurring appointments and a paginated 825-patient JSON export; no page errors.

The browser check is `apps/clinic/scripts/browser-smoke.mjs`. Start Vite on localhost:5173 and run the script with `PLAYWRIGHT_MODULE` pointing to an installed `playwright-core` module entry. `CHROME_PATH` can override the default macOS Chrome executable. It uses synthetic API responses and does not establish production connectivity.

For the patient-directory handoff, the remaining checks are production migration application, patient-record verification, actual staff login/search rehearsal, and patient-data recovery. Add billing and storage checks only if those workflows are being used. Retain the Click4Appointments exports and paper records for historical reference.
