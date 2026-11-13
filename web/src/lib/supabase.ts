import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !key) {
  throw new Error(
    'Не заданы VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY. Скопируйте .env.example в .env.local и заполните.',
  )
}

// ───── Демо-режим ─────
// Отдельная база с вымышленными данными. Режим включается кнопкой на странице входа
// и запоминается в браузере; боевая база при этом не затрагивается вовсе.
const demoUrl = import.meta.env.VITE_DEMO_SUPABASE_URL as string | undefined
const demoKey = import.meta.env.VITE_DEMO_SUPABASE_ANON_KEY as string | undefined
const DEMO_FLAG = 'staxi.demo'

/** Демо-база настроена в этой сборке. */
export const demoAvailable = !!demoUrl && !!demoKey

function demoFlag(): boolean {
  try {
    return localStorage.getItem(DEMO_FLAG) === '1'
  } catch {
    return false
  }
}

/** Сайт сейчас работает с демо-базой. */
export const isDemo = demoAvailable && demoFlag()

/** Общеизвестная учётная запись диспетчера демо-базы. */
export const DEMO_LOGIN = 'dispatcher'
export const DEMO_PASSWORD = 'demo-2026'

export const supabase = isDemo
  ? // отдельное хранилище сессии, чтобы демо-вход не затирал боевой
    createClient(demoUrl!, demoKey!, { auth: { storageKey: 'staxi-demo-auth' } })
  : createClient(url, key)

export function enterDemo() {
  try {
    localStorage.setItem(DEMO_FLAG, '1')
  } catch {
    return
  }
  window.location.assign('/')
}

export async function exitDemo() {
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    /* выходим из демо в любом случае */
  }
  try {
    localStorage.removeItem(DEMO_FLAG)
  } catch {
    /* хранилище недоступно */
  }
  window.location.assign('/')
}

/** Логины хранятся как служебные адреса почты. */
export const EMAIL_DOMAIN = 'soctaxi.local'
export const loginToEmail = (login: string) => `${login.trim().toLowerCase()}@${EMAIL_DOMAIN}`

/** Вызов серверной функции управления сотрудниками. */
export async function adminUsers(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })
  if (error) {
    // Текст ошибки функция возвращает в теле ответа.
    let message = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.json()
        if (parsed?.error) message = parsed.error
      } catch {
        /* оставляем исходное сообщение */
      }
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
}
