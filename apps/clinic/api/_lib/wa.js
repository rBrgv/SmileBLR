// Shared WhatsApp Cloud API + SMS-fallback senders, used by send-reminders.js,
// wa-send.js, and the campaign runner so this logic lives in exactly one place.
export async function sendWhatsApp(to, template, variables) {
  const url = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(to).replace(/\D/g, ''),
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
  const url = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: String(to).replace(/\D/g, ''), type: 'text', text: { body } }),
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
