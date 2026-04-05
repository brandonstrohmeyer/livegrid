import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const repoRoot = path.resolve(__dirname, '..')
const firebaseConfigPath = path.join(repoRoot, 'firebase.json')
const firebaseRcPath = path.join(repoRoot, '.firebaserc')
const gcloudCommand = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud'
const INVOKER_IAM_DISABLED_ANNOTATION = 'run.googleapis.com/invoker-iam-disabled'

export function buildSpawnConfig(args, inherit = false) {
  if (process.platform === 'win32') {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', [gcloudCommand, ...args].join(' ')]
    }
  }

  return {
    command: gcloudCommand,
    args
  }
}

export function getArgValue(flag, argv = process.argv) {
  const index = argv.indexOf(flag)
  if (index === -1) return null
  return argv[index + 1] || null
}

export function runJson(args) {
  const spawnConfig = buildSpawnConfig(args)
  const output = execFileSync(spawnConfig.command, spawnConfig.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return JSON.parse(output || 'null')
}

export function runInteractive(args) {
  const spawnConfig = buildSpawnConfig(args, true)
  execFileSync(spawnConfig.command, spawnConfig.args, {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}

export function getRewriteFunctionName(rewrite) {
  if (!rewrite || typeof rewrite !== 'object') return null
  if (typeof rewrite.function === 'string' && rewrite.function.trim()) return rewrite.function.trim()
  if (rewrite.function && typeof rewrite.function === 'object') {
    if (typeof rewrite.function.functionId === 'string' && rewrite.function.functionId.trim()) {
      return rewrite.function.functionId.trim()
    }
    if (typeof rewrite.function.name === 'string' && rewrite.function.name.trim()) {
      return rewrite.function.name.trim()
    }
  }
  return null
}

function getHostingConfigs(config) {
  if (!config || !config.hosting) return []
  return Array.isArray(config.hosting) ? config.hosting : [config.hosting]
}

export async function getTargetFunctionNames() {
  const raw = await fs.readFile(firebaseConfigPath, 'utf8')
  const config = JSON.parse(raw)
  const names = new Set()

  for (const hosting of getHostingConfigs(config)) {
    const rewrites = Array.isArray(hosting?.rewrites) ? hosting.rewrites : []
    for (const rewrite of rewrites) {
      const functionName = getRewriteFunctionName(rewrite)
      if (functionName) names.add(functionName)
    }
  }

  return [...names]
}

export async function resolveProjectId(projectOrAlias) {
  if (!projectOrAlias) return null

  try {
    const raw = await fs.readFile(firebaseRcPath, 'utf8')
    const config = JSON.parse(raw)
    const mappedProjectId = config?.projects?.[projectOrAlias]
    return typeof mappedProjectId === 'string' && mappedProjectId.trim()
      ? mappedProjectId.trim()
      : projectOrAlias
  } catch (error) {
    return projectOrAlias
  }
}

export async function resolveRequestedProjectId(argv = process.argv) {
  const requestedProject =
    getArgValue('--project', argv) ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.FIREBASE_PROJECT_ALIAS

  const projectId = await resolveProjectId(requestedProject)

  return { requestedProject, projectId }
}

export function buildFunctionServiceMap(projectId) {
  const functions = runJson([
    'functions',
    'list',
    '--v2',
    '--project',
    projectId,
    '--format=json'
  ])

  const map = new Map()
  for (const fn of Array.isArray(functions) ? functions : []) {
    const functionPath = typeof fn?.name === 'string' ? fn.name : ''
    const servicePath = typeof fn?.serviceConfig?.service === 'string' ? fn.serviceConfig.service : ''
    const parts = functionPath.split('/')
    const functionId = parts[parts.length - 1]
    const region = parts[3]
    const serviceName = servicePath.split('/').pop()

    if (!functionId || !region || !serviceName) continue
    map.set(functionId, { region, serviceName })
  }

  return map
}

export async function getTargetFunctionServices(projectId) {
  const targetFunctions = await getTargetFunctionNames()
  const functionServiceMap = buildFunctionServiceMap(projectId)
  const missingFunctions = targetFunctions.filter(name => !functionServiceMap.has(name))
  const services = targetFunctions
    .filter(name => functionServiceMap.has(name))
    .map(functionName => ({
      functionName,
      ...functionServiceMap.get(functionName)
    }))

  return {
    targetFunctions,
    missingFunctions,
    services
  }
}

export function describeRunService(projectId, region, serviceName) {
  return runJson([
    'run',
    'services',
    'describe',
    serviceName,
    '--project',
    projectId,
    '--region',
    region,
    '--format=json'
  ])
}

export function describeFunctionGen2(projectId, region, functionName) {
  return runJson([
    'functions',
    'describe',
    functionName,
    '--gen2',
    '--region',
    region,
    '--project',
    projectId,
    '--format=json'
  ])
}

export function getRunServiceContainerEnv(service) {
  const containers = Array.isArray(service?.spec?.template?.spec?.containers)
    ? service.spec.template.spec.containers
    : []
  const withEnv = containers.find(container => Array.isArray(container?.env))
  return Array.isArray(withEnv?.env) ? withEnv.env : []
}

export function getRunServiceEnvEntry(service, envName) {
  return getRunServiceContainerEnv(service).find(entry => entry?.name === envName)
}

export function hasRunServicePlainEnv(service, envName) {
  const entry = getRunServiceEnvEntry(service, envName)
  return typeof entry?.value === 'string' && entry.value.trim() !== ''
}

export function hasRunServiceSecretEnv(service, envName) {
  const entry = getRunServiceEnvEntry(service, envName)
  return Boolean(entry?.valueFrom?.secretKeyRef?.name && entry?.valueFrom?.secretKeyRef?.key)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function getInvokerIamDisabledValue(service) {
  const candidates = [
    service?.metadata?.annotations,
    service?.spec?.template?.metadata?.annotations,
    service?.template?.metadata?.annotations,
    service?.template?.annotations
  ]

  for (const annotations of candidates) {
    if (annotations && Object.prototype.hasOwnProperty.call(annotations, INVOKER_IAM_DISABLED_ANNOTATION)) {
      return annotations[INVOKER_IAM_DISABLED_ANNOTATION]
    }
  }

  return undefined
}

export function isInvokerIamCheckDisabled(service) {
  const value = getInvokerIamDisabledValue(service)
  if (value === true) return true
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
  return false
}

export function formatServiceTarget({ functionName, serviceName, region }) {
  return `${functionName} -> ${serviceName} (${region})`
}

export async function waitForInvokerIamCheckDisabled(projectId, region, serviceName, options = {}) {
  const attempts = Number.isInteger(options.attempts) && options.attempts > 0 ? options.attempts : 4
  const delayMs = Number.isInteger(options.delayMs) && options.delayMs >= 0 ? options.delayMs : 3000
  let lastService = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastService = describeRunService(projectId, region, serviceName)
    if (isInvokerIamCheckDisabled(lastService)) {
      return {
        ok: true,
        attemptsUsed: attempt,
        service: lastService
      }
    }

    if (attempt < attempts) {
      await sleep(delayMs)
    }
  }

  return {
    ok: false,
    attemptsUsed: attempts,
    service: lastService
  }
}
