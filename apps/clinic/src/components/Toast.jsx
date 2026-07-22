import { createContext, useContext, useState, useCallback, useRef } from 'react'

const ToastCtx = createContext(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }) {
  const [item, setItem] = useState(null) // { msg, actionLabel, onAction }
  const timerRef = useRef(null)

  // toast('message') or toast('message', { actionLabel: 'Undo', onAction: fn })
  const toast = useCallback((msg, opts) => {
    clearTimeout(timerRef.current)
    setItem({ msg, ...opts })
    timerRef.current = setTimeout(() => setItem(null), opts?.actionLabel ? 5000 : 2600)
  }, [])

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      {item && (
        <div className="toast">
          {item.msg}
          {item.actionLabel && (
            <button className="toast-action" onClick={() => { item.onAction?.(); clearTimeout(timerRef.current); setItem(null) }}>
              {item.actionLabel}
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  )
}
