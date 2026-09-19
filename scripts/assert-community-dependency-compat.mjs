import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { assertInstalledDirectDependencyPeers } from './community-lockfile-versions.mjs'

const isDirectRun =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
if (isDirectRun) {
  assertInstalledDirectDependencyPeers(process.cwd(), {
    requireExactDeclaredVersions: process.argv.includes('--require-exact'),
  })
}
