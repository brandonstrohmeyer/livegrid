import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { loadEnv } from 'vite'
import { getFirebaseClientHealth } from './firebaseEnvRequirements.mjs'

const PROJECT_TO_MODE = new Map([
  ['livegrid-dev-7acfc', 'development'],
  ['livegrid-c33c6', 'production']
])

const cwd = process.cwd()
const targetProject = (process.env.GCLOUD_PROJECT || '').trim()
const explicitMode = (process.env.LIVEGRID_VITE_MODE || '').trim()
const mode = explicitMode || PROJECT_TO_MODE.get(targetProject) || 'production'

const env = {
  ...process.env,
  ...loadEnv(mode, cwd, ''),
  NODE_ENV: 'production',
  VITE_USE_FIREBASE_EMULATORS: 'false'
}
const sanitizedEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('=')))

const { ok, missingKeys } = getFirebaseClientHealth(env)

if (!ok) {
  console.error(`Missing required Firebase client env vars for hosting build in ${mode} mode:`)
  missingKeys.forEach(key => console.error(`- ${key}`))
  process.exit(1)
}

console.log(`Firebase Hosting build: project=${targetProject || 'unknown'} mode=${mode}`)

function runNodeScript(args) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env: sanitizedEnv,
    stdio: 'inherit'
  })

  if (result.error) {
    console.error('Failed to run hosting build step.', result.error)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

runNodeScript([path.resolve(cwd, 'scripts', 'build-version.js'), 'ensure'])
runNodeScript([path.resolve(cwd, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', mode])
