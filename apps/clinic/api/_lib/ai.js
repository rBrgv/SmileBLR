// Raw fetch to OpenAI's chat completions API — matches this codebase's
// existing convention of no SDK dependencies for outbound integrations
// (see sendWhatsApp/sendSMS in wa.js).
export async function chat(messages, tools) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4o-mini', messages, tools, tool_choice: 'auto' }),
  })
  const data = await r.json()
  if (!r.ok) throw new Error(data?.error?.message || 'OpenAI request failed')
  return data.choices[0].message
}
