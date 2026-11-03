import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

// Migration 022: a patient with only a recorded age must still be treated as a
// minor for consent. Replays every migration against a real Postgres.
test('guardian consent is required for a minor known only by recorded age', async () => {
  const db = new PGlite()
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      CREATE PUBLICATION supabase_realtime; GRANT USAGE ON SCHEMA public,auth TO authenticated;`)
    const folder = new URL('../../../supabase/migrations/', import.meta.url)
    for (const file of (await readdir(folder)).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, folder), 'utf8'))
    }

    const signed = { statement: 'Extraction of tooth 36', signature: 'data:image/png;base64,AAAA' }
    const add = async (cols, values) =>
      (await db.query(`INSERT INTO patients(${cols}) VALUES(${values}) RETURNING id`)).rows[0].id

    const child = await add('full_name,approx_age,approx_age_recorded_on', `'Child','7',current_date`)
    const adult = await add('full_name,approx_age,approx_age_recorded_on', `'Adult','40',current_date`)
    const borderline = await add('full_name,approx_age,approx_age_recorded_on', `'Borderline','17',current_date`)
    const grown = await add('full_name,approx_age,approx_age_recorded_on', `'Grown','17',current_date - interval '2 years'`)
    const unknown = await add('full_name', `'Unknown age'`)

    const consentAs = (patient, kind) => db.query(
      `INSERT INTO consent_forms(patient_id,procedure,consent_given,statement,signature_data,signer_kind,signer_name,guardian_relationship)
       VALUES($1,'Extraction',true,$2,$3,$4,'Signer',CASE WHEN $4='guardian' THEN 'Mother' END)`,
      [patient, signed.statement, signed.signature, kind])

    await assert.rejects(consentAs(child, 'patient'), /guardian consent for a minor/,
      'a 7-year-old known only by age must not sign for themselves')
    await assert.rejects(consentAs(borderline, 'patient'), /guardian consent for a minor/,
      'recorded 17 today could still be 17, so treat as a minor')

    await consentAs(child, 'guardian')
    await consentAs(adult, 'patient')
    await consentAs(grown, 'patient')      // recorded 17 two years ago: now 19
    await consentAs(unknown, 'patient')    // age unknown: the form still records who signed

    const { rows } = await db.query('SELECT count(*)::int AS n FROM consent_forms WHERE consent_given')
    assert.equal(rows[0].n, 4)
  } finally { await db.close() }
})
