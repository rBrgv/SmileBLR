import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { costTotal, costSummary } from '../src/lib/records.js'

test('a procedure carries its cost; the backfill copies only what is unambiguous and leaves no false history', async () => {
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
      // Records as they stood before 031: one plan line with a single record,
      // one line covering two teeth, one with no cost, one record with no line.
      if (file.startsWith('031')) await db.exec(`
        INSERT INTO patients(full_name) VALUES('Cost test patient');
        INSERT INTO treatment_plans(patient_id, plan_description) SELECT id, 'Plan' FROM patients WHERE full_name='Cost test patient';
        INSERT INTO treatment_plan_stages(plan_id, stage_number, description, estimated_cost)
          SELECT id, n, d, c FROM treatment_plans, (VALUES (1,'single tooth line',5000),(2,'two teeth line',6000),(3,'no cost line',0)) AS v(n,d,c);
        INSERT INTO treatment_records(patient_id, stage_id, tooth_number, notes)
          SELECT p.id, s.id, t, 'seed'
          FROM patients p, treatment_plan_stages s, (VALUES (1,11),(2,21),(2,22),(3,31)) AS v(n,t)
          WHERE p.full_name='Cost test patient' AND s.stage_number=v.n;
        INSERT INTO treatment_records(patient_id, tooth_number, notes) SELECT id, 41, 'no line' FROM patients WHERE full_name='Cost test patient';`)
      await db.exec(await readFile(new URL(file, folder), 'utf8'))
    }
    const rows = (await db.query("SELECT tooth_number AS tooth, amount FROM treatment_records ORDER BY tooth_number")).rows
    const amountOf = tooth => rows.find(r => r.tooth === tooth).amount
    assert.equal(Number(amountOf(11)), 5000, 'a line with one record gives that record its cost')
    assert.equal(amountOf(21), null, 'a line covering two teeth is not split')
    assert.equal(amountOf(22), null)
    assert.equal(amountOf(31), null, 'a line with no cost leaves no cost')
    assert.equal(amountOf(41), null, 'a record with no line is not priced from the list')
    assert.equal((await db.query("SELECT count(*)::int AS n FROM record_changes WHERE table_name='treatment_records'")).rows[0].n, 0, 'the backfill is not recorded as anyone\'s edit')

    // The trigger was restored, so a real edit is recorded and carries its cost.
    await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)
    const ids = { doctor: '50000000-0000-0000-0000-000000000001', receptionist: '50000000-0000-0000-0000-000000000002' }
    for (const [role, id] of Object.entries(ids)) {
      await db.query('INSERT INTO auth.users(id) VALUES($1)', [id])
      await db.query('INSERT INTO staff(full_name, role, user_id) VALUES($1,$1,$2)', [role, id])
    }
    const as = async role => {
      await db.exec('RESET ROLE')
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids[role]])
      await db.exec('SET ROLE authenticated')
    }
    await as('doctor')
    await db.query("UPDATE treatment_records SET amount = 2500.50 WHERE tooth_number = 21")
    assert.equal(Number((await db.query('SELECT amount FROM treatment_records WHERE tooth_number=21')).rows[0].amount), 2500.5)
    const logged = (await db.query("SELECT old_row->>'amount' AS was, new_row->>'amount' AS now FROM record_changes WHERE table_name='treatment_records'")).rows
    assert.deepEqual(logged.map(l => [l.was, l.now]), [[null, '2500.50']])
    await assert.rejects(db.query('UPDATE treatment_records SET amount = -1 WHERE tooth_number = 21'), /check constraint/)

    // Reception cannot change a clinical record, cost included.
    await as('receptionist')
    await db.query('UPDATE treatment_records SET amount = 1 WHERE tooth_number = 21')
    await as('doctor')
    assert.equal(Number((await db.query('SELECT amount FROM treatment_records WHERE tooth_number=21')).rows[0].amount), 2500.5)
  } finally { await db.close() }
})

test('a total says how many rows it could not count', () => {
  assert.deepEqual(costTotal([{ amount: '5000.00' }, { amount: 2500.5 }, { amount: null }, {}]), { total: 7500.5, missing: 2 })
  assert.deepEqual(costTotal([]), { total: 0, missing: 0 })
  assert.equal(costSummary([{ amount: 1000 }, { amount: null }]), '₹1,000 · 1 without a cost')
  assert.equal(costSummary([{ amount: 1000 }]), '₹1,000')
})
