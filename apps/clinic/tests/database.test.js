import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

test('migrations, atomic imports, audited payments, and staff RLS', async () => {
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
      if (file.startsWith('016')) await db.exec("INSERT INTO invoices(amount,tax_amount,payment_status) VALUES(100,18,'paid'),(100,18,'partial'),(100,18,'refunded')")
      try { await db.exec(await readFile(new URL(file, folder), 'utf8')) } catch (e) { throw new Error(file + ': ' + e.message, { cause: e }) }
    }
    const legacy = (await db.query('SELECT payment_status, amount_paid FROM invoices ORDER BY payment_status')).rows
    assert.deepEqual(legacy.map(v => [v.payment_status, v.amount_paid == null ? null : Number(v.amount_paid)]), [['paid',118],['partial',null],['refunded',0]])
    await db.exec('DELETE FROM invoices')
    await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)
    const ids = { admin: '00000000-0000-0000-0000-000000000001', doctor: '00000000-0000-0000-0000-000000000002', receptionist: '00000000-0000-0000-0000-000000000003', assistant: '00000000-0000-0000-0000-000000000004', unlinked: '00000000-0000-0000-0000-000000000005', inactive: '00000000-0000-0000-0000-000000000006' }
    for (const [role, id] of Object.entries(ids)) {
      await db.query('INSERT INTO auth.users(id) VALUES ($1)', [id])
      if (role !== 'unlinked') await db.query('INSERT INTO staff(full_name, role, user_id, active) VALUES ($1,$2,$3,$4)', [role, role === 'inactive' ? 'doctor' : role, id, role !== 'inactive'])
    }
    async function as(role) {
      await db.exec('RESET ROLE')
      await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [ids[role]])
      await db.exec('SET ROLE authenticated')
    }
    async function importPatient(key, patient, medical = null) {
      const result = await db.query('SELECT import_patient($1,$2,$3) AS result', [key, JSON.stringify(patient), medical == null ? null : JSON.stringify(medical)])
      return result.rows[0].result
    }
    await as('admin')
    await db.exec("INSERT INTO activity_log(action,summary) VALUES('test','test audit')")
    const patient = { full_name: 'Test patient', phone: null, consent_given: false, import_source: { source_id: 'test-1' } }
    const imported = await importPatient('test:1', patient, { allergies: 'Example allergy', notes: 'Retained history' })
    assert.equal(imported.status, 'imported')
    assert.equal((await importPatient('test:1', patient)).status, 'already_imported')
    await assert.rejects(importPatient('test:1', { ...patient, import_source: { source_id: 'test-1', changed: true } }), /Source record changed/)
    await assert.rejects(importPatient('test:bad', { ...patient, full_name: 'Rollback patient' }, { pregnancy_status: 'invalid' }), /invalid input syntax/)
    assert.equal((await db.query("SELECT count(*)::int AS n FROM patients WHERE import_key='test:bad'")).rows[0].n, 0)
    assert.equal((await db.query('SELECT notes FROM medical_history WHERE patient_id=$1', [imported.id])).rows[0].notes, 'Retained history')
    const inv = (await db.query('INSERT INTO invoices(patient_id,amount,tax_amount) VALUES($1,10000,1800) RETURNING id', [imported.id])).rows[0].id
    const pay = (amount, version, refund = false) => db.query('SELECT record_invoice_payment($1,$2,$3,$4,$5,$6)', [inv, amount, refund, 'upi', 'Test payment', version])
    await pay(4000, 0)
    await assert.rejects(db.query('DELETE FROM invoices WHERE id=$1', [inv]), /foreign key/)
    let row = (await db.query('SELECT * FROM invoices WHERE id=$1', [inv])).rows[0]
    assert.equal(Number(row.amount_paid), 4000); assert.equal(row.payment_status, 'partial')
    await assert.rejects(pay(5000, 0), /another staff/)
    await assert.rejects(pay(5000, null), /another staff/)
    await assert.rejects(pay(12000, 1), /Invalid received/)
    await assert.rejects(db.query("UPDATE invoices SET payment_status='paid' WHERE id=$1", [inv]), /payment action/)
    await pay(11800, 1)
    await pay(0, 2, true)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_payment_changes')).rows[0].n, 3)
    await db.query('DELETE FROM invoice_payment_changes') // RLS silently affects zero rows.
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_payment_changes')).rows[0].n, 3)
    for (const role of ['doctor', 'receptionist', 'assistant']) {
      await as(role)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM patients')).rows[0].n, 1)
      await assert.rejects(importPatient('test:forbidden', patient), /Admin access/)
      await assert.rejects(db.query("INSERT INTO staff(full_name,role) VALUES('Forbidden','admin')"), /row-level security/)
      await db.exec('DELETE FROM activity_log')
      assert.equal((await db.query('SELECT count(*)::int AS n FROM activity_log')).rows[0].n, 0)
      if (role !== 'doctor') { await db.query('DELETE FROM patients WHERE id=$1',[imported.id]); assert.equal((await db.query('SELECT count(*)::int AS n FROM patients')).rows[0].n, 1) }
      await pay(100, role === 'doctor' ? 3 : role === 'receptionist' ? 4 : 5)
    }
    for (const role of ['unlinked', 'inactive']) {
      await as(role)
      assert.equal((await db.query('SELECT count(*)::int AS n FROM patients')).rows[0].n, 0)
      await assert.rejects(pay(200, 6), /Active staff/)
      await assert.rejects(db.query("INSERT INTO patients(full_name) VALUES('Forbidden')"), /row-level security/)
    }
  } finally { await db.close() }
})
