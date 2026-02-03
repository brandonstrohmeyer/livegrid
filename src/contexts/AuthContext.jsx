import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as firebaseSignOut
} from 'firebase/auth'
import { auth } from '../firebaseClient'

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
    const unsub = onAuthStateChanged(auth, firebaseUser => {
      setUser(firebaseUser)
      setLoading(false)
    })
    return () => unsub()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || !auth) return undefined
    let isMounted = true
    getRedirectResult(auth)
      .then(() => {
        if (isMounted) setError(null)
      })
      .catch(err => {
        if (isMounted) {
          console.error('[auth] Redirect sign-in failed', err)
          setError(err)
        }
      })
    return () => {
      isMounted = false
    }
  }, [])

  const signIn = useCallback(async () => {
    if (!auth) {
      const err = new Error('Account sync disabled: configure Firebase env values to enable sign-in.')
      setError(err)
      return Promise.reject(err)
    }
    setError(null)
    if (isStandalonePwa()) {
      return signInWithRedirect(auth, provider)
    }
    try {
      await signInWithPopup(auth, provider)
    } catch (err) {
      if (err?.code === 'auth/popup-blocked' || err?.code === 'auth/popup-closed-by-user') {
        return signInWithRedirect(auth, provider)
      }
      console.error('[auth] Popup sign-in failed', err)
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
