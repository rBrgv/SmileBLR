import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { ADULT_TEETH, CHILD_TEETH } from '../src/lib/teeth.js'
import { invoiceTotals } from '../src/lib/clinical.js'

test('clinical workflows preserve legacy data, validate writes, and enforce role boundaries', async () => {
 const db=new PGlite()
 try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   CREATE PUBLICATION supabase_realtime; GRANT USAGE ON SCHEMA public,auth TO authenticated;`)
  const folder=new URL('../../../supabase/migrations/',import.meta.url)
  for(const file of (await readdir(folder)).filter(f=>f.endsWith('.sql')).sort()){
   if(file.startsWith('017')) await db.exec(`INSERT INTO tooth_chart(tooth_number,notes) VALUES(5,'Legacy numbering'); INSERT INTO prescriptions(medicine_name,dosage,notes) VALUES('Legacy medicine','Recorded dose','Original note'); INSERT INTO consent_forms(procedure,consent_given) VALUES('Legacy procedure',true);`)
   await db.exec(await readFile(new URL(file,folder),'utf8'))
  }
  assert.equal((await db.query('SELECT tooth_number FROM tooth_chart')).rows[0].tooth_number,5)
  assert.equal((await db.query('SELECT medicines FROM prescriptions')).rows[0].medicines[0].name,'Legacy medicine')
  assert.equal((await db.query('SELECT statement FROM consent_forms')).rows[0].statement,null)
  await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO authenticated; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;`)
  const users={doctor:'10000000-0000-0000-0000-000000000001',admin:'10000000-0000-0000-0000-000000000002',receptionist:'10000000-0000-0000-0000-000000000003',assistant:'10000000-0000-0000-0000-000000000004'}
  const staff={}
  for(const [role,id] of Object.entries(users)){
   await db.query('INSERT INTO auth.users(id) VALUES($1)',[id]);staff[role]=(await db.query('INSERT INTO staff(full_name,role,user_id) VALUES($1,$1,$2) RETURNING id',[role,id])).rows[0].id
  }
  const as=async role=>{await db.exec('RESET ROLE');await db.query("SELECT set_config('request.jwt.claim.sub',$1,false)",[users[role]]);await db.exec('SET ROLE authenticated')}
  await as('doctor')
  const patient=(await db.query("INSERT INTO patients(full_name,date_of_birth) VALUES('Clinical test',current_date-interval '10 years') RETURNING id")).rows[0].id
  for(const table of ['tooth_chart','periodontal_readings']){
   for(const n of [...ADULT_TEETH,...CHILD_TEETH]) await db.query(`INSERT INTO ${table}(tooth_number) VALUES($1)`,[n])
   for(const n of [0,5,19,29,39,49,56,66,76,86]) await assert.rejects(db.query(`INSERT INTO ${table}(tooth_number) VALUES($1)`,[n]),/check constraint/)
  }
  const history=(await db.query("INSERT INTO medical_history(patient_id,allergies) VALUES($1,'Recorded allergy') RETURNING id",[patient])).rows[0].id
  const visit=(await db.query(`INSERT INTO consultations(patient_id,chief_complaint,examination,diagnosis,treatment_performed,next_visit_plan,history_reviewed) VALUES($1,'Complaint','Findings','Working diagnosis','No procedure today','Review',true) RETURNING *`,[patient])).rows[0]
  assert.equal(visit.recorded_by,staff.doctor);assert.equal(visit.history_snapshot.allergies,'Recorded allergy')
  await db.query("UPDATE medical_history SET allergies='Updated history' WHERE id=$1",[history])
  assert.equal((await db.query('SELECT history_snapshot FROM consultations WHERE id=$1',[visit.id])).rows[0].history_snapshot.allergies,'Recorded allergy')
  await db.query("UPDATE consultations SET diagnosis='Rewritten' WHERE id=$1",[visit.id])
  assert.equal((await db.query('SELECT diagnosis FROM consultations WHERE id=$1',[visit.id])).rows[0].diagnosis,'Working diagnosis')
  const amendment=(await db.query("INSERT INTO consultation_amendments(consultation_id,reason,note) VALUES($1,'Correction','Dated addendum') RETURNING *",[visit.id])).rows[0]
  assert.equal(amendment.recorded_by,staff.doctor)
  await db.query('DELETE FROM consultation_amendments WHERE id=$1',[amendment.id])
  assert.equal((await db.query('SELECT count(*)::int n FROM consultation_amendments')).rows[0].n,1)
  const medicines=[{name:'Test medicine A',strength:'As entered',dose:'Dose A',frequency:'Frequency A',duration:'Duration A',instructions:'Instruction A'},{name:'Test medicine B',strength:'',dose:'Dose B',frequency:'Frequency B',duration:'Duration B',instructions:''}]
  const rx=(await db.query('INSERT INTO prescriptions(patient_id,prescribed_by,medicines) VALUES($1,$2,$3) RETURNING *',[patient,staff.doctor,JSON.stringify(medicines)])).rows[0]
  assert.equal(rx.medicines.length,2);assert.equal(rx.medicine_name,'Test medicine A')
  await assert.rejects(db.query('INSERT INTO prescriptions(patient_id,prescribed_by,medicines) VALUES($1,$2,$3)',[patient,staff.doctor,JSON.stringify([{...medicines[0],frequency:''}])]),/frequency/)
  const lines=[{description:'Procedure A',tooth_number:48,quantity:2,unit_price:1000,discount:100,tax_rate:18},{description:'Procedure B',tooth_number:55,quantity:1,unit_price:500,discount:0,tax_rate:0}]
  const invoice=(await db.query('INSERT INTO invoices(patient_id,amount,tax_amount,items) VALUES($1,1,999,$2) RETURNING *',[patient,JSON.stringify(lines)])).rows[0]
  assert.equal(Number(invoice.amount),2400);assert.equal(Number(invoice.tax_amount),342)
  assert.deepEqual(invoiceTotals(lines),{net:2400,tax:342,total:2742})
  await assert.rejects(db.query('UPDATE invoices SET items=$1 WHERE id=$2',[JSON.stringify([{...lines[0],unit_price:2000}]),invoice.id]),/cannot be edited/)
  await assert.rejects(db.query('INSERT INTO invoices(patient_id,amount,items) VALUES($1,1,$2)',[patient,JSON.stringify([{...lines[0],discount:99999}])]),/Invalid invoice line/)
  const template=(await db.query("INSERT INTO consent_templates(procedure,statement) VALUES('Test procedure','Clinic approved test wording') RETURNING *")).rows[0]
  assert.equal(template.approved_by,staff.doctor)
  const consent=(await db.query('INSERT INTO consent_forms(patient_id,procedure,template_id) VALUES($1,$2,$3) RETURNING *',[patient,'ignored',template.id])).rows[0]
  assert.equal(consent.statement,template.statement)
  await assert.rejects(db.query("UPDATE consent_forms SET consent_given=true,signer_kind='guardian',signer_name='Guardian',guardian_relationship='Parent' WHERE id=$1",[consent.id]),/signature or provide/)
  await assert.rejects(db.query("UPDATE consent_forms SET consent_given=true,signer_kind='patient',signer_name='Patient',document_url='https://example.invalid/signed.pdf' WHERE id=$1",[consent.id]),/guardian consent/)
  await db.query("UPDATE consent_forms SET consent_given=true,signer_kind='guardian',signer_name='Guardian',guardian_relationship='Parent',document_url='https://example.invalid/signed.pdf' WHERE id=$1",[consent.id])
  await assert.rejects(db.query("UPDATE consent_forms SET statement='Rewritten' WHERE id=$1",[consent.id]),/cannot be rewritten/)
  const record=(await db.query("INSERT INTO treatment_records(patient_id,notes,follow_up_required) VALUES($1,'Clinical note',true) RETURNING id",[patient])).rows[0].id
  for(const role of ['receptionist','assistant']){
   await as(role)
   await assert.rejects(db.query("INSERT INTO medical_history(patient_id,allergies) VALUES($1,'Unauthorized')",[patient]),/row-level security/)
   await assert.rejects(db.query('INSERT INTO prescriptions(patient_id,prescribed_by,medicines) VALUES($1,$2,$3)',[patient,staff.doctor,JSON.stringify(medicines)]),/row-level security/)
   await assert.rejects(db.query("INSERT INTO consultations(patient_id,chief_complaint,examination,diagnosis,treatment_performed,next_visit_plan,history_reviewed) VALUES($1,'x','x','x','x','x',true)",[patient]),/row-level security/)
   await db.query("UPDATE treatment_records SET notes='Unauthorized' WHERE id=$1",[record])
   assert.equal((await db.query('SELECT notes FROM treatment_records WHERE id=$1',[record])).rows[0].notes,'Clinical note')
   await db.query('SELECT mark_followup_called($1)',[record])
   assert.equal((await db.query('SELECT follow_up_required FROM treatment_records WHERE id=$1',[record])).rows[0].follow_up_required,false)
   await db.query("INSERT INTO appointments(patient_id,appointment_time) VALUES($1,now())",[patient])
   await db.query('INSERT INTO invoices(patient_id,amount,items) VALUES($1,0,$2)',[patient,JSON.stringify(lines)])
  }
  await as('admin')
  const primary=(await db.query("INSERT INTO patients(full_name) VALUES('Merge primary') RETURNING id")).rows[0].id
  await db.query('SELECT merge_patients($1,$2)',[primary,patient])
  assert.equal((await db.query('SELECT patient_id FROM consultations WHERE id=$1',[visit.id])).rows[0].patient_id,primary)
  assert.equal((await db.query('SELECT recorded_by FROM consultations WHERE id=$1',[visit.id])).rows[0].recorded_by,staff.doctor)
 } finally {await db.close()}
})
