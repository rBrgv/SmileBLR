# Smile Bengaluru clinic app: user guide

For doctors, reception and assistants. Read sections 1 and 2 first, then use the rest when you need them.

---

## 1. The idea in one minute

Every patient has **one page**. Everything about them is on it: history, teeth, visits, plans, bills. You do not hunt through menus. Find the patient, open the page, work from the tabs.

Three things are good to know:

- **You can edit anything.** If you type something wrong, open it and fix it. The app keeps the old version in the background, so nothing is lost and nobody gets stuck.
- **Only a name is needed to register a patient.** Add the rest when you have it.
- **You enter age, not date of birth.** Type the age as it is today. The app moves it forward by itself as the years pass.

Address: <https://smileblr-clinic.vercel.app>. Sign in with your email and password. If it says your login is "not linked to an active staff account", ask the admin.

---

## 2. Who can do what

| What you can do | Doctor | Reception | Assistant | Admin |
|---|:--:|:--:|:--:|:--:|
| Register patients, book appointments | Yes | Yes | Yes | Yes |
| Bills, payments, receipts | Yes | Yes | Yes | Yes |
| Record vitals (BP, pulse, sugar…) | Yes | No | Yes | Yes |
| Medical history, tooth chart, consultation notes | Yes | No | No | Yes |
| Prescriptions, treatment plans, treatment records | Yes | No | No | Yes |
| Consent forms | Yes | No | No | Yes |
| Merge two records of the same person | Yes | No | No | Yes |
| Delete a record (goes to Trash first) | Yes | No | No | Yes |
| Archive a patient, add staff, clinic settings, WhatsApp conversations, activity log | No | No | No | Yes |

A grey or disabled button means your role cannot do that. It is not broken.

---

## 3. A patient's journey, step by step

### Step 1: Patient arrives or messages

**New patient**

1. **Patients → + New patient**.
2. Type the name. Add phone, age (as of today), gender and the **clinic file number** if they have a paper file.
3. **Save patient**.

If the name and age look like someone already registered, the app shows a warning. It does not stop you. Check before saving, because duplicates are annoying to clean up.

**Existing patient:** use the search box at the top of **Patients**. The list is in alphabetical order. You can search by **name, phone, patient ID (like SB00001), or the clinic file number**.

**Patient messages on WhatsApp:** the assistant replies on its own (see section 5). Anything new appears under **Bookings**.

### Step 2: Book the appointment

1. **Appointments → + New appointment**, or open the patient and use **+ Appointment**.
2. Choose patient, doctor, treatment, date and time. Save.
3. To move it, click **Edit / reschedule**.

Appointment status moves like this: *scheduled → confirmed → in progress → completed*. It can also be *cancelled* or *no show*. A reason is asked for those two.

When you mark a visit **completed**, the app automatically schedules the patient's next check-up reminder (6 months by default). You do not set recalls by hand.

**Print day** on the Appointments screen prints the day's list for the doctor.

### Step 3: The patient is in the chair

Open the patient. Work through the tabs:

**Vitals & Charts** *(assistant or doctor)*

- **+ Record vitals**: BP, pulse, temperature, SpO₂, blood sugar (say if fasting, after food or random), weight. Fill only what you measured.
- If a reading is worrying (very high BP, fever, low SpO₂, sugar far out of range), a **red warning strip** appears at the top of the patient's page, next to any allergy alert. Look at it before starting.
- The **tooth chart** is on the same tab. Tap a tooth to record its condition.

**Medical History** *(doctor)*
Conditions, allergies, current medicines, pregnancy, notes. **Allergies show in red at the top of the patient page every time**, so they are never missed.

**Consultations** *(doctor)*
**+ Consultation** records the complaint, examination, diagnosis, what was done and the plan for next time. It saves the medical history as it stood that day.

- Typo? Click **Edit** and fix it.
- Something added later that should be visible as *added later*? Use **Add dated amendment**.

### Step 4: Plan the treatment

For anything that takes more than one visit.

1. **Treatment Plans → + New plan**. Choose the patient. You can start from a saved template.
2. **+ Add stage** for each step (for example: root canal, then crown). Give each an estimated cost.
3. Show the patient the estimate: **Print estimate**, or **Share** to send it on WhatsApp.
4. **Get patient approval**. The patient signs on screen.

Inside a plan, one row of buttons does the next things:

| Button | What it does |
|---|---|
| **Create invoice** | Makes a bill with the stages and costs already filled in |
| **Share** | Sends the estimate to the patient on WhatsApp |
| **Print estimate** | Prints it |
| **Sign consent** | Creates the consent form and goes straight to the signature |
| **Consultation summary** | Takes you to the patient's consultations |

Each stage has a status: **Planned, Scheduled, In progress, Completed, Not Treated**. Use *Not Treated* when the patient chose to skip it.

To correct a plan, click **Edit plan** (description and estimate) or **Edit** on a stage (number, description, cost). If you change a stage's cost, **Edit plan** shows what the stages now add up to, with one click to use it.

### Step 5: Consent

1. Open **Sign consent** from the plan, or go to **Consent Forms → + New form**.
2. Pick a clinic-approved template, or write the wording for this procedure.
3. **Mark signed**: the patient signs on screen, or you paste a link to a signed document.
4. **For a patient under 18, choose "Guardian"** and enter the guardian's name and relationship. The app will not accept the child's own signature.

If something was entered wrongly on a signed form, click **Correct**. The original signing date stays.

### Step 6: Record what was done

- **From a plan:** click **Log treatment** on the stage. Fill in tooth, notes, follow-up.
- **Without a plan:** patient page → **Treatment Records → + New record**.
- **Several teeth for one procedure** (for example, caps measured for two teeth): choose every tooth in the **Tooth number(s)** box. One record is saved for each tooth.
- **Cost, units and discount:** type the **cost each**, how many **units**, and any **discount** in rupees. The form shows the total as you type. With several teeth, each tooth gets the same units and cost. Leave the cost empty if unknown.
- **Status:** *Planned, In Progress, Completed or Not Treated*. Change it straight from the list. Work marked Not Treated is left out of the totals.
- **The treatment list** works like the old treatment screen: each procedure with units, cost, discount, total and status, with its notes underneath. Under the table you see **Total cost, Total discount and Grand total**, then **Billed on invoices, Received, Balance due on bills** and **Not yet billed**. Paid and balance come from the payments recorded on the bills, so they always match the receipts.
- **Wrong tooth, date or cost?** Click **Edit** on the record.
- If the patient needs a call back, tick **follow-up required**. A date is suggested; change it if you want. From that date it shows on the **Dashboard** with a **Call** button. After ringing, click **Mark called** on the treatment record so it disappears.

### Step 7: Prescription *(doctor)*

Patient page → **Prescriptions → + New prescription**. Use **+ Add medicine** for each drug (name, dose, how often, how long, instructions). The patient's allergies are shown in red while you write, and when you save the app asks you to confirm you have checked every medicine against them. **Print** gives the prescription on the clinic letterhead.

### Step 8: Bill and payment

1. Patient page → **Bills → + New invoice**. Or, from **Treatment Records**, tick the procedures and click **Create invoice**. Records already on an invoice show their invoice number, so nothing is billed twice. You can also use **Create invoice** from the plan.
2. Add each procedure with price, discount and tax. Save.
3. When money is received, click **Record payment**.
   - **Enter the total received so far, not just today's amount.** If the patient already paid ₹2,000 and pays ₹3,000 more, enter **5,000**.
   - Choose cash, card or UPI and write a short reference.
4. Every payment gets its own numbered **receipt**, written like **RCPT26-1** (receipt 1 of invoice 26). Click **Receipt** to print it. It shows the receipt number, the invoice it belongs to, what was received, the balance, and the amount in words.
5. **Share** next to a bill or receipt opens WhatsApp with the amounts written out, ready to send.

If a payment was entered wrongly, just record the payment again with the correct total. A new receipt is issued, and the old one stays on file marked "superseded".

**Printing the invoice:** **Print** gives the invoice in the format patients use for insurance claims. It lists each procedure with its cost, every payment received with its receipt number, the amount received in words, and the line "This is a computer generated invoice and does not require signature". No signature is needed.

You can **Edit** a bill at any time, for example if the patient was overcharged. If the patient has paid more than the new total, the screen shows "Credit due to patient".

### Step 9: Print for the file

At the top right of every patient page:

- **Case sheet:** one page for the paper file: details, allergies, history, latest vitals, last visit, charted teeth, plans.
- **Summary:** everything done, planned and billed, with totals. Use this when a patient asks for their whole record or is referred elsewhere.
- **Label:** the patient ID and file number, large, to stick on a folder.

### Step 10: After the visit

- Mark the appointment **completed**. The next recall is scheduled.
- **Recall Reminders** lists patients due for a check-up.
- The **Dashboard** shows new enquiries, today's appointments, recalls due and follow-up calls waiting.

---

## 4. Other screens, in one line each

| Screen | Use it for |
|---|---|
| **Dashboard** | The morning view: enquiries, today, recalls, follow-ups |
| **Bookings** | Enquiries from the website and WhatsApp, including anything marked **NEEDS STAFF** |
| **Waitlist** | Patients who want an earlier slot; **Book now** when one opens |
| **X-Rays** | Upload and view X-ray images (also under the patient) |
| **Lab Orders** | Work sent to labs. Click **Received** when it comes back (the date is filled in), **Edit** to change anything, or add a note such as "remake upper". Overdue work shows a badge |
| **Referrals** | Patients referred out |
| **Insurance Claims** | Track claims |
| **Inventory** | Stock levels |
| **Treatments** | The price list. Add a new procedure here and it appears in every dropdown |
| **Staff** | Add doctors and staff, **Edit** their details (name, role, specialization, phone), invite logins, record leave *(admin)*. The last working admin cannot be demoted or switched off |
| **Duplicates** | Patients entered twice, grouped by name, with what is recorded on each. Merge the extras into the one to keep, or archive an empty one |
| **Trash** | Deleted records. **Restore** brings one back. Only doctors and admins can delete permanently |

---

## 5. The WhatsApp assistant

The clinic's WhatsApp number (**+91 91801 76530**) is answered by an assistant, day and night.

**It can:**

- Tell people the clinic hours.
- Show open slots and **book, cancel or reschedule** for patients whose phone number is saved on their record.
- Take a new person's name and reason and leave an enquiry for the front desk.

**It will not give medical advice.** If a message mentions pain, bleeding, swelling, fever, a broken tooth, an emergency, and similar words, the app:

1. Adds a row on **Bookings** starting **[NEEDS STAFF]**.
2. Sends a WhatsApp alert to the clinic's alert number.
3. Tells the patient the team will contact them, and to call the clinic or go to an emergency department if it is severe.

**Please check Bookings every day and ring anyone marked [NEEDS STAFF].** The assistant records the message. It cannot treat anyone.

**Important:** for the assistant to book or cancel, **the patient's phone number must be saved on their record.** An unknown number can only leave an enquiry.

Admins can read every conversation under **Admin → WhatsApp**, and click **Reply** to take over in WhatsApp.

**Not switched on yet:** appointment reminders and recall messages sent *by* the clinic. They need Meta to approve two message templates first. Until then, the assistant only answers people who message first.

---

## 6. Mistakes, duplicates and deletions

| Problem | What to do |
|---|---|
| Typed something wrong | Open it, **Edit**, save. The old version is kept. |
| Wrong payment amount | **Record payment** again with the right total. A new receipt is issued. |
| Signed consent has a wrong name | **Correct** on the Consent Forms screen. |
| The same person is registered twice | Open **Duplicates**, tick the record to keep, click **Merge**. Everything moves across and it cannot be undone. Or open the one to keep → **Merge a duplicate into this patient**. *(doctor, admin)* |
| A registration made by mistake, with no bills or treatment | Admin: click **Archive** on the row in **Patients**, or on the **Duplicates** screen. It is refused if there are bills or treatment, because those should be merged, not hidden. |
| Deleted something by accident | Click **Undo** on the message that appears, or open **Trash → Restore**. |
| A patient has no age | Click **Add age** on their page. |

---

## 7. A simple daily routine

**Morning**

1. Open the **Dashboard**. Look at today's appointments and follow-up calls.
2. Open **Bookings**. Reply to new enquiries. Call every **[NEEDS STAFF]** row first.
3. **Print day** for the doctors if you use paper.

**During the day**

1. Register or find the patient, book or check them in.
2. Assistant: record **vitals**. A red strip means tell the doctor.
3. Doctor: history, consultation, tooth chart, plan, prescription, treatment record.
4. Reception: invoice, **Record payment**, print or share the **receipt**.
5. Mark the appointment **completed**.

**End of day**

1. Every visit today has a status.
2. Every payment taken is recorded.
3. **Bookings** has no unanswered rows.

---

## 8. If something looks wrong

- **A button is grey:** your role does not allow it (section 2).
- **A patient is not found:** try their phone number or file number instead of the name. If they are truly missing, register them.
- **A page looks out of date:** refresh the browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows).
- **"Not linked to an active staff account":** ask the admin to link or activate your login on the **Staff** screen.
- **The WhatsApp assistant said something odd:** tell the admin. The conversation is saved and can be read.

For anything else, send the admin a screenshot and what you were trying to do.
