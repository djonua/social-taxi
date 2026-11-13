import type { Session } from '@supabase/supabase-js'
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { DEMO_LOGIN, DEMO_PASSWORD, isDemo, loginToEmail, supabase } from './supabase'
import type { Profile } from './types'

interface AuthState {
  loading: boolean
  session: Session | null
  profile: Profile | null
  /** Вошёл, но это не сотрудник диспетчерской (водитель или отключён). */
  denied: boolean
  signIn: (login: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session && isDemo) {
        // В демо-режиме входим сами: пароль не нужен, данные вымышленные.
        const res = await supabase.auth.signInWithPassword({
          email: loginToEmail(DEMO_LOGIN),
          password: DEMO_PASSWORD,
        })
        if (res.data.session) return // остальное сделает onAuthStateChange
      }
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setProfile(null)
        setProfileLoaded(false)
        setLoading(false)
      }
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return
        setProfile((data as Profile | null) ?? null)
        setProfileLoaded(true)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [userId])

  const signIn = useCallback(async (login: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: loginToEmail(login),
      password,
    })
    if (!error) return null
    if (/invalid login credentials/i.test(error.message)) return 'Неверный логин или пароль'
    if (/banned/i.test(error.message)) return 'Учётная запись отключена'
    if (/fetch/i.test(error.message)) return 'Нет связи с сервером'
    return error.message
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const value = useMemo<AuthState>(() => {
    const isStaff =
      !!profile && profile.is_active && (profile.role === 'admin' || profile.role === 'dispatcher')
    return {
      loading,
      session,
      profile: isStaff ? profile : null,
      denied: !!session && profileLoaded && !isStaff,
      signIn,
      signOut,
    }
  }, [loading, session, profile, profileLoaded, signIn, signOut])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth вне AuthProvider')
  return ctx
}
