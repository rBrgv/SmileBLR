// Rupees in words, for the line every Indian receipt carries under the total.
// Indian grouping (crore, lakh, thousand), not the short scale.
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

const under100 = n => n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10] : '')
// "One Thousand and Fifty", but "One Thousand One Hundred Fifty" — the "and"
// goes in only before a final group below a hundred, as it is spoken. A count
// in front of crore or lakh is read plainly: "One Hundred Twenty Three Crore".
function words(n, and = true) {
  const join = (head, rest) => rest ? head.concat(and && rest < 100 ? ['and'] : [], words(rest, and)) : head
  if (n >= 10000000) return join(words(Math.floor(n / 10000000), false).concat('Crore'), n % 10000000)
  if (n >= 100000) return join(words(Math.floor(n / 100000), false).concat('Lakh'), n % 100000)
  if (n >= 1000) return join(words(Math.floor(n / 1000), false).concat('Thousand'), n % 1000)
  if (n >= 100) return join([ONES[Math.floor(n / 100)], 'Hundred'], n % 100)
  return [under100(n)]
}

export function numberInWords(value) {
  const n = Math.floor(Math.abs(Number(value) || 0))
  return n === 0 ? 'Zero' : words(n).join(' ')
}

export function rupeesInWords(amount) {
  const paisa = Math.round(Math.abs(Number(amount) || 0) * 100)
  const paise = paisa % 100
  return 'Rupees ' + numberInWords(Math.floor(paisa / 100))
    + (paise ? ' and ' + numberInWords(paise) + ' Paise' : '') + ' Only'
}
