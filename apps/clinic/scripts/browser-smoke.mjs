// Local browser smoke test. All Supabase requests are intercepted; no live records are read or written.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
import assert from 'node:assert/strict'
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const context = await browser.newContext({ timezoneId: 'Asia/Kolkata' })
const patients = Array.from({ length: 825 }, (_, i) => ({ id: `00000000-0000-0000-0001-${String(i).padStart(12,'0')}`, full_name: `Patient ${String(i).padStart(4,'0')}`, phone: i % 2 ? null : '9000000000', created_at: '2026-09-01T00:00:00Z', tags: [] }))
const doctor = { id: '00000000-0000-0000-0002-000000000001', full_name: 'Test Doctor', role: 'doctor', active: true }
const inv = { id: '00000000-0000-0000-0003-000000000001', patient_id: patients[0].id, amount: 10000, tax_amount: 1800, amount_paid: 4000, payment_version: 0, payment_status: 'partial', invoice_date: '2026-09-14', patients: patients[0], staff: doctor }
const appt = { id: '00000000-0000-0000-0004-000000000001', patient_id: patients[0].id, doctor_id: doctor.id, appointment_time: '2026-09-14T04:30:00Z', duration_minutes: 30, status: 'scheduled', updated_at: '2026-09-01T00:00:00Z', patients: patients[0], staff: doctor }
const writes = []
await context.addInitScript(() => {
  const b = obj => btoa(JSON.stringify(obj))
  const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'test@example.invalid' }
  localStorage.setItem('sb-cdvrkcrcpmaqaaffdfgm-auth-token', JSON.stringify({ access_token: b({ alg:'HS256',typ:'JWT' })+'.'+b({ sub:user.id,exp:4102444800 })+'.test', refresh_token: 'test', expires_at:4102444800, expires_in:3600, token_type:'bearer',user }))
})
await context.route('**/*.supabase.co/**', async route => {
  const req = route.request(), u = new URL(req.url()), table = u.pathname.split('/').at(-1)
  if (req.method() === 'OPTIONS') return route.fulfill({ status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'} })
  let data = []
  if (req.method() !== 'GET' && req.method() !== 'HEAD') {
    const body = req.postDataJSON(); writes.push({ table, body })
    if (table === 'record_invoice_payment') { inv.amount_paid=body.p_amount; inv.payment_version++; inv.payment_status=body.p_amount===11800?'paid':'partial' }
    if (table === 'appointments') { data = Array.isArray(body) ? body.map((a,i)=>({...a,id:String(i)})) : [{...appt,...body}]; if(req.method()==='PATCH') Object.assign(appt,body) }
    if (table === 'import_patient') data = { id: 'new',status:'imported' }
  } else if (table === 'staff') data = u.searchParams.get('select') === 'role' ? [{role:'admin'}] : [doctor]
  else if (table === 'patients') {
    data = patients
    if (u.searchParams.has('id')) data = data.filter(p => p.id===u.searchParams.get('id').replace('eq.',''))
    if (u.searchParams.has('or')) data = data.filter(p => u.searchParams.get('or').includes(p.full_name))
  } else if (table === 'appointments') data = [appt]
  else if (table === 'invoices') data = [inv]
  const count = Array.isArray(data) ? data.length : 1
  if (Array.isArray(data)) { const offset=Number(u.searchParams.get('offset')||0), limit=Number(u.searchParams.get('limit')||1000); data=data.slice(offset,offset+limit) }
  if (req.headers().accept?.includes('vnd.pgrst.object')) data=data[0]||null
  await route.fulfill({ status:200, contentType:'application/json', headers:{'access-control-allow-origin':'*','access-control-expose-headers':'content-range','content-range':`0-${Math.max(0,count-1)}/${count}`}, body:JSON.stringify(data) })
})
const page=await context.newPage(), errors=[]
page.on('pageerror', e=>errors.push(e.message))
try {
  await page.goto('http://127.0.0.1:5173/patients')
  await page.getByText('Page 1 · 825 patients').waitFor()
  await page.getByPlaceholder('Search name / phone…').fill('Patient 0824')
  await page.getByRole('cell',{name:'Patient 0824',exact:true}).waitFor()
  await page.getByRole('button',{name:'Import CSV',exact:true}).click()
  await page.locator('input[type=file]').setInputFiles({name:'test.csv',mimeType:'text/csv',buffer:Buffer.from('Patient ID,Full Name,Phone Number\nsmoke,Example,\n')})
  await page.getByRole('button',{name:'Import 1 patients',exact:true}).click()
  await page.getByText('Imported: 1 · Already imported: 0 · Failed: 0').waitFor()
  await page.goto('http://127.0.0.1:5173/invoices')
  await page.getByRole('button',{name:'Record payment'}).click()
  await page.locator('input[type=number]').fill('6000')
  await page.locator('.modal input:not([type=number]):not([type=checkbox])').fill('UPI receipt test')
  await page.getByRole('button',{name:'Save payment',exact:true}).click()
  await page.getByText('₹5,800',{exact:true}).waitFor()
  await page.goto('http://127.0.0.1:5173/appointments')
  await page.getByRole('button',{name:'Edit / reschedule',exact:true}).click()
  await page.locator('.modal input[type=date]').fill('2026-09-16')
  await page.getByRole('button',{name:'Save appointment',exact:true}).click()
  await page.getByText('Appointment updated',{exact:true}).waitFor()
  assert.equal(appt.appointment_time,'2026-09-16T04:30:00.000Z')
  await page.getByRole('button',{name:'+ New appointment',exact:true}).click()
  await page.locator('.modal input[type=date]').fill('2026-09-14')
  await page.getByRole('checkbox',{name:'Repeat this appointment'}).check()
  await page.getByRole('button',{name:'Save appointment',exact:true}).click()
  await page.getByText('4 appointment(s) created',{exact:true}).waitFor()
  const series = writes.find(w=>w.table==='appointments'&&Array.isArray(w.body)).body
  assert.equal(series[0].appointment_time,'2026-09-14T04:30:00.000Z')
  await page.goto('http://127.0.0.1:5173/data-export')
  const downloadPromise=page.waitForEvent('download')
  await page.getByRole('button',{name:'Download all records (JSON)'}).click()
  const download=await downloadPromise
  const stream=await download.createReadStream();let body='';for await(const chunk of stream)body+=chunk
  const snapshot=JSON.parse(body);assert.equal(snapshot.counts.patients,825);assert.ok(snapshot.tables.medical_history)
  assert.deepEqual(errors,[])
  console.log('PASS: browser search beyond 500, source-ID import, payment entry, reschedule, recurring dates, complete paginated JSON export; no page errors. All API traffic mocked.')
} finally { await browser.close() }
