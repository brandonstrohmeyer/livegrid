export function describeAuthError(error) {
  const code = typeof error?.code === 'string' ? error.code.trim() : ''

  if (code === 'auth/configuration-not-found') {
    return 'Google sign-in is not configured for this environment yet. Use email sign-in for now or finish the Firebase Auth Google provider setup.'
  }

  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not authorized for Firebase sign-in yet. Add the current host to Firebase Auth authorized domains and try again.'
  }

  return error?.message || 'Sign-in failed. Please try again.'
}
