import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('lab work can be edited and recorded as received by any staff, and nothing is lost', async () => {
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
      // An order already marked received before this change existed.
      if (file.startsWith('030')) await db.exec(`
        INSERT INTO patients(full_name) VALUES('Legacy lab patient');
        INSERT INTO lab_orders(patient_id, lab_name, item_description, status, sent_date)
          SELECT id, 'Old lab', 'Old crown', 'received', '2026-07-19' FROM patients WHERE full_name='Legacy lab patient'`)
      await db.exec(await readFile(new URL(file, folder), 'utf8'))
    }
    const legacy = (await db.query("SELECT status, received_date, notes FROM lab_orders WHERE lab_name='Old lab'")).rows[0]
    assert.deepEqual([legacy.status, legacy.received_date, legacy.notes], ['received', null, null], 'no date is invented for work received before dates were recorded')

    await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)
    const ids = { doctor: '40000000-0000-0000-0000-000000000001', receptionist: '40000000-0000-0000-0000-000000000002', assistant: '40000000-0000-0000-0000-000000000003' }
    for (const [role, id] of Object.entries(ids)) {
      await db.query('INSERT INTO auth.users(id) VALUES($1)', [id])
      await db.query('INSERT INTO staff(full_name, role, user_id) VALUES($1,$1,$2)', [role, id])
    }
    const as = async role => {
      await db.exec('RESET ROLE')
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids[role]])
      await db.exec('SET ROLE authenticated')
    }
    await db.exec('RESET ROLE')
    const patient = (await db.query("SELECT id FROM patients WHERE full_name='Legacy lab patient'")).rows[0].id
    const order = (await db.query("INSERT INTO lab_orders(patient_id, lab_name, item_description, sent_date, expected_return_date) VALUES($1,'Dent Care','Retainers','2026-11-07','2026-11-14') RETURNING id, status", [patient])).rows[0]
    assert.equal(order.status, 'sent')

    // Reception records the work arriving, with a note about it.
    await as('receptionist')
    await db.query("UPDATE lab_orders SET status='received', received_date='2026-11-12', notes='Shade too light, remake upper' WHERE id=$1", [order.id])
    const received = (await db.query('SELECT status, received_date, notes FROM lab_orders WHERE id=$1', [order.id])).rows[0]
    assert.deepEqual([received.status, received.received_date.toISOString().slice(0, 10), received.notes], ['received', '2026-11-12', 'Shade too light, remake upper'])

    // A later correction changes the lab name; what it replaced is kept.
    await as('assistant')
    await db.query("UPDATE lab_orders SET lab_name='Max Dent Ortho Lab' WHERE id=$1", [order.id])
    const history = (await db.query("SELECT changed_by, old_row->>'lab_name' AS was, new_row->>'lab_name' AS now FROM record_changes WHERE table_name='lab_orders' AND record_id=$1 ORDER BY changed_at", [order.id])).rows
    assert.equal(history.length, 2)
    assert.deepEqual([history[1].was, history[1].now], ['Dent Care', 'Max Dent Ortho Lab'])
    assert.ok(history.every(h => h.changed_by), 'who made each edit is recorded')

    // Deleting stays with doctors and admins.
    await as('receptionist')
    await db.query('DELETE FROM lab_orders WHERE id=$1', [order.id])
    assert.equal((await db.query('SELECT count(*)::int AS n FROM lab_orders WHERE id=$1', [order.id])).rows[0].n, 1, 'reception cannot delete')
    await as('doctor')
    await db.query('DELETE FROM lab_orders WHERE id=$1', [order.id])
    assert.equal((await db.query('SELECT count(*)::int AS n FROM lab_orders WHERE id=$1', [order.id])).rows[0].n, 0, 'a doctor can')
  } finally { await db.close() }
})
