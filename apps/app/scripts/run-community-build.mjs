import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const vitePackageJson = require.resolve('vite/package.json')
const vitePackage = require(vitePackageJson)
const viteBin = join(dirname(vitePackageJson), vitePackage.bin.vite)

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: appRoot, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

rmSync(join(appRoot, '.community-module-audit.local.json'), { force: true })
run([viteBin, 'build', '--mode', 'community', '--config', 'vite.config.ts'])
run(['./scripts/write-version-json.mjs'])
