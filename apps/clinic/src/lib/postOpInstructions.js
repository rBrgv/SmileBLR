// Matched against the treatment name — a starting point, not a clinical
// protocol; edit freely to match how this clinic actually wants it worded.
const TEMPLATES = [
  {
    match: /extraction|impaction|wisdom/i,
    title: 'After a Tooth Extraction',
    points: [
      'Bite firmly on the gauze pad for 30–45 minutes; replace if still bleeding.',
      'Avoid rinsing, spitting forcefully, or using a straw for 24 hours — this can dislodge the clot.',
      'No smoking for at least 48 hours.',
      'Eat soft, cool foods today; avoid hot or spicy food and chewing on the extraction side.',
      'Mild swelling is normal — use an ice pack outside the cheek for the first few hours.',
      'Take pain medication as prescribed; contact the clinic if pain or bleeding worsens after 24 hours.',
    ],
  },
  {
    match: /root canal|rct|pulpectomy/i,
    title: 'After Root Canal Treatment',
    points: [
      'Mild soreness for a few days is normal, especially while chewing.',
      'Avoid chewing on the treated tooth until the permanent filling/crown is placed.',
      'Take pain medication as prescribed if needed.',
      'Contact the clinic if you notice swelling, severe pain, or the temporary filling falls out.',
    ],
  },
  {
    match: /scaling|cleaning|prophylaxis/i,
    title: 'After Scaling & Cleaning',
    points: [
      'Mild gum sensitivity or slight bleeding for a day or two is normal.',
      'Avoid very hot, cold, or spicy food for 24 hours if teeth feel sensitive.',
      'Continue brushing twice daily and flossing gently.',
      'Use a soft-bristled toothbrush for the next few days.',
    ],
  },
  {
    match: /filling|restoration|composite/i,
    title: 'After a Filling',
    points: [
      'Avoid chewing on the filled tooth until numbness fully wears off (2–3 hours) to prevent biting your cheek/tongue.',
      'Mild sensitivity to hot/cold is normal for a few days.',
      'Contact the clinic if your bite feels uneven or sensitivity persists beyond a week.',
    ],
  },
  {
    match: /crown|bridge|cap/i,
    title: 'After Crown / Bridge Placement',
    points: [
      'Avoid sticky or hard foods for 24 hours, especially with a temporary crown.',
      'Mild gum tenderness around the crown is normal initially.',
      'Contact the clinic immediately if the crown feels loose or comes off.',
    ],
  },
  {
    match: /implant/i,
    title: 'After Implant Surgery',
    points: [
      'Apply an ice pack for the first 24 hours to reduce swelling.',
      'Stick to a soft diet for the first week; avoid chewing on the implant site.',
      'No smoking or alcohol during the healing period — this affects implant success.',
      'Maintain gentle oral hygiene; avoid brushing directly over the surgical site for a few days.',
      'Take all prescribed medication as directed and attend the follow-up review.',
    ],
  },
]

const DEFAULT_TEMPLATE = {
  title: 'General Post-Treatment Care',
  points: [
    'Take medication as prescribed and complete the full course.',
    'Maintain regular oral hygiene — brush gently around the treated area.',
    'Contact the clinic if you notice unusual pain, swelling, or bleeding.',
  ],
}

export function getPostOpInstructions(treatmentName) {
  return TEMPLATES.find(t => t.match.test(treatmentName || '')) || DEFAULT_TEMPLATE
}
