import { useState } from 'react'
import type { FormEvent } from 'react'
import { Button, ErrorNote, Field } from '../components/ui'
import { useAuth } from '../lib/auth'
import { demoAvailable, enterDemo, exitDemo, isDemo } from '../lib/supabase'

export function LoginPage() {
  const { signIn } = useAuth()
  const [login, setLogin] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!login.trim() || !password) {
      setError('Введите логин и пароль')
      return
    }
    setBusy(true)
    setError('')
    const problem = await signIn(login, password)
    setBusy(false)
    if (problem) setError(problem)
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-brand-900 p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-7 shadow-2xl">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-11 rounded-xl" />
          <div>
            <h1 className="text-xl leading-tight font-semibold text-slate-900">Социальное такси</h1>
            <p className="text-sm text-slate-500">Диспетчерская</p>
          </div>
        </div>
        <Field label="Логин">
          <input
            className="input"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
          />
        </Field>
        <Field label="Пароль">
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button variant="primary" size="lg" type="submit" busy={busy} className="w-full">
          Войти
        </Button>
        {isDemo ? (
          <p className="text-center text-sm text-slate-600">
            Включён демо-режим, но войти в демо-базу не удалось.{' '}
            <button type="button" className="font-medium text-brand-800 hover:underline" onClick={exitDemo}>
              Вернуться к обычному входу
            </button>
          </p>
        ) : (
          demoAvailable && (
            <div className="border-t border-slate-200 pt-4">
              <Button size="lg" className="w-full" onClick={enterDemo}>
                Демо-режим
              </Button>
              <p className="mt-2 text-center text-xs text-slate-500">
                Посмотреть систему на вымышленных данных — без пароля, настоящая база не затрагивается.
              </p>
            </div>
          )
        )}
      </form>
    </div>
  )
}
