import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const repoRoot = path.resolve(__dirname, '..')
const firebaseConfigPath = path.join(repoRoot, 'firebase.json')
const gcloudCommand = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud'

function buildSpawnConfig(args, inherit = false) {
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

function getArgValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return null
  return process.argv[index + 1] || null
}

function runJson(args) {
  const spawnConfig = buildSpawnConfig(args)
  const output = execFileSync(spawnConfig.command, spawnConfig.args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
  return JSON.parse(output || 'null')
}

function runInteractive(args) {
  const spawnConfig = buildSpawnConfig(args, true)
  execFileSync(spawnConfig.command, spawnConfig.args, {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}

function getRewriteFunctionName(rewrite) {
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

async function getTargetFunctionNames() {
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

function buildFunctionServiceMap(projectId) {
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

async function main() {
  const projectId =
    getArgValue('--project') ||
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT

  if (!projectId) {
    console.error('Missing project id. Pass --project or set FIREBASE_PROJECT_ID / GCLOUD_PROJECT.')
    process.exit(1)
  }

  const targetFunctions = await getTargetFunctionNames()
  if (!targetFunctions.length) {
    console.log('No Hosting-backed function rewrites found in firebase.json. Nothing to update.')
    return
  }

  const functionServiceMap = buildFunctionServiceMap(projectId)
  const missingFunctions = targetFunctions.filter(name => !functionServiceMap.has(name))
  if (missingFunctions.length) {
    console.error(`Missing deployed gen2 functions for Hosting rewrites in project ${projectId}:`)
    for (const name of missingFunctions) {
      console.error(`- ${name}`)
    }
    process.exit(1)
  }

  console.log(`Syncing Hosting-backed Cloud Run access for ${targetFunctions.length} function(s) in ${projectId}...`)

  for (const functionName of targetFunctions) {
    const { region, serviceName } = functionServiceMap.get(functionName)
    console.log(`- ${functionName} -> ${serviceName} (${region})`)
    runInteractive([
      'run',
      'services',
      'update',
      serviceName,
      '--project',
      projectId,
      '--region',
      region,
      '--no-invoker-iam-check',
      '--quiet'
    ])
  }

  console.log('Cloud Run public access sync complete.')
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
