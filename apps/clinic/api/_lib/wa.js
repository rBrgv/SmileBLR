// Shared WhatsApp Cloud API + SMS-fallback senders, used by send-reminders.js,
// wa-send.js, and the campaign runner so this logic lives in exactly one place.

// Numbers are stored as the front desk typed them — usually ten digits, with
// no country code — and Meta rejects those, so every send goes through here.
// Same rule as the client's waNumber() in src/lib/share.js: ten digits is an
// Indian mobile, a leading 0 or 91 is stripped to that, and anything longer
// already carries its own country code. Null means it cannot be a number.
export function waNumber(phone) {
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.length === 10) return '91' + d
  if (d.length === 11 && d.startsWith('0')) return '91' + d.slice(1)
  if (d.length === 12 && d.startsWith('91')) return d
  return d.length > 10 ? d : null
}

const NOT_A_NUMBER = { ok: false, data: { error: { message: 'Not a usable phone number' } } }

export async function sendWhatsApp(to, template, variables) {
  const number = waNumber(to)
  if (!number) return NOT_A_NUMBER
  const url = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: number,
      type: 'template',
      template: {
        name: template, language: { code: 'en' },
        components: [{ type: 'body', parameters: variables.map(v => ({ type: 'text', text: String(v) })) }],
      },
    }),
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

// Free-form text reply — only deliverable within Meta's 24h customer-service
// window after the recipient messaged in, which every caller of this
// (webhook replies, bot replies, escalations of an inbound message) satisfies.
export async function sendText(to, body) {
  const number = waNumber(to)
  if (!number) return NOT_A_NUMBER
  const url = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: number, type: 'text', text: { body } }),
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}

export async function sendSMS(to, body) {
  if (!process.env.TWILIO_ACCOUNT_SID) return { ok: false, skipped: true }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`
  const params = new URLSearchParams({
    To: '+91' + String(to).replace(/\D/g, '').slice(-10),
    From: process.env.TWILIO_FROM_NUMBER,
    Body: body,
  })
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  })
  return { ok: r.ok, data: await r.json().catch(() => ({})) }
}
