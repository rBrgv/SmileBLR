import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { receiptAmounts, invoiceNo, receiptNo } from '../src/lib/bills.js'
import { waNumber, receiptMessage } from '../src/lib/share.js'

const INV = '20000000-0000-0000-0000-000000000001'

test('receipts are numbered once per payment, in the order money was taken', async () => {
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
      // Payments the clinic had already taken before receipts were numbered,
      // inserted out of order to prove the backfill goes by when they happened.
      if (file.startsWith('027')) await db.exec(`
        INSERT INTO invoices(id, amount, tax_amount, amount_paid, payment_status) VALUES('${INV}', 10000, 0, 2000, 'partial');
        INSERT INTO invoice_payment_changes(invoice_id, old_amount, new_amount, old_status, new_status, note, created_at)
        VALUES('${INV}', 500, 2000, 'partial', 'partial', 'taken second', now() - interval '1 day'),
              ('${INV}', null, 500, 'pending', 'partial', 'taken first', now() - interval '3 days')`)
      await db.exec(await readFile(new URL(file, folder), 'utf8'))
    }

    const backfilled = (await db.query('SELECT receipt_number, note FROM invoice_payment_changes ORDER BY receipt_number')).rows
    assert.deepEqual(backfilled.map(r => [r.receipt_number, r.note]), [[1, 'taken first'], [2, 'taken second']])

    await db.exec(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)
    const user = '20000000-0000-0000-0000-000000000009'
    await db.query('INSERT INTO auth.users(id) VALUES($1)', [user])
    await db.query("INSERT INTO staff(full_name, role, user_id) VALUES('Reception','receptionist',$1)", [user])
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [user])
    await db.exec('SET ROLE authenticated')

    // Each further payment, and each correction, takes the next number.
    await db.query('SELECT record_invoice_payment($1,$2,$3,$4,$5,$6)', [INV, 6000, false, 'upi', 'part payment', 0])
    await db.query('SELECT record_invoice_payment($1,$2,$3,$4,$5,$6)', [INV, 10000, false, 'cash', 'settled', 1])
    const issued = (await db.query('SELECT receipt_number, seq, old_amount, new_amount, payment_method FROM invoice_payment_changes ORDER BY receipt_number')).rows
    assert.deepEqual(issued.map(r => r.receipt_number), [1, 2, 3, 4])
    const last = issued.at(-1)

    // A number is never reused, and staff cannot write the receipt history.
    await db.exec('RESET ROLE')
    await assert.rejects(db.query('UPDATE invoice_payment_changes SET receipt_number = 3 WHERE receipt_number = 4'), /unique|duplicate/i)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM invoice_payment_changes WHERE receipt_number IS NULL')).rows[0].n, 0)

    // What the printed receipt says the patient handed over: the difference
    // from the previous running total, not the total itself.
    const invoice = (await db.query('SELECT * FROM invoices WHERE id=$1', [INV])).rows[0]
    const a = receiptAmounts(invoice, last)
    assert.deepEqual([a.total, a.prior, a.collected, a.toDate, a.balance], [10000, 6000, 4000, 10000, 0])
    // The clinic's own format: receipt 4 of this invoice, not the 4th of the clinic.
    assert.deepEqual(issued.map(r => r.seq), [1, 2, 3, 4])
    assert.equal(receiptNo(last, invoice), `RCPT${invoice.invoice_number}-4`)
    assert.equal(receiptNo({ receipt_number: 4 }, invoice), 'RCPT000004', 'a row without a position falls back to the running number')
    assert.equal(invoiceNo(invoice), 'INV' + String(invoice.invoice_number).padStart(4, '0'))

    // A second invoice starts its own receipts at 1, while the running number carries on.
    await db.exec('RESET ROLE')
    const other = (await db.query("INSERT INTO invoices(patient_id, amount) SELECT patient_id, 1000 FROM invoices WHERE id=$1 RETURNING id", [INV])).rows[0].id
    await db.exec('SET ROLE authenticated') // still signed in as the reception user set above
    await db.query('SELECT record_invoice_payment($1,$2,$3,$4,$5,$6)', [other, 1000, false, 'cash', 'first payment', 0])
    const first = (await db.query('SELECT seq, receipt_number FROM invoice_payment_changes WHERE invoice_id=$1', [other])).rows[0]
    assert.deepEqual([first.seq, first.receipt_number], [1, 5])

    // Two receipts of one invoice can never share a position.
    await db.exec('RESET ROLE')
    await assert.rejects(db.query('UPDATE invoice_payment_changes SET seq = 1 WHERE invoice_id=$1 AND seq = 2', [INV]), /unique|duplicate/i)

    const message = receiptMessage(invoice, { full_name: 'Test patient' }, last)
    assert.match(message, /Received now: ₹4,000/)
    assert.match(message, /Nothing further due/)
  } finally { await db.close() }
})

test('WhatsApp links carry a country code, whatever the number looks like on file', () => {
  assert.equal(waNumber('9008370547'), '919008370547')
  assert.equal(waNumber('090 0837 0547'), '919008370547')
  assert.equal(waNumber('+91 90083 70547'), '919008370547')
  assert.equal(waNumber('+44 7911 123456'), '447911123456')
  assert.equal(waNumber('N/A'), null)
  assert.equal(waNumber(''), null)
  assert.equal(waNumber(null), null)
})
