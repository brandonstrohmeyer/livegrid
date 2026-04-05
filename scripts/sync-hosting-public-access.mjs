import process from 'node:process'
import {
  formatServiceTarget,
  getInvokerIamDisabledValue,
  getTargetFunctionServices,
  resolveRequestedProjectId,
  runInteractive,
  waitForInvokerIamCheckDisabled
} from './hosting-public-access-shared.mjs'

async function main() {
  const { requestedProject, projectId } = await resolveRequestedProjectId()

  if (!projectId) {
    console.error('Missing project id. Pass --project or set FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID / GCLOUD_PROJECT / FIREBASE_PROJECT_ALIAS.')
    process.exit(1)
  }

  if (requestedProject && requestedProject !== projectId) {
    console.log(`Resolved Firebase project alias "${requestedProject}" to project id "${projectId}".`)
  }

  const { targetFunctions, missingFunctions, services } = await getTargetFunctionServices(projectId)
  if (!targetFunctions.length) {
    console.log('No Hosting-backed function rewrites found in firebase.json. Nothing to update.')
    return
  }

  if (missingFunctions.length) {
    console.error(`Missing deployed gen2 functions for Hosting rewrites in project ${projectId}:`)
    for (const name of missingFunctions) {
      console.error(`- ${name}`)
    }
    process.exit(1)
  }

  console.log(`Syncing Hosting-backed Cloud Run access for ${services.length} function(s) in ${projectId}...`)

  const verificationFailures = []

  for (const service of services) {
    console.log(`- ${formatServiceTarget(service)}`)
    runInteractive([
      'run',
      'services',
      'update',
      service.serviceName,
      '--project',
      projectId,
      '--region',
      service.region,
      '--no-invoker-iam-check',
      '--quiet'
    ])

    const verification = await waitForInvokerIamCheckDisabled(projectId, service.region, service.serviceName)
    if (!verification.ok) {
      verificationFailures.push({
        ...service,
        attemptsUsed: verification.attemptsUsed,
        rawValue: getInvokerIamDisabledValue(verification.service)
      })
      continue
    }

    console.log(`  Verified ${formatServiceTarget(service)} with invoker IAM check disabled after ${verification.attemptsUsed} check(s).`)
  }

  if (verificationFailures.length) {
    console.error('Cloud Run public access sync finished, but verification failed for:')
    for (const failure of verificationFailures) {
      console.error(`- ${formatServiceTarget(failure)}: expected run.googleapis.com/invoker-iam-disabled=true after ${failure.attemptsUsed} check(s), found ${JSON.stringify(failure.rawValue)}`)
    }
    process.exit(1)
  }

  console.log('Cloud Run public access sync complete and verified.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
