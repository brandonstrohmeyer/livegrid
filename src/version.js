const buildFiles = import.meta.glob('../build.json', { eager: true, import: 'default' })
const packageFiles = import.meta.glob('../package.json', { eager: true, import: 'default' })

const buildVersion = buildFiles['../build.json']?.version
const packageVersion = packageFiles['../package.json']?.version

export default buildVersion || packageVersion || '0.0.0'
