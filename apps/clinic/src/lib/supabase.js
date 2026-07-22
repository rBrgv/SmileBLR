import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL || 'https://cdvrkcrcpmaqaaffdfgm.supabase.co'
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!key) console.warn('VITE_SUPABASE_ANON_KEY is not set — copy .env.example to .env')

export const sb = createClient(url, key || 'missing-key')
