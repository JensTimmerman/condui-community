import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const { resolveAppBuildCommit } = require('./resolve-app-build-commit.cjs')

const commit = resolveAppBuildCommit(appRoot)
const outPath = path.join(appRoot, 'dist', 'version.json')

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, `${JSON.stringify({ commit })}\n`, 'utf-8')
console.log(`Wrote ${path.relative(appRoot, outPath)}${commit ? ` (${commit.slice(0, 7)})` : ''}`)
