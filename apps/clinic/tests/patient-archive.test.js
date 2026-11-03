import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Migration 025: archiving is admin-only and refuses a patient who still has
// money or clinical history attached.
test('patients archive only when empty, and only for an admin', async () => {
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

    const users = { admin: '20000000-0000-0000-0000-000000000001', doctor: '20000000-0000-0000-0000-000000000002' }
    for (const [role, id] of Object.entries(users)) {
      await db.query('INSERT INTO auth.users(id) VALUES($1)', [id])
      await db.query('INSERT INTO staff(full_name,role,user_id) VALUES($1,$1,$2)', [role, id])
    }
    const as = async role => {
      await db.exec('RESET ROLE')
      await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [users[role]])
      await db.exec('SET ROLE authenticated')
    }

    await as('admin')
    const empty = (await db.query("INSERT INTO patients(full_name) VALUES('Test entry') RETURNING id")).rows[0].id
    const billed = (await db.query("INSERT INTO patients(full_name) VALUES('Has a bill') RETURNING id")).rows[0].id
    const treated = (await db.query("INSERT INTO patients(full_name) VALUES('Has history') RETURNING id")).rows[0].id
    await db.query("INSERT INTO invoices(patient_id,amount) VALUES($1,500)", [billed])
    await db.query("INSERT INTO treatment_records(patient_id,notes) VALUES($1,'Scaling')", [treated])

    await as('doctor')
    await assert.rejects(db.query('SELECT archive_patient($1)', [empty]), /Only an admin/,
      'a doctor cannot archive a patient')

    await as('admin')
    await assert.rejects(db.query('SELECT archive_patient($1)', [billed]), /invoice/,
      'a patient with an invoice must be merged, not hidden')
    await assert.rejects(db.query('SELECT archive_patient($1)', [treated]), /treatment record/,
      'a patient with clinical history must be merged, not hidden')

    await db.query('SELECT archive_patient($1)', [empty])
    const { rows } = await db.query('SELECT deleted_at FROM patients WHERE id=$1', [empty])
    assert.notEqual(rows[0].deleted_at, null, 'the empty test entry archives')

    // Restoring is an ordinary update, the same as every other trashed record.
    await db.query('UPDATE patients SET deleted_at=NULL WHERE id=$1', [empty])
    assert.equal((await db.query('SELECT deleted_at FROM patients WHERE id=$1', [empty])).rows[0].deleted_at, null)
  } finally { await db.close() }
})
