import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { cleanupStaleArchives, DeleteError, deleteSession, locateSession, ROUTE_PATH } from '../index.js'

const A = 'session-11111111-2222-3333-4444-555555555555'
const B = 'session-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

/** Build one throwaway DSH home with two projects and two sessions. */
async function makeHome() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-session-delete-'))
  const sessions = join(home, 'sessions')
  const cache = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(join(sessions, '--proj-one--', A), { recursive: true })
  await writeFile(join(sessions, '--proj-one--', A, 'session.v4.jsonl.zstd'), 'x'.repeat(64))
  await mkdir(join(sessions, '--proj-two--', B), { recursive: true })
  await writeFile(join(sessions, '--proj-two--', B, 'session.v4.jsonl.zstd'), 'y'.repeat(32))
  await mkdir(cache, { recursive: true })
  await writeFile(join(cache, A + '.json'), '{}')
  return { home, roots: { sessions, cache, stateFile: join(home, 'dsh-session-delete', 'purged.json') } }
}

test('locateSession finds a session by id without encoded paths', async () => {
  const { roots } = await makeHome()
  const found = await locateSession(roots.sessions, A)
  assert.ok(found)
  assert.equal(found.project, '--proj-one--')
  assert.equal(found.files, 1)
  assert.equal(found.bytes, 64)
  assert.equal(await locateSession(roots.sessions, 'session-00000000-0000-0000-0000-000000000000'), null)
})

test('deleteSession removes the directory, the cache, and the registry entries', async () => {
  const { roots } = await makeHome()
  const calls = []
  const registry = {
    archivedSessionIds: [A],
    pinnedSessionIds: [A],
    list: () => [{ path: 'D:\\proj-one', sessionIds: [A], detachSession: async (id) => { calls.push(['detach', id]) } }],
    unarchiveSession: async (id) => { calls.push(['unarchive', id]); registry.archivedSessionIds = [] },
    unpinSession: async (id) => { calls.push(['unpin', id]) },
  }
  const ctx = { waterfall: async () => [], workspaceRegistry: registry, logger: { warn() {} } }
  const report = await deleteSession(ctx, A, roots)
  assert.equal(report.ok, undefined)
  assert.equal(report.bytes, 64)
  assert.equal(report.archived, true)
  assert.equal(report.detached, 1)
  assert.equal(report.cacheRemoved, 1)
  assert.deepEqual(calls, [['unpin', A], ['detach', A]])
  await assert.rejects(stat(join(roots.sessions, '--proj-one--', A)), { code: 'ENOENT' })
  await assert.rejects(stat(join(roots.cache, A + '.json')), { code: 'ENOENT' })
  assert.ok(await stat(join(roots.sessions, '--proj-two--', B)))
})

test('a running session is refused and left on disk', async () => {
  const { roots } = await makeHome()
  const ctx = { waterfall: async () => [{ kind: 'turn' }], logger: { warn() {} } }
  await assert.rejects(deleteSession(ctx, A, roots), (error) => {
    assert.ok(error instanceof DeleteError)
    assert.equal(error.code, 'session-running')
    assert.equal(error.status, 409)
    assert.match(error.message, /turn/)
    return true
  })
  assert.ok(await stat(join(roots.sessions, '--proj-one--', A)))
})

test('an activity provider failure fails closed', async () => {
  const { roots } = await makeHome()
  const ctx = { waterfall: async () => { throw new Error('boom') }, logger: { warn() {} } }
  await assert.rejects(deleteSession(ctx, A, roots), { code: 'session-running' })
  assert.ok(await stat(join(roots.sessions, '--proj-one--', A)))
})

test('a legacy bare-uuid directory is located by its full session id', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-session-delete-legacy-'))
  const sessions = join(home, 'sessions')
  const legacy = '99999999-8888-7777-6666-555555555555'
  await mkdir(join(sessions, '_no-cwd', legacy), { recursive: true })
  await writeFile(join(sessions, '_no-cwd', legacy, 'session.v4.jsonl.zstd'), 'z')
  const found = await locateSession(sessions, 'session-' + legacy)
  assert.ok(found)
  assert.equal(found.project, '_no-cwd')
  assert.equal(found.name, legacy)
  const report = await deleteSession({ waterfall: async () => [] }, 'session-' + legacy, { sessions, cache: join(home, 'none') })
  assert.equal(report.bytes, 1)
  await assert.rejects(stat(join(sessions, '_no-cwd', legacy)), { code: 'ENOENT' })
})
test('an unknown session answers not-found', async () => {
  const { roots } = await makeHome()
  const ctx = { waterfall: async () => [], logger: { warn() {} } }
  await assert.rejects(deleteSession(ctx, 'session-ffffffff-ffff-ffff-ffff-ffffffffffff', roots), { code: 'not-found' })
})

test('a registered session whose files are already gone is still cleaned up', async () => {
  const { roots } = await makeHome()
  await rm(join(roots.sessions, '--proj-one--', A), { recursive: true, force: true })
  const calls = []
  const ctx = {
    get: (name) => name === 'workspaceRegistry' ? {
      archivedSessionIds: [A],
      pinnedSessionIds: [],
      list: () => [{ path: 'D:\\proj-one', sessionIds: [A], detachSession: async (id) => { calls.push(['detach', id]) } }],
      unarchiveSession: async (id) => { calls.push(['unarchive', id]) },
      unpinSession: async () => {},
    } : undefined,
    waterfall: async () => [],
    logger: { warn() {} },
  }
  const report = await deleteSession(ctx, A, roots)
  assert.equal(report.filesMissing, true)
  assert.equal(report.bytes, 0)
  assert.equal(report.detached, 1)
  assert.equal(report.archived, true)
  assert.equal(report.cacheRemoved, 1)
  assert.deepEqual(calls, [['detach', A]])
})

test('an unregistered session with no files is not-found', async () => {
  const { roots } = await makeHome()
  await rm(join(roots.sessions, '--proj-one--', A), { recursive: true, force: true })
  await rm(join(roots.cache, A + '.json'), { force: true })
  const ctx = { waterfall: async () => [], logger: { warn() {} } }
  await assert.rejects(deleteSession(ctx, A, roots), { code: 'not-found' })
})
test('a missing registry or sessions service still deletes the files', async () => {
  const { roots } = await makeHome()
  const ctx = { waterfall: async () => [] }
  const report = await deleteSession(ctx, B, roots)
  assert.equal(report.detached, 0)
  assert.equal(report.archived, false)
  await assert.rejects(stat(join(roots.sessions, '--proj-two--', B)), { code: 'ENOENT' })
})

test('deleting an archived Session keeps it archived', async () => {
  const { roots } = await makeHome()
  const calls = []
  const registry = {
    archivedSessionIds: [A],
    pinnedSessionIds: [],
    list: () => [{ path: 'D:\\proj-one', sessionIds: [A], detachSession: async (id) => { calls.push(['detach', id]) } }],
    unarchiveSession: async (id) => { calls.push(['unarchive', id]); registry.archivedSessionIds = [] },
    unpinSession: async () => {},
  }
  const ctx = {
    get: (name) => (name === 'workspaceRegistry' ? registry : undefined),
    waterfall: async () => [],
    logger: { warn() {}, info() {} },
  }
  const report = await deleteSession(ctx, A, roots)
  assert.equal(report.archived, true)
  assert.deepEqual(calls, [['detach', A]])
  assert.deepEqual(registry.archivedSessionIds, [A])
  assert.deepEqual(JSON.parse(await readFile(roots.stateFile, 'utf8')), [A])
  await assert.rejects(stat(join(roots.sessions, '--proj-one--', A)), { code: 'ENOENT' })
})
test('a live Session is archived first so its row disappears without a restart', async () => {
  const { roots } = await makeHome()
  const calls = []
  const registry = {
    archivedSessionIds: [],
    pinnedSessionIds: [],
    list: () => [{ path: 'D:\\proj-one', sessionIds: [A], detachSession: async (id) => { calls.push(['detach', id]) } }],
    archiveSession: async (id) => { calls.push(['archive', id]); registry.archivedSessionIds = [id] },
    unarchiveSession: async (id) => { calls.push(['unarchive', id]); registry.archivedSessionIds = [] },
    unpinSession: async () => {},
  }
  const ctx = {
    get: (name) => name === 'sessions' ? { get: (id) => (id === A ? { id } : undefined) } : name === 'workspaceRegistry' ? registry : undefined,
    waterfall: async () => [],
    logger: { warn() {} },
  }
  const report = await deleteSession(ctx, A, roots)
  assert.equal(report.live, true)
  assert.equal(report.hidden, true)
  assert.deepEqual(calls, [['archive', A], ['detach', A]])
  assert.deepEqual(registry.archivedSessionIds, [A])
  await assert.rejects(stat(join(roots.sessions, '--proj-one--', A)), { code: 'ENOENT' })
})
test('a Session the Host still holds in memory reports live', async () => {
  const { roots } = await makeHome()
  const ctx = {
    get: (name) => name === 'sessions' ? { get: (id) => (id === A ? { id } : undefined) } : undefined,
    waterfall: async () => [],
    logger: { warn() {} },
  }
  const report = await deleteSession(ctx, A, roots)
  assert.equal(report.live, true)
  const cold = await deleteSession(ctx, B, roots)
  assert.equal(cold.live, false)
})
test('the startup sweep releases archive and pin entries whose Session is gone', async () => {
  const { roots } = await makeHome()
  await mkdir(join(roots.stateFile, '..'), { recursive: true })
  await writeFile(roots.stateFile, JSON.stringify([A]))
  await rm(join(roots.sessions, '--proj-one--', A), { recursive: true, force: true })
  await rm(join(roots.cache, A + '.json'), { force: true })
  const calls = []
  const registry = {
    archivedSessionIds: [A, B],
    pinnedSessionIds: [A],
    unarchiveSession: async (id) => { calls.push(['unarchive', id]); registry.archivedSessionIds = registry.archivedSessionIds.filter((x) => x !== id) },
    unpinSession: async (id) => { calls.push(['unpin', id]); registry.pinnedSessionIds = registry.pinnedSessionIds.filter((x) => x !== id) },
  }
  const ctx = { get: (name) => (name === 'workspaceRegistry' ? registry : undefined), logger: { warn() {}, info() {} } }
  const released = await cleanupStaleArchives(ctx, roots)
  assert.deepEqual(released, [A])
  assert.deepEqual(calls, [['unarchive', A], ['unpin', A]])
  assert.deepEqual(registry.archivedSessionIds, [B])
})

test('a manually archived Session is never released', async () => {
  const { roots } = await makeHome()
  const calls = []
  const registry = {
    archivedSessionIds: [A],
    pinnedSessionIds: [],
    unarchiveSession: async (id) => { calls.push(id) },
    unpinSession: async () => {},
  }
  const ctx = { get: (name) => (name === 'workspaceRegistry' ? registry : undefined), logger: { warn() {}, info() {} } }
  assert.deepEqual(await cleanupStaleArchives(ctx, roots), [])
  assert.deepEqual(calls, [])
})

test('the sweep ignores an unknown id even when its files are missing', async () => {
  const { roots } = await makeHome()
  const ghost = 'session-99999999-0000-1111-2222-333333333333'
  const calls = []
  const registry = {
    archivedSessionIds: [ghost],
    pinnedSessionIds: [],
    unarchiveSession: async (id) => { calls.push(id) },
    unpinSession: async () => {},
  }
  await mkdir(join(roots.stateFile, '..'), { recursive: true })
  await writeFile(roots.stateFile, JSON.stringify([]))
  const ctx = { get: (name) => (name === 'workspaceRegistry' ? registry : undefined), logger: { warn() {}, info() {} } }
  assert.deepEqual(await cleanupStaleArchives(ctx, roots), [])
  assert.deepEqual(calls, [])
})

test('deleting a live Session records the id for the next startup', async () => {
  const { roots } = await makeHome()
  const registry = {
    archivedSessionIds: [],
    pinnedSessionIds: [],
    list: () => [{ path: 'D:\\proj-one', sessionIds: [A], detachSession: async () => {} }],
    archiveSession: async (id) => { registry.archivedSessionIds = [id] },
    unarchiveSession: async () => {},
    unpinSession: async () => {},
  }
  const ctx = {
    get: (name) => name === 'sessions' ? { get: (id) => (id === A ? { id } : undefined) } : name === 'workspaceRegistry' ? registry : undefined,
    waterfall: async () => [],
    logger: { warn() {}, info() {} },
  }
  await deleteSession(ctx, A, roots)
  const recorded = JSON.parse(await readFile(roots.stateFile, 'utf8'))
  assert.deepEqual(recorded, [A])
})
test('the sweep keeps an archived Session whose directory still exists', async () => {
  const { roots } = await makeHome()
  const calls = []
  const registry = {
    archivedSessionIds: [B],
    pinnedSessionIds: [],
    unarchiveSession: async (id) => { calls.push(id) },
    unpinSession: async () => {},
  }
  const ctx = { get: (name) => (name === 'workspaceRegistry' ? registry : undefined), logger: { warn() {}, info() {} } }
  assert.deepEqual(await cleanupStaleArchives(ctx, roots), [])
  assert.deepEqual(calls, [])
})

test('the sweep keeps a live Session even without files', async () => {
  const { roots } = await makeHome()
  await rm(join(roots.sessions, '--proj-one--', A), { recursive: true, force: true })
  await rm(join(roots.cache, A + '.json'), { force: true })
  const calls = []
  const registry = {
    archivedSessionIds: [A],
    pinnedSessionIds: [],
    unarchiveSession: async (id) => { calls.push(id) },
    unpinSession: async () => {},
  }
  const ctx = {
    get: (name) => name === 'sessions' ? { get: (id) => (id === A ? { id } : undefined) } : name === 'workspaceRegistry' ? registry : undefined,
    logger: { warn() {}, info() {} },
  }
  assert.deepEqual(await cleanupStaleArchives(ctx, roots), [])
  assert.deepEqual(calls, [])
})

test('the sweep refuses to act when the sessions root is unreadable', async () => {
  const calls = []
  const registry = {
    archivedSessionIds: [A],
    pinnedSessionIds: [],
    unarchiveSession: async (id) => { calls.push(id) },
    unpinSession: async () => {},
  }
  const ctx = { get: (name) => (name === 'workspaceRegistry' ? registry : undefined), logger: { warn() {}, info() {} } }
  assert.deepEqual(await cleanupStaleArchives(ctx, { sessions: 'Z:\\nope\\missing', cache: 'Z:\\nope' }), [])
  assert.deepEqual(calls, [])
})
test('the route path is a stable constant', () => {
  assert.equal(ROUTE_PATH, '/dsh-session-delete/api')
})
