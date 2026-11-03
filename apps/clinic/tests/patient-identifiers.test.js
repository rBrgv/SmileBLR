import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Migration 024: every patient gets a readable code, imported patients keep
// the clinic's own number, and neither can collide.
test('patient identifiers are generated, backfilled and unique', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE PUBLICATION supabase_realtime; GRANT USAGE ON SCHEMA public,auth TO authenticated;`)
    const folder = new URL('../../../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
      // Patients that predate 024, one of them imported from Click4Appointment.
      if (file.startsWith('024')) {
        await db.exec(`INSERT INTO patients(full_name,created_at) VALUES('First','2020-01-01');
          INSERT INTO patients(full_name,import_key,created_at) VALUES('Imported','click4appointment:id:P932','2020-01-02');`)
      }
      await db.exec(await readFile(new URL(file, folder), 'utf8'))
    }

    const existing = (await db.query('SELECT full_name, patient_code, manual_id FROM patients ORDER BY created_at')).rows
    assert.deepEqual(existing.map(r => r.patient_code), ['SB00001', 'SB00002'], 'numbered in registration order')
    assert.equal(existing[0].manual_id, null, 'a patient with no clinic number keeps none')
    assert.equal(existing[1].manual_id, 'P932', 'the Click4Appointment number becomes the clinic number')

    const fresh = (await db.query("INSERT INTO patients(full_name) VALUES('Walk in') RETURNING patient_code")).rows[0]
    assert.equal(fresh.patient_code, 'SB00003', 'a new patient continues the sequence')

    await assert.rejects(db.query("INSERT INTO patients(full_name,manual_id) VALUES('Clash','P932')"),
      /duplicate key/, 'two patients cannot share a clinic number')
    await db.query("INSERT INTO patients(full_name,manual_id) VALUES('No number',NULL)")
    await db.query("INSERT INTO patients(full_name,manual_id) VALUES('Also none',NULL)")  // NULLs do not collide
  } finally { await db.close() }
})
