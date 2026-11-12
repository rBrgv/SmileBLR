import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { recordRows } from '../src/lib/records.js'

test('staff can be edited, but the clinic can never be left without a working admin', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth;
      CREATE TABLE auth.users(id UUID PRIMARY KEY, email TEXT);
      CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      CREATE PUBLICATION supabase_realtime;
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;`)
    const folder = new URL('../../../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, folder), 'utf8'))
    await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)

    const u = { a: '60000000-0000-0000-0000-00000000000a', b: '60000000-0000-0000-0000-00000000000b', d: '60000000-0000-0000-0000-00000000000d', r: '60000000-0000-0000-0000-00000000000e' }
    for (const id of Object.values(u)) await db.query('INSERT INTO auth.users(id) VALUES($1)', [id])
    const staff = {}
    for (const [key, role] of [['a', 'admin'], ['b', 'admin'], ['d', 'doctor'], ['r', 'receptionist']])
      staff[key] = (await db.query('INSERT INTO staff(full_name, role, user_id) VALUES($1,$2,$3) RETURNING id', ['Person ' + key, role, u[key]])).rows[0].id
    const asUser = async key => {
      await db.exec('RESET ROLE')
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [u[key]])
      await db.exec('SET ROLE authenticated')
    }
    const row = async id => (await db.query('SELECT role, active, phone, specialization FROM staff WHERE id=$1', [id])).rows[0]

    // An admin can correct a doctor's details, and the change is kept.
    await asUser('a')
    await db.query("UPDATE staff SET specialization='Oral Surgery', phone='9000000000' WHERE id=$1", [staff.d])
    assert.deepEqual([(await row(staff.d)).specialization, (await row(staff.d)).phone], ['Oral Surgery', '9000000000'])
    const history = (await db.query("SELECT old_row->>'specialization' AS was, new_row->>'specialization' AS now FROM record_changes WHERE table_name='staff' AND record_id=$1", [staff.d])).rows
    assert.deepEqual(history.map(h => [h.was, h.now]), [[null, 'Oral Surgery']])

    // Nobody else can edit staff.
    for (const key of ['d', 'r']) {
      await asUser(key)
      await db.query("UPDATE staff SET phone='1' WHERE id=$1", [staff.r])
      assert.equal((await row(staff.r)).phone, null, key + ' cannot change staff details')
    }

    // With two admins, either can step down or be switched off...
    await asUser('a')
    await db.query('UPDATE staff SET active=false WHERE id=$1', [staff.b])
    // ...but the only one left cannot remove themselves, however they try.
    await assert.rejects(db.query("UPDATE staff SET role='doctor' WHERE id=$1", [staff.a]), /at least one active admin/)
    await assert.rejects(db.query('UPDATE staff SET active=false WHERE id=$1', [staff.a]), /at least one active admin/)
    await assert.rejects(db.query('UPDATE staff SET user_id=NULL WHERE id=$1', [staff.a]), /at least one active admin/)
    await assert.rejects(db.query('DELETE FROM staff WHERE id=$1', [staff.a]), /at least one active admin/)
    assert.equal((await row(staff.a)).role, 'admin')

    // Once another admin is back, stepping down is allowed.
    await db.query('UPDATE staff SET active=true WHERE id=$1', [staff.b])
    await db.query("UPDATE staff SET role='doctor' WHERE id=$1", [staff.a])
    assert.equal((await row(staff.a)).role, 'doctor')

    // An admin row that nobody can sign in as does not count, and is not protected.
    await asUser('b')
    const ghost = (await db.query("INSERT INTO staff(full_name, role) VALUES('Old admin entry','admin') RETURNING id")).rows[0].id
    await db.query('UPDATE staff SET active=false WHERE id=$1', [ghost])
    assert.equal((await row(ghost)).active, false)
  } finally { await db.close() }
})

test('several teeth make one record each, and one procedure is one follow-up call', () => {
  const base = { patient_id: 'p', notes: 'cap measurement', amount: 5000, follow_up_required: true, follow_up_date: '2026-11-14' }
  const rows = recordRows(base, [14, 24])
  assert.deepEqual(rows.map(r => r.tooth_number), [14, 24])
  assert.deepEqual(rows.map(r => r.follow_up_required), [true, false])
  assert.deepEqual(rows.map(r => r.follow_up_date), ['2026-11-14', null])
  assert.ok(rows.every(r => r.amount === 5000 && r.notes === 'cap measurement'), 'cost and notes are per record')
  assert.deepEqual(recordRows(base, []).map(r => r.tooth_number), [null], 'no tooth chosen is still one record')
  assert.equal(base.follow_up_required, true, 'the input is not changed')
})
