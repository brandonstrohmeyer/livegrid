import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  signOut as firebaseSignOut,
  getRedirectResult,
  signInWithRedirect
} from 'firebase/auth'
import { auth } from '../firebaseClient'
import { log } from '../logging.js'

const AuthContext = createContext({
  user: null,
  loading: true,
  error: null,
  signIn: () => Promise.resolve(),
  signOut: () => Promise.resolve()
})

function isStandalonePwa() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
}

function isIosSafari() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  const isIOS = /iP(ad|hone|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(ua) && !/(Chrome|CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Brave|Vivaldi)/.test(ua)
  return isIOS && isSafari
}

const provider = new GoogleAuthProvider()
provider.setCustomParameters({ prompt: 'select_account' })

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(auth))
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!auth) {
      setLoading(false)
      return () => {}
    }
    log.info('auth.init', {
      isStandalonePwa: isStandalonePwa(),
      isIosSafari: isIosSafari(),
      authDomain: auth?.config?.authDomain
    })
    let unsub = null
    let active = true
    const setup = async () => {
      try {
        if (isStandalonePwa() || isIosSafari()) {
          log.info('auth.persistence_set', { mode: 'indexedDBLocalPersistence' })
          try {
            await setPersistence(auth, indexedDBLocalPersistence)
          } catch (err) {
            log.warn('auth.persistence_indexeddb_failed', undefined, err)
            try {
              log.info('auth.persistence_set', { mode: 'browserLocalPersistence' })
              await setPersistence(auth, browserLocalPersistence)
            } catch (fallbackErr) {
              log.warn('auth.persistence_local_failed', undefined, fallbackErr)
              log.info('auth.persistence_set', { mode: 'browserSessionPersistence' })
              await setPersistence(auth, browserSessionPersistence)
            }
          }
        } else {
          log.info('auth.persistence_set', { mode: 'browserLocalPersistence' })
          await setPersistence(auth, browserLocalPersistence)
        }
      } catch (err) {
        log.warn('auth.persistence_init_failed', undefined, err)
      }

      if (!active) return
      unsub = onAuthStateChanged(auth, firebaseUser => {
        log.info('auth.state_changed', { uid: firebaseUser?.uid || null })
        setUser(firebaseUser)
        setLoading(false)
      })
    }

    const init = async () => {
      await setup()
      if (!active) return
      log.info('auth.redirect_check')
      try {
        const result = await getRedirectResult(auth)
        log.info('auth.redirect_result', {
          hasUser: Boolean(result?.user),
          providerId: result?.providerId || null
        })
        if (!active) return
        if (result?.user) {
          setUser(result.user)
        }
        setError(null)
      } catch (err) {
        if (active) {
          log.error('auth.redirect_failed', undefined, err)
          setError(err)
        }
      }
    }

    init()
    return () => {
      active = false
      if (typeof unsub === 'function') unsub()
    }
  }, [])

  const signIn = useCallback(async () => {
    if (!auth) {
      const err = new Error('Account sync disabled: configure Firebase env values to enable sign-in.')
      setError(err)
      return Promise.reject(err)
    }
    setError(null)
    try {
      return signInWithRedirect(auth, provider)
    } catch (err) {
      log.error('auth.redirect_failed', undefined, err)
      setError(err)
      throw err
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!auth) return
    setError(null)
    await firebaseSignOut(auth)
  }, [])

  const value = useMemo(() => ({
    user,
    loading,
    error,
    signIn,
    signOut
  }), [user, loading, error, signIn, signOut])

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
