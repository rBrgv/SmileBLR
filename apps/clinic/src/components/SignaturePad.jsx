import { useRef, useState } from 'react'

// Canvas-based signature capture — saved as a base64 PNG data URL, stored
// directly on the row (consent_forms.signature_data / treatment_plans.patient_signature_data)
// rather than in Storage, since these images are small and this avoids
// needing another bucket + policy setup.
export default function SignaturePad({ onSave, onCancel }) {
  const canvasRef = useRef(null)
  const drawing = useRef(false)
  const [empty, setEmpty] = useState(true)

  function pos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const t = e.touches?.[0]
    return { x: (t?.clientX ?? e.clientX) - rect.left, y: (t?.clientY ?? e.clientY) - rect.top }
  }
  function start(e) {
    drawing.current = true
    const { x, y } = pos(e)
    canvasRef.current.getContext('2d').beginPath()
    canvasRef.current.getContext('2d').moveTo(x, y)
  }
  function move(e) {
    if (!drawing.current) return
    e.preventDefault()
    const { x, y } = pos(e)
    const ctx = canvasRef.current.getContext('2d')
    ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#1c1c1c'
    ctx.lineTo(x, y); ctx.stroke()
    setEmpty(false)
  }
  function end() { drawing.current = false }
  function clear() {
    const c = canvasRef.current
    c.getContext('2d').clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }
  function save() {
    if (empty) return
    onSave(canvasRef.current.toDataURL('image/png'))
  }

  return (
    <div className="sig-pad">
      <canvas ref={canvasRef} width={460} height={160}
        onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
        onTouchStart={start} onTouchMove={move} onTouchEnd={end} />
      <div className="sig-actions">
        <button type="button" className="btn ghost sm" onClick={clear}>Clear</button>
        <button type="button" className="btn sm" onClick={save} disabled={empty}>Save signature</button>
        {onCancel && <button type="button" className="btn ghost sm" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  )
}
