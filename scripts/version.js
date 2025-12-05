const fs = require('fs')
const path = require('path')

const versionType = process.argv[2] || 'hotfix'
const packagePath = path.join(__dirname, '..', 'package.json')
const changelogPath = path.join(__dirname, '..', 'CHANGELOG.md')

// Read package.json
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
const currentVersion = packageJson.version

// Parse version
const [major, minor, patch] = currentVersion.split('.').map(Number)

// Calculate new version
let newVersion
if (versionType === 'minor') {
  newVersion = `${major}.${minor + 1}.0`
}
else if (versionType === 'major') {
  newVersion = `${major + 1}.0.0`
}
else {
  newVersion = `${major}.${minor}.${patch + 1}`
}

// Update package.json
packageJson.version = newVersion
fs.writeFileSync(packagePath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')

// Update or create CHANGELOG.md
const date = new Date().toISOString().split('T')[0]
let changelog = ''

if (fs.existsSync(changelogPath)) {
  changelog = fs.readFileSync(changelogPath, 'utf8')
}

const newEntry = `## [${newVersion}] - ${date}\n\n### Changed\n- Version bump to ${newVersion}\n\n`

if (changelog.includes('# Changelog')) {
  // Insert after the header
  const lines = changelog.split('\n')
  const headerIndex = lines.findIndex(line => line.startsWith('# Changelog'))
  lines.splice(headerIndex + 1, 0, '\n' + newEntry)
  changelog = lines.join('\n')
}
else {
  // Create new changelog
  changelog = `# Changelog\n\n${newEntry}`
}

fs.writeFileSync(changelogPath, changelog, 'utf8')

console.log(`✓ Version updated: ${currentVersion} → ${newVersion}`)
console.log(`✓ CHANGELOG.md updated`)
console.log(`\nNext steps:`)
console.log(`  1. Update CHANGELOG.md with actual changes`)
console.log(`  2. Commit: git add . && git commit -m "chore: bump version to ${newVersion}"`)
console.log(`  3. Tag: git tag v${newVersion}`)
console.log(`  4. Push: git push && git push --tags`)
