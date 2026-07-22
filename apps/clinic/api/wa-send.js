// Vercel serverless function — WhatsApp sends stay server-side.
// POST /api/wa-send  { to, template, language?, components? }
// Header: x-api-key must match INTERNAL_API_KEY.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (req.headers['x-api-key'] !== process.env.INTERNAL_API_KEY)
    return res.status(401).json({ error: 'Unauthorized' })

  const { to, template = 'hello_world', language = 'en_US', components = [] } = req.body || {}
  if (!to) return res.status(400).json({ error: 'to is required' })

  const url = `https://graph.facebook.com/v18.0/${process.env.WA_PHONE_NUMBER_ID}/messages`
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WA_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: String(to).replace(/\D/g, ''),
      type: 'template',
      template: { name: template, language: { code: language }, components },
    }),
  })
  const data = await r.json()
  return res.status(r.ok ? 200 : 502).json(data)
}
