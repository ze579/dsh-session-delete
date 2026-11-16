/**
 * dsh-session-delete — Host half.
 *
 * Registers one loopback HTTP route the Client half calls when the user
 * confirms a deletion. The route resolves the Session's directory under
 * `$DSH_HOME/sessions`, refuses while the Session is running, removes the
 * directory, then drops the id from the Workspace registry (archive set,
 * workspace accounting, pins) and the projection cache.
 *
 * @module dsh-session-delete
 */
import { promises as fsp } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const inject = ['webServer']

/** Bundle version reported in every response, so a reload is observable. */
export const PLUGIN_VERSION = '0.1.8'

/** Exact route path the Client half posts to. */
export const ROUTE_PATH = '/dsh-session-delete/api'

/** Only a real Session id may reach a filesystem join. */
const SESSION_ID = /^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** Upper bound for the tiny JSON request body. */
const MAX_BODY_BYTES = 4096

/** A refusal with an HTTP status, a stable code, and a user-facing message. */
export class DeleteError extends Error {
  /**
   * @param status - HTTP status the route answers with.
   * @param code - stable machine-readable code.
   * @param message - message the dialog shows.
   */
  constructor(status, code, message) {
    super(message)
    this.name = 'DeleteError'
    this.status = status
    this.code = code
  }
}

/**
 * Activate the route.
 * @param ctx - plugin context carrying `webServer`.
 * @param config - optional overrides: `dshHome`, `sessionsRoot`.
 */
export function apply(ctx, config = {}) {
  const home = typeof config.dshHome === 'string' && config.dshHome.length > 0
    ? config.dshHome
    : (process.env.DSH_HOME || join(homedir(), '.dsh'))
  const roots = {
    sessions: typeof config.sessionsRoot === 'string' && config.sessionsRoot.length > 0
      ? config.sessionsRoot
      : join(home, 'sessions'),
    cache: join(home, 'storages', 'session_projcache', 'sessions'),
    stateFile: join(home, 'dsh-session-delete', 'purged.json'),
  }
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE_PATH,
    handler: (request, response) => serve(ctx, request, response, roots),
  }), 'dsh-session-delete: route')
  if (config.startupCleanup !== false) {
    const delay = Number.isFinite(config.startupCleanupDelayMs) ? Number(config.startupCleanupDelayMs) : 8000
    ctx.effect(() => {
      const timer = setTimeout(() => {
        void cleanupStaleArchives(ctx, roots).catch((error) => {
          ctx.logger?.warn?.('dsh-session-delete: startup cleanup failed: %s', error)
        })
      }, delay)
      return () => clearTimeout(timer)
    }, 'dsh-session-delete: startup cleanup')
  }
}

/**
 * Handle one request end to end.
 * @param ctx - plugin context.
 * @param request - Node request.
 * @param response - Node response.
 * @param roots - resolved session and cache roots.
 */
async function serve(ctx, request, response, roots) {
  try {
    if (request.method !== 'POST') {
      throw new DeleteError(405, 'method', '只接受 POST 请求')
    }
    assertOrigin(ctx, request)
    const body = await readJsonBody(request)
    const sessionId = body !== null && typeof body === 'object' ? String(body.sessionId ?? '') : ''
    if (!SESSION_ID.test(sessionId)) {
      throw new DeleteError(400, 'bad-request', '会话 ID 不合法')
    }
    const result = await deleteSession(ctx, sessionId, roots)
    send(response, 200, { ok: true, plugin: PLUGIN_VERSION, ...result })
  } catch (error) {
    const status = error instanceof DeleteError ? error.status : 500
    const code = error instanceof DeleteError ? error.code : 'internal'
    const message = error instanceof Error ? error.message : String(error)
    send(response, status, { ok: false, plugin: PLUGIN_VERSION, code, message })
  }
}

/**
 * Same-origin guard: a browser send carries Origin; a local tool may omit it.
 * @param ctx - plugin context carrying `webServer`.
 * @param request - Node request.
 */
function assertOrigin(ctx, request) {
  const origin = request.headers.origin
  if (origin === undefined || origin === '') return
  let expected
  try {
    expected = ctx.webServer.getOrigin()
  } catch {
    return
  }
  if (origin !== expected) throw new DeleteError(403, 'origin', '请求来源不被允许')
}

/**
 * Read and parse the JSON body with a small cap.
 * @param request - Node request.
 * @returns the parsed value.
 */
function readJsonBody(request) {
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    let size = 0
    const chunks = []
    const fail = (error) => {
      if (settled) return
      settled = true
      rejectPromise(error)
    }
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        fail(new DeleteError(413, 'too-large', '请求体过大'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('error', (error) => fail(error))
    request.on('end', () => {
      if (settled) return
      let value
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        fail(new DeleteError(400, 'bad-request', '请求体不是合法 JSON'))
        return
      }
      settled = true
      resolvePromise(value)
    })
  })
}

/**
 * Answer with JSON.
 * @param response - Node response.
 * @param status - HTTP status.
 * @param payload - JSON payload.
 */
function send(response, status, payload) {
  if (response.headersSent) return
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(payload))
}

/**
 * Delete one Session: files first, then registry accounting and cache.
 * @param ctx - plugin context.
 * @param sessionId - validated Session id.
 * @param roots - resolved session and cache roots.
 * @returns the deletion report.
 */
export async function deleteSession(ctx, sessionId, roots) {
  const location = await locateSession(roots.sessions, sessionId)
  const activity = await runningActivity(ctx, sessionId)
  if (activity.length > 0) {
    const kinds = [...new Set(activity.map((entry) => (entry && typeof entry.kind === 'string' ? entry.kind : 'activity')))]
    throw new DeleteError(409, 'session-running', `会话正在运行（${kinds.join('、')}），结束后才能删除`)
  }
  const live = isLive(ctx, sessionId)
  const warnings = []
  // Deleting must never un-hide a Session: an already archived row stays
  // archived (it is the only thing keeping a still-live Session out of the
  // lists), and a live one is archived for the same reason. The startup sweep
  // releases these markers once nothing can render the Session any more.
  const wasArchived = isArchived(ctx, sessionId)
  let hidden = wasArchived
  if (live && !wasArchived) {
    hidden = await hideLiveSession(ctx, sessionId, warnings)
  }
  if (location !== null) await fsp.rm(location.dir, { recursive: true, force: true })
  if (hidden) await rememberPurged(roots, sessionId)
  const registry = await forgetInRegistry(ctx, sessionId, warnings)
  const cacheRemoved = await forgetInCache(roots.cache, sessionId, warnings)
  const registered = registry.archived || hidden || registry.detached > 0

  // A directory removed outside this plugin (or a half-finished earlier attempt)
  // still leaves registry rows and cache behind; cleaning those is the deletion.
  if (location === null && !registered && cacheRemoved === 0) {
    throw new DeleteError(404, 'not-found', '没有找到这个会话的记录')
  }
  return {
    sessionId,
    project: location === null ? null : location.project,
    files: location === null ? 0 : location.files,
    bytes: location === null ? 0 : location.bytes,
    filesMissing: location === null,
    live,
    hidden,
    cacheRemoved,
    ...registry,
    ...warnings.length > 0 ? { warnings } : {},
  }
}

/**
 * Find `<root>/<project>/<sessionId>` without trusting an encoded path.
 * @param root - sessions root.
 * @param sessionId - validated Session id.
 * @returns the directory and its size, or null.
 */
export async function locateSession(root, sessionId) {
  const base = resolve(root)
  let projects
  try {
    projects = await fsp.readdir(base, { withFileTypes: true })
  } catch {
    return null
  }
  // Older layouts stored the bare uuid, newer ones the full `session-` id.
  const names = [sessionId]
  if (sessionId.startsWith('session-')) names.push(sessionId.slice('session-'.length))
  for (const project of projects) {
    if (!project.isDirectory()) continue
    for (const name of names) {
      const dir = join(base, project.name, name)
      if (dir !== resolve(base, project.name, name)) continue
      let stats
      try {
        stats = await fsp.stat(dir)
      } catch {
        continue
      }
      if (!stats.isDirectory()) continue
      const measured = await measure(dir)
      return { dir, project: project.name, name, ...measured }
    }
  }
  return null
}

/**
 * Sum a directory tree.
 * @param dir - directory to walk.
 * @returns file count and total bytes.
 */
async function measure(dir) {
  let files = 0
  let bytes = 0
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await measure(path)
      files += nested.files
      bytes += nested.bytes
      continue
    }
    try {
      const stats = await fsp.stat(path)
      files += 1
      bytes += stats.size
    } catch {
      // A vanished file contributes nothing.
    }
  }
  return { files, bytes }
}

/**
 * Ask the `workspace/session-activity` waterfall whether work is running.
 * @param ctx - plugin context.
 * @param sessionId - Session id.
 * @returns reported activity entries; a failing listener fails closed.
 */
async function runningActivity(ctx, sessionId) {
  if (typeof ctx.waterfall !== 'function') return []
  try {
    const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
    return Array.isArray(activity) ? activity : []
  } catch (error) {
    ctx.logger?.warn?.('dsh-session-delete: activity check failed; refusing to delete %s (%s)', sessionId, error)
    return [{ kind: 'unknown' }]
  }
}

/**
 * Drop the id from the archive set, workspace accounting, and pins.
 * @param ctx - plugin context.
 * @param sessionId - Session id.
 * @param warnings - collector for non-fatal failures.
 * @returns what the registry let go of.
 */
async function forgetInRegistry(ctx, sessionId, warnings) {
  const registry = optionalService(ctx, 'workspaceRegistry')
  if (registry === undefined || registry === null || typeof registry.list !== 'function') {
    warnings.push('工作区注册表不可用，未能清理索引')
    return { archived: false, detached: 0, workspace: null }
  }
  let archived = false
  let detached = 0
  let workspace = null
  try {
    if (Array.isArray(registry.archivedSessionIds) && registry.archivedSessionIds.includes(sessionId)) {
      archived = true
      // The marker stays: removing it here is what made a deleted archived
      // Session pop back as an unarchived row. The startup sweep clears it.
    }
  } catch (error) {
    warnings.push(`归档状态读取失败：${error instanceof Error ? error.message : String(error)}`)
  }
  try {
    if (Array.isArray(registry.pinnedSessionIds) && registry.pinnedSessionIds.includes(sessionId)
      && typeof registry.unpinSession === 'function') {
      await registry.unpinSession(sessionId)
    }
  } catch (error) {
    warnings.push(`置顶记录清理失败：${error instanceof Error ? error.message : String(error)}`)
  }
  let entities = []
  try {
    entities = registry.list()
  } catch (error) {
    warnings.push(`工作区列表读取失败：${error instanceof Error ? error.message : String(error)}`)
  }
  for (const entity of entities) {
    try {
      if (!Array.isArray(entity.sessionIds) || !entity.sessionIds.includes(sessionId)) continue
      await entity.detachSession(sessionId)
      detached += 1
      workspace = typeof entity.path === 'string' ? entity.path : null
    } catch (error) {
      warnings.push(`工作区记录清理失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { archived, detached, workspace }
}

/**
 * Drop archive and pin entries whose Session no longer exists. A deleted
 * Session stays archived while the Host still holds it in memory; once DSH
 * restarts nothing can render it, so the entry is dead weight in the registry.
 * Runs once per start, after the registry had time to index stored Sessions.
 * @param ctx - plugin context.
 * @param roots - resolved session and cache roots.
 * @returns ids that were released.
 */
export async function cleanupStaleArchives(ctx, roots) {
  const registry = optionalService(ctx, 'workspaceRegistry')
  if (registry === undefined || registry === null) return []
  // Only ids this plugin hid itself are candidates: a Session the user archived
  // by hand must never be touched, whatever state its files are in.
  const owned = new Set(await readPurged(roots))
  let archived = []
  let pinned = []
  try {
    if (Array.isArray(registry.archivedSessionIds)) archived = [...registry.archivedSessionIds]
    if (Array.isArray(registry.pinnedSessionIds)) pinned = [...registry.pinnedSessionIds]
  } catch {
    return []
  }
  const ids = [...new Set([...archived, ...pinned])].filter((id) => owned.has(id))
  if (ids.length === 0) return []
  const present = await listSessionDirectories(roots.sessions)
  if (present === null) return []
  const released = []
  for (const id of ids) {
    if (isLive(ctx, id)) continue
    const bare = typeof id === 'string' && id.startsWith('session-') ? id.slice('session-'.length) : String(id)
    if (present.has(id) || present.has(bare)) continue
    if (await exists(join(roots.cache, String(id) + '.json')) || await exists(join(roots.cache, bare + '.json'))) continue
    try {
      if (archived.includes(id) && typeof registry.unarchiveSession === 'function') await registry.unarchiveSession(id)
      if (pinned.includes(id) && typeof registry.unpinSession === 'function') await registry.unpinSession(id)
      released.push(id)
    } catch (error) {
      ctx.logger?.warn?.('dsh-session-delete: cannot release %s (%s)', id, error)
    }
  }
  if (released.length > 0) {
    ctx.logger?.info?.('dsh-session-delete: released %d stale archive/pin entries', released.length)
  }
  return released
}

/**
 * Ids this plugin archived itself, so the startup sweep owns them.
 * @param roots - resolved roots carrying the state file.
 * @returns the recorded ids, or none when the file is absent or malformed.
 */
async function readPurged(roots) {
  if (typeof roots.stateFile !== 'string') return []
  try {
    const parsed = JSON.parse(await fsp.readFile(roots.stateFile, 'utf8'))
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

/**
 * Remember one id this plugin hid, so a later start can release the marker.
 * @param roots - resolved roots carrying the state file.
 * @param sessionId - Session id that was archived by this plugin.
 */
async function rememberPurged(roots, sessionId) {
  if (typeof roots.stateFile !== 'string') return
  const ids = new Set(await readPurged(roots))
  ids.add(sessionId)
  try {
    await fsp.mkdir(dirname(roots.stateFile), { recursive: true })
    await fsp.writeFile(roots.stateFile, JSON.stringify([...ids], null, 2) + '\n', 'utf8')
  } catch {
    // A failed bookkeeping write only costs one stale marker; never fail the delete.
  }
}

/**
 * Collect every stored Session directory name under the sessions root.
 * @param sessionsRoot - sessions root.
 * @returns the names, or null when the root cannot be read (the sweep must
 *   then refuse to touch anything).
 */
async function listSessionDirectories(sessionsRoot) {
  const present = new Set()
  let projects
  try {
    projects = await fsp.readdir(sessionsRoot, { withFileTypes: true })
  } catch {
    return null
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    let entries
    try {
      entries = await fsp.readdir(join(sessionsRoot, project.name))
    } catch {
      // One unreadable project would make every Session under it look gone.
      return null
    }
    for (const entry of entries) present.add(entry)
  }
  return present
}

/**
 * Whether a path exists.
 * @param path - absolute path.
 * @returns true when it can be stat-ed.
 */
async function exists(path) {
  try {
    await fsp.stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Whether the registry currently hides this Session.
 * @param ctx - plugin context.
 * @param sessionId - Session id.
 * @returns true while the archive set lists it.
 */
function isArchived(ctx, sessionId) {
  const registry = optionalService(ctx, 'workspaceRegistry')
  if (registry === undefined || registry === null) return false
  try {
    return Array.isArray(registry.archivedSessionIds) && registry.archivedSessionIds.includes(sessionId)
  } catch {
    return false
  }
}

/**
 * Hide a Session the Host still holds. Its row disappears from the default
 * lists as soon as the archive set changes, which the Client already watches.
 * @param ctx - plugin context.
 * @param sessionId - Session id.
 * @param warnings - collector for non-fatal failures.
 * @returns true when the archive set now hides it.
 */
async function hideLiveSession(ctx, sessionId, warnings) {
  const registry = optionalService(ctx, 'workspaceRegistry')
  if (registry === undefined || registry === null || typeof registry.archiveSession !== 'function') return false
  try {
    await registry.archiveSession(sessionId)
    return true
  } catch (error) {
    warnings.push(`隐藏会话失败：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Whether the Host still holds this Session in memory. Such a Session keeps
 * rendering from memory until DSH restarts, even after its files are gone.
 * @param ctx - plugin context.
 * @param sessionId - Session id.
 * @returns true while the Session store owns it.
 */
function isLive(ctx, sessionId) {
  const sessions = optionalService(ctx, 'sessions')
  if (sessions === undefined || sessions === null || typeof sessions.get !== 'function') return false
  try {
    return sessions.get(sessionId) !== undefined
  } catch {
    return false
  }
}

/**
 * Read a service without declaring it required: Cordis throws on a plain
 * property access for a service this plugin did not inject.
 * @param ctx - plugin context.
 * @param name - service name.
 * @returns the service, or undefined when absent.
 */
function optionalService(ctx, name) {
  if (typeof ctx.get === 'function') return ctx.get(name)
  try {
    return ctx[name]
  } catch {
    return undefined
  }
}

/**
 * Remove this Session's projection cache entries.
 * @param cacheRoot - projection cache directory.
 * @param sessionId - Session id.
 * @param warnings - collector for non-fatal failures.
 * @returns how many cache files were removed.
 */
async function forgetInCache(cacheRoot, sessionId, warnings) {
  const names = new Set([`${sessionId}.json`, `${sessionId.replace(/^session-/, '')}.json`])
  let removed = 0
  for (const name of names) {
    try {
      await fsp.unlink(join(cacheRoot, name))
      removed += 1
    } catch (error) {
      if (error && error.code === 'ENOENT') continue
      warnings.push(`缓存清理失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return removed
}
