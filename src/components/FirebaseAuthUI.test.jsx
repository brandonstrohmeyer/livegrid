import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('firebase/auth', () => {
  class Provider {
    setCustomParameters() {}
  }
  return {
    GoogleAuthProvider: Provider,
    OAuthProvider: Provider,
    signInWithRedirect: vi.fn().mockResolvedValue(undefined),
    signInWithEmailAndPassword: vi.fn().mockResolvedValue(undefined),
    createUserWithEmailAndPassword: vi.fn().mockResolvedValue(undefined),
    sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined)
  }
})

describe('FirebaseAuthUI', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('shows disabled message when firebase is not configured', async () => {
    vi.doMock('../firebaseClient', () => ({
      auth: null,
      isFirebaseConfigured: false
    }))
    const { default: FirebaseAuthUI } = await import('./FirebaseAuthUI')
    render(<FirebaseAuthUI />)
    expect(screen.getByText(/Firebase auth is disabled/i)).toBeInTheDocument()
  })

  it('toggles email form when Email button is clicked', async () => {
    vi.doMock('../firebaseClient', () => ({
      auth: {},
      isFirebaseConfigured: true
    }))
    const { default: FirebaseAuthUI } = await import('./FirebaseAuthUI')
    render(<FirebaseAuthUI />)
    const emailButton = screen.getByRole('button', { name: /email/i })
    fireEvent.click(emailButton)
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument()
  })
})
