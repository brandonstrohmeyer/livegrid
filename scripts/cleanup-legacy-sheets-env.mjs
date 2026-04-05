import process from 'node:process'
import {
  describeRunService,
  getTargetFunctionServices,
  hasRunServicePlainEnv,
  resolveRequestedProjectId,
  runInteractive
} from './hosting-public-access-shared.mjs'

const TARGET_FUNCTIONS = new Set(['sheetsApi', 'systemHealth'])
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

  if (!targetServices.length) {
    console.log('No Sheets runtime targets found for legacy env cleanup.')
    return
  }

  console.log(`Removing legacy ${LEGACY_ENV_KEY} from ${targetServices.length} function service(s) in ${projectId} when present...`)

  for (const service of targetServices) {
    const runService = describeRunService(projectId, service.region, service.serviceName)
    if (!hasRunServicePlainEnv(runService, LEGACY_ENV_KEY)) {
      console.log(`- ${service.functionName} (${service.region}) is already clean.`)
      continue
    }

    console.log(`- Removing ${LEGACY_ENV_KEY} from ${service.functionName} (${service.region})...`)
    runInteractive([
      'run',
      'services',
      'update',
      service.serviceName,
      '--project',
      projectId,
      '--region',
      service.region,
      '--remove-env-vars',
      LEGACY_ENV_KEY,
      '--quiet'
    ])
  }

  console.log('Legacy Sheets env cleanup complete.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
