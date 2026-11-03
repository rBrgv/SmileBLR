import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Migration 026: nothing is locked, and every edit keeps what it replaced.
test('anything can be edited, and the previous version is kept', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE PUBLICATION supabase_realtime; GRANT USAGE ON SCHEMA public,auth TO authenticated;`)
    const folder = new URL('../../../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, folder), 'utf8'))
    }
    await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)
    const doctor = '30000000-0000-0000-0000-000000000001'
    await db.query('INSERT INTO auth.users(id) VALUES($1)', [doctor])
    await db.query("INSERT INTO staff(full_name,role,user_id) VALUES('doc','doctor',$1)", [doctor])
    await db.exec('RESET ROLE')
    await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [doctor])
    await db.exec('SET ROLE authenticated')

    const patient = (await db.query("INSERT INTO patients(full_name,approx_age,approx_age_recorded_on) VALUES('Edit me',40,current_date) RETURNING id")).rows[0].id

    // An issued invoice, then paid, then corrected — all of which 017 refused.
    const items = JSON.stringify([{ description: 'Root canal', quantity: 1, unit_price: 7000, discount: 0, tax_rate: 0 }])
    const inv = (await db.query("INSERT INTO invoices(patient_id,amount,items) VALUES($1,0,$2::jsonb) RETURNING id, amount", [patient, items])).rows[0]
    assert.equal(Number(inv.amount), 7000, 'totals still come from the line items')

    await db.query("SELECT record_invoice_payment($1,7000,false,'cash','Paid in full',0)", [inv.id])
    const corrected = JSON.stringify([{ description: 'Root canal', quantity: 1, unit_price: 6000, discount: 0, tax_rate: 0 }])
    await db.query("UPDATE invoices SET items=$2::jsonb WHERE id=$1", [inv.id, corrected])
    assert.equal(Number((await db.query('SELECT amount FROM invoices WHERE id=$1', [inv.id])).rows[0].amount), 6000,
      'a paid invoice can be corrected and re-totals itself')

    // A direct payment correction, no longer refused.
    await db.query("UPDATE invoices SET amount_paid=6000 WHERE id=$1", [inv.id])

    // And the overcharge case the old constraint made impossible: 7000 was
    // taken, the charge is corrected to 6000, so the patient is owed 1000.
    await db.query("UPDATE invoices SET amount_paid=7000 WHERE id=$1", [inv.id])
    const owed = (await db.query('SELECT amount, amount_paid FROM invoices WHERE id=$1', [inv.id])).rows[0]
    assert.equal(Number(owed.amount_paid) - Number(owed.amount), 1000, 'the overpayment stands as a credit')

    // Signed consent, then corrected.
    const consent = (await db.query(`INSERT INTO consent_forms(patient_id,procedure,consent_given,statement,signature_data,signer_kind,signer_name)
      VALUES($1,'Extraction',true,'Agreed statement','data:image/png;base64,AAA','patient','Edit me') RETURNING id, signed_date`, [patient])).rows[0]
    await db.query("UPDATE consent_forms SET statement='Corrected statement' WHERE id=$1", [consent.id])
    const after = (await db.query('SELECT statement, signed_date FROM consent_forms WHERE id=$1', [consent.id])).rows[0]
    assert.equal(after.statement, 'Corrected statement', 'a signed consent can be corrected')
    assert.deepEqual(after.signed_date, consent.signed_date, 'correcting it does not re-date the signature')

    // The evidence rules still bite.
    await assert.rejects(db.query("UPDATE consent_forms SET signature_data=NULL, document_url=NULL WHERE id=$1", [consent.id]),
      /Capture a signature/, 'consent still cannot be left without evidence')

    // Everything above was recorded.
    const changes = (await db.query(`SELECT table_name, count(*)::int AS n FROM record_changes GROUP BY table_name ORDER BY table_name`)).rows
    const byTable = Object.fromEntries(changes.map(r => [r.table_name, r.n]))
    assert.ok(byTable.invoices >= 2, 'invoice edits are kept')
    assert.equal(byTable.consent_forms, 1, 'the consent correction is kept')
    const inv_change = (await db.query(`SELECT old_row, new_row, changed_by FROM record_changes WHERE table_name='invoices' ORDER BY changed_at LIMIT 1`)).rows[0]
    assert.equal(inv_change.changed_by, doctor, 'who made the change is recorded')
    assert.ok(inv_change.old_row.items, 'the replaced version is kept in full')

    // Staff cannot quietly tidy the history away. With no write policy, a
    // delete removes nothing rather than raising — so count, don't expect a throw.
    const before = (await db.query('SELECT count(*)::int AS n FROM record_changes')).rows[0].n
    await db.query('DELETE FROM record_changes')
    await assert.rejects(db.query("INSERT INTO record_changes(table_name,record_id,old_row,new_row) VALUES('invoices',gen_random_uuid(),'{}','{}')"),
      /row-level security/, 'and cannot forge an entry')
    assert.equal((await db.query('SELECT count(*)::int AS n FROM record_changes')).rows[0].n, before, 'the history survives a delete attempt')
  } finally { await db.close() }
})
