import assert from 'node:assert/strict'
import test from 'node:test'

/** Minimal React stand-in: enough for the module to register itself. */
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  Fragment: 'fragment',
  useEffect: () => {},
  useRef: () => ({ current: null }),
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

let loaded = null
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => { loaded = entry },
  },
}

await import('../client.js')

test('the bundle registers one lazy factory under the package id', () => {
  assert.ok(loaded)
  assert.equal(loaded.id, 'dsh-session-delete')
})

test('apply wires the session menu, the overlay, and the dictionaries', () => {
  const captured = { menus: [], slotEntries: [], dictionaries: [] }
  const ctx = {
    effect: (fn) => fn(),
    locale: {
      register: (ns, dictionaries) => { captured.dictionaries.push([ns, dictionaries]); return () => {} },
      bind: () => (key, vars) => {
        const table = {
          menu: '删除会话',
          failed: '删除失败',
          'title1': '删除会话？',
        }
        const text = table[key] ?? key
        return vars ? text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : text
      },
    },
    contextMenus: { register: (contribution) => { captured.menus.push(contribution); return () => {} } },
    slots: {
      inject: (name, callback) => { captured.overlay = name; callback() },
      register: (options, component) => { captured.slotEntries.push({ options, component }); return () => {} },
    },
  }
  const plugin = loaded.factory((name) => {
    assert.equal(name, 'react')
    return React
  })
  assert.deepEqual(plugin.inject, ['slots', 'contextMenus', 'locale'])
  plugin.apply(ctx)
  assert.equal(captured.dictionaries.length, 1)
  assert.equal(captured.dictionaries[0][0], 'dsh-session-delete')
  assert.equal(captured.menus.length, 1)
  const contribution = captured.menus[0]
  assert.equal(contribution.target, 'session')
  assert.ok(contribution.order > 600)
  const actions = contribution.resolve({ sessionId: 'session-11111111-2222-3333-4444-555555555555', displayTitle: 'Example' })
  assert.equal(actions.length, 1)
  assert.equal(actions[0].id, 'delete-session')
  assert.equal(actions[0].label, '删除会话')
  assert.equal(actions[0].danger, true)
  assert.equal(typeof actions[0].run, 'function')
  actions[0].run()
  assert.equal(captured.overlay, 'shell.overlay')
  assert.equal(captured.slotEntries.length, 1)
  assert.equal(captured.slotEntries[0].options.id, 'dsh-session-delete.dialog')
  assert.equal(typeof captured.slotEntries[0].component, 'function')
})
