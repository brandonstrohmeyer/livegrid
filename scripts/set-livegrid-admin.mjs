import { execFileSync } from 'node:child_process'
import process from 'node:process'

const projectAliases = new Map([
  ['dev', 'livegrid-dev-7acfc'],
  ['development', 'livegrid-dev-7acfc'],
  ['prod', 'livegrid-c33c6'],
  ['production', 'livegrid-c33c6']
])

function usage() {
  console.log(`
Usage:
  npm run admin:set -- --project <project-id|dev|prod> --email <user@example.com>
  npm run admin:unset -- --project <project-id|dev|prod> --email <user@example.com>

Examples:
  npm run admin:set -- --project dev --email brandon@stro.io
  npm run admin:set -- --project prod --email brandon@stro.io
  npm run admin:unset -- --project dev --email user@example.com
`.trim())
}

function parseArgs(argv) {
  const args = {
    project: '',
    email: '',
    remove: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      args.help = true
      continue
    }
    if (arg === '--remove' || arg === '--unset') {
      args.remove = true
      continue
    }
    if (arg === '--project' || arg === '-p') {
      args.project = argv[index + 1] || ''
      index += 1
      continue
    }
    if (arg === '--email' || arg === '-e') {
      args.email = argv[index + 1] || ''
      index += 1
      continue
    }
    if (!args.email && arg.includes('@')) {
      args.email = arg
      continue
    }
  }

  return args
}

function resolveProjectId(project) {
  const normalized = (project || '').trim().toLowerCase()
  return projectAliases.get(normalized) || project
}

function getAccessToken() {
  try {
    return execFileSync('gcloud', ['auth', 'print-access-token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
  } catch (error) {
    throw new Error('Unable to get a gcloud access token. Run `gcloud auth login` first.')
  }
}

async function callIdentityToolkit(projectId, method, body, accessToken) {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'x-goog-user-project': projectId,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = payload?.error?.message || response.statusText || `HTTP ${response.status}`
    throw new Error(`${method} failed for ${projectId}: ${detail}`)
  }
  return payload
}

function parseCustomAttributes(user) {
  if (!user?.customAttributes) return {}
  try {
    const parsed = JSON.parse(user.customAttributes)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (error) {
    throw new Error(`User ${user.email || user.localId} has invalid customAttributes JSON.`)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    usage()
    return
  }

  const projectId = resolveProjectId(args.project)
  const email = args.email.trim().toLowerCase()

  if (!projectId || !email) {
    usage()
    process.exit(1)
  }

  const accessToken = getAccessToken()
  const lookup = await callIdentityToolkit(projectId, 'accounts:lookup', { email: [email] }, accessToken)
  const user = Array.isArray(lookup.users) ? lookup.users[0] : null
  if (!user?.localId) {
    throw new Error(`No Firebase Auth user found for ${email} in ${projectId}.`)
  }

  const claims = parseCustomAttributes(user)
  if (args.remove) {
    delete claims.livegridAdmin
  } else {
    claims.livegridAdmin = true
  }

  await callIdentityToolkit(projectId, 'accounts:update', {
    localId: user.localId,
    customAttributes: JSON.stringify(claims)
  }, accessToken)

  const action = args.remove ? 'removed admin from' : 'set admin for'
  console.log(`${action} ${email} ${user.localId} in ${projectId}`)
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
