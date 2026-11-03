import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { vitalsSummary, vitalsFlags, canRecordVitals } from '../src/lib/vitals.js'

test('vitals are recordable by the people who take them, and refuse nonsense', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT);
      CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE PUBLICATION supabase_realtime;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;`)
    const folder = new URL('../../../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, folder), 'utf8'))
    }
    await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)
    const ids = { admin: '30000000-0000-0000-0000-000000000001', doctor: '30000000-0000-0000-0000-000000000002', receptionist: '30000000-0000-0000-0000-000000000003', assistant: '30000000-0000-0000-0000-000000000004' }
    const staff = {}
    for (const [role, id] of Object.entries(ids)) {
      await db.query('INSERT INTO auth.users(id) VALUES($1)', [id])
      staff[role] = (await db.query('INSERT INTO staff(full_name, role, user_id) VALUES($1,$1,$2) RETURNING id', [role, id])).rows[0].id
    }
    const as = async role => {
      await db.exec('RESET ROLE')
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids[role]])
      await db.exec('SET ROLE authenticated')
    }
    await as('admin')
    const patient = (await db.query("INSERT INTO patients(full_name) VALUES('Vitals test') RETURNING id")).rows[0].id

    // The assistant with the cuff may record, and is stamped as having done so.
    await as('assistant')
    const row = (await db.query('INSERT INTO patient_vitals(patient_id, bp_systolic, bp_diastolic, pulse, temperature_f, spo2) VALUES($1,170,105,88,98.4,97) RETURNING *', [patient])).rows[0]
    assert.equal(row.recorded_by, staff.assistant)
    assert.equal(row.recorded_on.toISOString().slice(0, 10), new Date().toISOString().slice(0, 10))

    // Reception may read but not record.
    await as('receptionist')
    assert.equal((await db.query('SELECT count(*)::int AS n FROM patient_vitals')).rows[0].n, 1)
    await assert.rejects(db.query('INSERT INTO patient_vitals(patient_id, pulse) VALUES($1,70)', [patient]), /row-level security/)

    await as('doctor')
    await assert.rejects(db.query('INSERT INTO patient_vitals(patient_id, bp_systolic) VALUES($1,120)', [patient]), /vitals_bp_pair/)
    await assert.rejects(db.query('INSERT INTO patient_vitals(patient_id, bp_systolic, bp_diastolic) VALUES($1,80,120)', [patient]), /vitals_bp_order/)
    await assert.rejects(db.query('INSERT INTO patient_vitals(patient_id, notes) VALUES($1,$2)', [patient, 'nothing measured']), /vitals_not_empty/)
    await assert.rejects(db.query('INSERT INTO patient_vitals(patient_id, pulse) VALUES($1,400)', [patient]), /check constraint/)
    await assert.rejects(db.query("INSERT INTO patient_vitals(patient_id, pulse, recorded_on) VALUES($1,70,current_date + 30)", [patient]), /vitals_future/)
    await assert.rejects(db.query("INSERT INTO patient_vitals(patient_id, blood_sugar, sugar_timing) VALUES($1,110,'guessed')", [patient]), /check constraint/)

    // A correction is allowed and keeps what it replaced (026).
    await db.query('UPDATE patient_vitals SET bp_systolic=130, bp_diastolic=85 WHERE id=$1', [row.id])
    assert.equal((await db.query("SELECT old_row->>'bp_systolic' AS was FROM record_changes WHERE table_name='patient_vitals' AND record_id=$1", [row.id])).rows[0].was, '170')

    // Merging duplicate records carries the readings across.
    await as('admin')
    const primary = (await db.query("INSERT INTO patients(full_name) VALUES('Vitals primary') RETURNING id")).rows[0].id
    await db.query('SELECT merge_patients($1,$2)', [primary, patient])
    assert.equal((await db.query('SELECT patient_id FROM patient_vitals WHERE id=$1', [row.id])).rows[0].patient_id, primary)
  } finally { await db.close() }
})

test('a reading reads back the way it is spoken, and flags what to check', () => {
  const v = { bp_systolic: 170, bp_diastolic: 105, pulse: 88, temperature_f: '98.4', spo2: 97, blood_sugar: '260.0', sugar_timing: 'post_prandial', weight_kg: '72.5' }
  assert.deepEqual(vitalsSummary(v), {
    bp: '170/105', pulse: '88/min', temperature: '98.4 °F', spo2: '97%',
    sugar: '260 mg/dL (post prandial)', weight: '72.5 kg',
  })
  assert.deepEqual(vitalsFlags(v), ['Blood pressure high', 'Blood sugar outside the usual range'])
  assert.deepEqual(vitalsFlags({ bp_systolic: 118, bp_diastolic: 76, pulse: 72, temperature_f: '98.2', spo2: 98 }), [])
  assert.deepEqual(vitalsFlags({ temperature_f: '101.2' }), ['Febrile'])
  assert.deepEqual(vitalsSummary({}), { bp: '—', pulse: '—', temperature: '—', spo2: '—', sugar: '—', weight: '—' })
  assert.deepEqual([canRecordVitals('assistant'), canRecordVitals('receptionist')], [true, false])
})
