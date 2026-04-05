import process from 'node:process'
import {
  describeRunService,
  getTargetFunctionServices,
  hasRunServicePlainEnv,
  hasRunServiceSecretEnv,
  resolveRequestedProjectId
} from './hosting-public-access-shared.mjs'

const TARGET_FUNCTIONS = new Set(['sheetsApi', 'systemHealth'])
const REQUIRED_SECRET_KEY = 'SHEETS_API_KEY'
const LEGACY_ENV_KEY = 'GOOGLE_SHEETS_API_KEY'

async function main() {
  const { requestedProject, projectId } = await resolveRequestedProjectId()

  if (!projectId) {
    console.error('Missing project id. Pass --project or set FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID / GCLOUD_PROJECT / FIREBASE_PROJECT_ALIAS.')
    process.exit(1)
  }

  if (requestedProject && requestedProject !== projectId) {
    console.log(`Resolved Firebase project alias "${requestedProject}" to project id "${projectId}".`)
  }

  const { services } = await getTargetFunctionServices(projectId)
  const targetServices = services.filter(service => TARGET_FUNCTIONS.has(service.functionName))
  const missingTargets = [...TARGET_FUNCTIONS].filter(name => !targetServices.some(service => service.functionName === name))

  if (missingTargets.length) {
    console.error(`Missing deployed functions required for Sheets runtime verification in project ${projectId}:`)
    for (const name of missingTargets) {
      console.error(`- ${name}`)
    }
    process.exit(1)
  }

  console.log(`Verifying Sheets runtime config for ${targetServices.length} function(s) in ${projectId}...`)

  const failures = []

  for (const service of targetServices) {
    const runService = describeRunService(projectId, service.region, service.serviceName)
    const hasRequiredSecret = hasRunServiceSecretEnv(runService, REQUIRED_SECRET_KEY)
    const hasLegacyOverride = hasRunServicePlainEnv(runService, LEGACY_ENV_KEY)

    if (!hasRequiredSecret || hasLegacyOverride) {
      failures.push({
        functionName: service.functionName,
        region: service.region,
        hasRequiredSecret,
        hasLegacyOverride
      })
      continue
    }

    console.log(`- Verified ${service.functionName} uses secret ${REQUIRED_SECRET_KEY} without legacy ${LEGACY_ENV_KEY}.`)
  }

  if (failures.length) {
    console.error('Sheets runtime config verification failed:')
    for (const failure of failures) {
      if (!failure.hasRequiredSecret) {
        console.error(`- ${failure.functionName} (${failure.region}) is missing secret env ${REQUIRED_SECRET_KEY}.`)
      }
      if (failure.hasLegacyOverride) {
        console.error(`- ${failure.functionName} (${failure.region}) still has legacy env ${LEGACY_ENV_KEY}.`)
      }
    }
    process.exit(1)
  }

  console.log('Sheets runtime config verification complete.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
