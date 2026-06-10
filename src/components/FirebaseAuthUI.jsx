import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from 'firebase/auth'
import { FaApple, FaEnvelope, FaGoogle } from 'react-icons/fa'
import { auth, isFirebaseConfigured } from '../firebaseClient'
import { describeAuthError } from '../authErrors'

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })
const appleProvider = new OAuthProvider('apple.com')

export default function FirebaseAuthUI({ onAppleSignInClick } = {}) {
  const [showEmail, setShowEmail] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [localError, setLocalError] = useState('')
  const emailFormRef = useRef(null)
  const cardRef = useRef(null)
  const [lockedWidth, setLockedWidth] = useState(null)
  const measureCardWidth = useCallback(() => {
    if (!cardRef.current) return
    const width = Math.round(cardRef.current.getBoundingClientRect().width)
    setLockedWidth(prev => prev === width ? prev : width)
  }, [])

  if (!isFirebaseConfigured) {
    return (
      <div style={{ fontSize: '0.78rem', color: '#fca5a5' }}>
        Firebase auth is disabled. Set the VITE_FIREBASE_* env vars to enable sign-in.
      </div>
    )
  }

  const runRedirect = async (provider) => {
    if (!auth) return
    setLocalError('')
    setBusy(true)
    try {
      await signInWithRedirect(auth, provider)
    } catch (err) {
      setLocalError(describeAuthError(err))
      setBusy(false)
    }
  }

  const handleAppleSignInClick = () => {
    if (typeof onAppleSignInClick === 'function') {
      onAppleSignInClick()
      return
    }
    setLocalError('Apple charges $99 for this feature, sorry.')
  }

  const handleEmailSubmit = async (event) => {
    event.preventDefault()
    if (!auth) return
    setLocalError('')
    setBusy(true)
    try {
      if (isCreating) {
        await createUserWithEmailAndPassword(auth, email, password)
      } else {
        await signInWithEmailAndPassword(auth, email, password)
      }
    } catch (err) {
      setLocalError(describeAuthError(err))
      setBusy(false)
    }
  }

  const handleResetPassword = async () => {
    if (!auth) return
    if (!email) {
      setLocalError('Enter your email to reset your password.')
      return
    }
    setLocalError('')
    setBusy(true)
    try {
      await sendPasswordResetEmail(auth, email)
      setLocalError('Password reset email sent.')
    } catch (err) {
      setLocalError(describeAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!showEmail) return
    const raf = requestAnimationFrame(() => {
      const accountPanel = cardRef.current?.closest('.account-panel')
      if (accountPanel) {
        accountPanel.scrollTo({ top: accountPanel.scrollHeight, behavior: 'smooth' })
      }
      if (emailFormRef.current) {
        emailFormRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' })
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [showEmail])

  useLayoutEffect(() => {
    if (showEmail) return
    measureCardWidth()
  }, [showEmail, measureCardWidth])

  useLayoutEffect(() => {
    if (showEmail) return undefined
    if (!cardRef.current) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      measureCardWidth()
    })
    observer.observe(cardRef.current)
    return () => observer.disconnect()
  }, [showEmail, measureCardWidth])

  useEffect(() => {
    if (showEmail) return undefined
    if (typeof ResizeObserver !== 'undefined') return undefined
    const handleResize = () => measureCardWidth()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [showEmail, measureCardWidth])

  return (
    <section className="auth-panel" aria-label="Sign in">
      <div
        className="auth-card"
        ref={cardRef}
        style={lockedWidth ? { width: `${lockedWidth}px`, maxWidth: '100%' } : undefined}
      >
        <div className="auth-buttons">
          <button
            type="button"
            className="auth-btn"
            onClick={() => runRedirect(googleProvider)}
            disabled={busy}
            aria-label="Sign in with Google"
          >
            <FaGoogle size={14} aria-hidden="true" />
            <span>Google</span>
          </button>
          <button
            type="button"
            className="auth-btn"
            onClick={handleAppleSignInClick}
            disabled={busy}
            aria-label="Sign in with Apple"
          >
            <FaApple size={14} aria-hidden="true" />
            <span>Apple</span>
          </button>
          <button
            type="button"
            className="auth-btn secondary"
            onClick={() => setShowEmail(prev => !prev)}
            disabled={busy}
          >
            <FaEnvelope size={13} aria-hidden="true" />
            <span>Email</span>
          </button>
        </div>

        {showEmail && (
          <form className="auth-email" onSubmit={handleEmailSubmit} ref={emailFormRef}>
            <label className="auth-field" htmlFor="auth-email">
              <span>Email</span>
              <input
                className="auth-input"
                id="auth-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={event => setEmail(event.target.value)}
                required
              />
            </label>
            <label className="auth-field" htmlFor="auth-password">
              <span>Password</span>
              <input
                className="auth-input"
                id="auth-password"
                name="password"
                type="password"
                autoComplete={isCreating ? 'new-password' : 'current-password'}
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
              />
            </label>
            <div className="auth-row">
              <button type="submit" className="auth-btn primary" disabled={busy}>
                {isCreating ? 'Create account' : 'Sign in'}
              </button>
              <button
                type="button"
                className="auth-link"
                onClick={() => setIsCreating(prev => !prev)}
                disabled={busy}
              >
                {isCreating ? 'Use existing account' : 'Create account instead'}
              </button>
            </div>
            <button
              type="button"
              className="auth-link subtle"
              onClick={handleResetPassword}
              disabled={busy}
            >
              Forgot password
            </button>
          </form>
        )}

        {localError && (
          <div className="auth-error">{localError}</div>
        )}
      </div>
    </section>
  )
}
