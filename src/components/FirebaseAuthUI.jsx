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
import { log } from '../logging.js'

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
  const debugAuthLayout = true
  const logAuthLayout = useCallback((label) => {
    if (!debugAuthLayout) return
    const card = cardRef.current
    const sidebarContainer = card?.closest('.ps-sidebar-container')
    const accountPanel = card?.closest('.account-panel')
    const buttons = card ? Array.from(card.querySelectorAll('.auth-btn')) : []
    const metrics = (el) => {
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const style = window.getComputedStyle(el)
      return {
        tag: el.tagName,
        className: el.className,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        clientWidth: el.clientWidth,
        scrollWidth: el.scrollWidth,
        offsetWidth: el.offsetWidth,
        paddingX: `${style.paddingLeft} ${style.paddingRight}`,
        borderX: `${style.borderLeftWidth} ${style.borderRightWidth}`,
        boxSizing: style.boxSizing,
        display: style.display
      }
    }
    const buttonMetrics = buttons.map((btn, index) => ({
      index,
      text: btn.textContent?.trim(),
      ...metrics(btn)
    }))
    log.debug('auth_layout.metrics', {
      label,
      showEmail,
      lockedWidth,
      card: metrics(card),
      accountPanel: metrics(accountPanel),
      sidebarContainer: metrics(sidebarContainer),
      buttonMetrics
    })
  }, [debugAuthLayout, lockedWidth, showEmail])
  const measureCardWidth = useCallback((label = 'measure') => {
    if (!cardRef.current) return
    const width = Math.round(cardRef.current.getBoundingClientRect().width)
    setLockedWidth(prev => {
      if (debugAuthLayout && prev !== width) {
        log.debug('auth_layout.locked_width_change', { label, prev, next: width })
      }
      return prev === width ? prev : width
    })
  }, [debugAuthLayout])

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
      setLocalError(err?.message || 'Sign-in failed. Please try again.')
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
      setLocalError(err?.message || 'Email sign-in failed.')
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
      setLocalError(err?.message || 'Password reset failed.')
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
    measureCardWidth('layout-effect')
  }, [showEmail, measureCardWidth])

  useLayoutEffect(() => {
    if (showEmail) return undefined
    if (!cardRef.current) return undefined
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      measureCardWidth('resize-observer')
    })
    observer.observe(cardRef.current)
    return () => observer.disconnect()
  }, [showEmail, measureCardWidth])

  useEffect(() => {
    if (showEmail) return undefined
    if (typeof ResizeObserver !== 'undefined') return undefined
    const handleResize = () => measureCardWidth('window-resize')
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [showEmail, measureCardWidth])

  useEffect(() => {
    logAuthLayout('render')
  })

  useEffect(() => {
    const raf1 = requestAnimationFrame(() => logAuthLayout('raf-1'))
    const raf2 = requestAnimationFrame(() => logAuthLayout('raf-2'))
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [showEmail, logAuthLayout])

  useEffect(() => {
    if (lockedWidth === null) return
    log.debug('auth_layout.locked_width_updated', { lockedWidth })
  }, [lockedWidth])

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
            onClick={() => {
              logAuthLayout('email-toggle:before')
              setShowEmail(prev => !prev)
            }}
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
