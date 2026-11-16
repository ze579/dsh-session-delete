/**
 * Build and validate a format-1 plugin market index for this bundle.
 *
 * Usage: node market/make-index.mjs <repoUrl> <commit> [pathInsideRepo]
 *   repoUrl         https URL, no credentials, e.g. https://github.com/you/dsh-session-delete
 *   commit          lowercase 40-hex commit SHA that contains this version
 *   pathInsideRepo  optional POSIX directory of the package inside the repo
 *
 * Emits market/index.json next to this script and validates it with DSH's own
 * parser when that package is installed next to the running DSH.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(await readFile(join(here, '..', 'package.json'), 'utf8'))
const icon = await readFile(join(here, '..', 'icon.svg'))

const args = process.argv.slice(2)
const npmMode = args[0] === '--npm'
const [repoUrl, commit, pathInsideRepo] = npmMode ? [] : args
if (npmMode) {
  if (/^@local\//.test(pkg.name)) { console.error('npm needs a publishable name, not ' + pkg.name); process.exit(1) }
} else {
  if (!repoUrl || !/^https:\/\/[^\s]+$/.test(repoUrl)) { console.error('need an https repo URL'); process.exit(1) }
  if (!commit || !/^[0-9a-f]{40}$/.test(commit)) { console.error('need a lowercase 40-hex commit'); process.exit(1) }
}

/** DSH range this bundle was built and tested against. */
const DSH_RANGE = '>=0.2.2-rc.3 <0.3.0'

const index = {
  format: 1,
  title: { zh: '本地插件索引', en: 'Local plugin index' },
  description: {
    zh: '自建索引：会话删除等本地插件。',
    en: 'Self-hosted index for local bundles such as session-delete.',
  },
  metadata: {
    categories: { session: { title: { zh: '会话与消息', en: 'Sessions & messages' } } },
    labels: {},
    sortKeys: {},
  },
  plugins: [{
    name: pkg.name,
    title: { zh: '会话删除', en: 'Session delete' },
    description: {
      zh: '在会话右键菜单里删除会话，删除前需要两次确认（适用 DSH ' + DSH_RANGE + '）。',
      en: 'Delete a session from its context menu with two confirmations (DSH ' + DSH_RANGE + ').',
    },
    author: pkg.author,
    homepage: repoUrl,
    ...(npmMode ? {} : { homepage: repoUrl, repository: { url: repoUrl, ...(pathInsideRepo ? { directory: pathInsideRepo } : {}) } }),
    icon: 'data:image/svg+xml;base64,' + icon.toString('base64'),
    metadata: { category: 'session', keywords: pkg.keywords ?? [], labels: [], sortKeys: {} },
    versions: [{
      version: pkg.version,
      publishTimestamp: Math.floor(Date.now() / 1000),
      source: npmMode ? { type: 'npm' } : { type: 'git', url: repoUrl, commit, ...(pathInsideRepo ? { path: pathInsideRepo } : {}) },
      engines: { dsh: DSH_RANGE },
    }],
  }],
};

const out = join(here, 'index.json')
await writeFile(out, JSON.stringify(index, null, 2) + '\n', 'utf8')
console.log('wrote', out, npmMode ? '(npm source)' : '(git source)')

try {
  const { parseMarketIndex } = await import('file:///D:/deep%20seek/resources/app/dsh/node_modules/@deepseek-ai/dsh-plugin-market-index/lib/index.js')
  const parsed = parseMarketIndex(index, 'https://example.com/index.json')
  const version = parsed.plugins[0].versions[0]
  console.log('validated:', parsed.plugins[0].name, version.version, '| engines.dsh =', version.engines.dsh)
} catch (error) {
  console.warn('validation skipped or failed:', error instanceof Error ? error.message : error)
}
