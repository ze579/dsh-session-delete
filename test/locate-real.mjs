import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { locateSession } from '../index.js'

const sessionsRoot = 'C:\\Users\\ze\\.dsh\\sessions'
const checked = []
const failed = []
for (const project of await readdir(sessionsRoot, { withFileTypes: true })) {
  if (!project.isDirectory()) continue
  for (const name of await readdir(join(sessionsRoot, project.name))) {
    const fullId = name.startsWith('session-') ? name : 'session-' + name
    const found = await locateSession(sessionsRoot, fullId)
    checked.push(fullId)
    if (!found || found.project !== project.name) failed.push({ name, project: project.name, found: found && found.project })
  }
}
console.log(JSON.stringify({ checked: checked.length, unique: new Set(checked).size, failed }))