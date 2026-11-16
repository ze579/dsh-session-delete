/**
 * dsh-session-delete — Client half.
 *
 * Adds "Delete session" to the Session context menu and asks twice before the
 * Host removes anything. The dialog is a local component: external plugins may
 * not load the Harness primitive packages, so the markup and styles below copy
 * the shared Modal's structure and theme tokens.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useRef, useSyncExternalStore } = React

    const NS = 'dsh-session-delete'
    const ROUTE = '/dsh-session-delete/api'
    const PREFIX = 'xsd'

    const zh = {
      menu: '删除会话',
      title1: '删除会话？',
      desc1: '「{title}」的对话记录会从这台电脑上删除。',
      title2: '再次确认删除',
      desc2: '删除后无法恢复，也不会进入回收站。',
      cancel: '取消',
      next: '继续',
      confirm: '永久删除',
      pending: '正在删除…',
      done: '已删除会话：{title}',
      restartNote: '该会话仍在内存中，重启 DSH 后才会从列表消失',
      failed: '删除失败',
      closeAria: '关闭对话框',
    }
    const en = {
      menu: 'Delete session',
      title1: 'Delete this session?',
      desc1: 'The conversation “{title}” will be removed from this computer.',
      title2: 'Confirm deletion',
      desc2: 'This cannot be undone, and the conversation does not go to the recycle bin.',
      cancel: 'Cancel',
      next: 'Continue',
      confirm: 'Delete permanently',
      pending: 'Deleting…',
      done: 'Session deleted: {title}',
      restartNote: 'It is still in memory; restart DSH to drop it from the list',
      failed: 'Delete failed',
      closeAria: 'Close dialog',
    }

    const CSS = [
      '.xsd-root{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto}',
      '.xsd-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1, rgba(0,0,0,.45))}',
      '.xsd-dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;gap:20px;width:min(380px,100%);padding:0 0 24px;overflow:hidden;border:0;border-radius:var(--dsw-radius-panel, 12px);background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-bg-layer-1, #fff));box-shadow:var(--dsw-elevation-prominent, 0 8px 32px rgba(0,0,0,.24))}',
      '.xsd-dialog:focus{outline:none}',
      '@media(prefers-reduced-motion:reduce){.xsd-dialog{animation:none}}',
      '.xsd-header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 14px 12px 24px}',
      '.xsd-title{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary, #111)}',
      '.xsd-close{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:none;border-radius:var(--dsw-radius-sm, 6px);background:transparent;cursor:pointer;font-size:18px;line-height:1;color:var(--dsw-alias-label-secondary, #666)}',
      '@media(hover:hover){.xsd-close:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}}',
      '.xsd-close:disabled{cursor:not-allowed;opacity:.4}',
      '.xsd-desc{margin:0;padding:0 24px;font-size:14px;line-height:22px;font-weight:400;color:var(--dsw-alias-label-primary, #111)}',
      '.xsd-error{margin:0;padding:0 24px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-error, #d33)}',
      '.xsd-status{margin:0;padding:0 24px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary, #888)}',
      '.xsd-footer{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding:0 24px}',
      '.xsd-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md, 8px);background:transparent;cursor:pointer;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary, #111);font-family:inherit}',
      '.xsd-btn:disabled{cursor:not-allowed;opacity:.4}',
      '.xsd-outline{box-shadow:inset 0 0 0 var(--dsh-hairline-width, .5px) var(--dsh-button-outline-color, var(--dsw-alias-border-l3, rgba(0,0,0,.16)))}',
      '@media(hover:hover){.xsd-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06))}}',
      '.xsd-danger{color:var(--dsw-alias-label-error, #d33)}',
      '@media(hover:hover){.xsd-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger, rgba(221,51,51,.1))}}',
      '.xsd-toast-note{opacity:.75}',
      '.xsd-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:1001;max-width:min(480px,calc(100vw - 48px));padding:10px 16px;border-radius:var(--dsw-radius-md, 8px);background:var(--dsw-alias-toast-bg, rgba(20,20,20,.92));color:var(--dsw-alias-toast-label, #fff);font-size:13px;line-height:20px;box-shadow:var(--dsw-elevation-prominent, 0 8px 32px rgba(0,0,0,.24));pointer-events:none}',
    ].join('\n')

    /**
     * Format a dictionary entry, substituting {name} placeholders.
     * @param dictionary - language table.
     * @param key - entry name.
     * @param vars - optional substitutions.
     * @returns the formatted text.
     */
    function format(dictionary, key, vars) {
      const template = typeof dictionary[key] === 'string' ? dictionary[key] : key
      if (vars === undefined) return template
      return template.replace(/\{(\w+)\}/g, function (match, name) {
        return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
      })
    }

    /** One pending deletion, the shared outcome notice, and their subscribers. */
    function createStore() {
      let dialog = null
      let toast = null
      let timer = null
      const dialogListeners = new Set()
      const toastListeners = new Set()
      const publishDialog = function () { for (const listener of dialogListeners) listener() }
      const publishToast = function () { for (const listener of toastListeners) listener() }
      const showToast = function (title, live) {
        toast = { title: title, live: live === true, seq: Date.now() }
        publishToast()
        if (timer !== null) clearTimeout(timer)
        timer = setTimeout(function () { toast = null; timer = null; publishToast() }, 3200)
      }
      return {
        hooks: {
          dialog: {
            getSnapshot: function () { return dialog },
            subscribe: function (listener) { dialogListeners.add(listener); return function () { dialogListeners.delete(listener) } },
          },
          toast: {
            getSnapshot: function () { return toast },
            subscribe: function (listener) { toastListeners.add(listener); return function () { toastListeners.delete(listener) } },
          },
        },
        open: function (sessionId, title) {
          dialog = { sessionId: sessionId, title: title || sessionId, stage: 1, busy: false, error: null }
          publishDialog()
        },
        next: function () {
          if (dialog === null || dialog.stage !== 1) return
          dialog = { sessionId: dialog.sessionId, title: dialog.title, stage: 2, busy: false, error: null }
          publishDialog()
        },
        cancel: function () {
          if (dialog === null || dialog.busy) return
          dialog = null
          publishDialog()
        },
        commit: async function () {
          if (dialog === null || dialog.busy) return
          const current = dialog
          dialog = { sessionId: current.sessionId, title: current.title, stage: 2, busy: true, error: null }
          publishDialog()
          try {
            const response = await fetch(ROUTE, {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json', 'x-dsh-session-delete': '1' },
              body: JSON.stringify({ sessionId: current.sessionId }),
            })
            const payload = await response.json().catch(function () { return null })
            if (!response.ok || payload === null || payload.ok !== true) {
              const message = payload !== null && typeof payload.message === 'string' ? payload.message : 'HTTP ' + response.status
              throw new Error(message)
            }
            dialog = null
            publishDialog()
            showToast(current.title, payload.live === true && payload.hidden !== true)
          } catch (error) {
            dialog = {
              sessionId: current.sessionId,
              title: current.title,
              stage: 2,
              busy: false,
              error: error instanceof Error ? error.message : String(error),
            }
            publishDialog()
          }
        },
        dispose: function () {
          if (timer !== null) { clearTimeout(timer); timer = null }
          dialog = null
          toast = null
        },
      }
    }

    /**
     * Subscribe to one plain snapshot source.
     * @param source - observable snapshot.
     * @returns the current value.
     */
    function useSnapshot(source) {
      return useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot)
    }

    /** Theme-aware styles for the dialog; removed with the component. */
    function Styles() {
      return h('style', { 'data-dsh-session-delete': 'styles' }, CSS)
    }

    /**
     * Modal dialog with focus restore, Escape cancellation, and a Tab trap.
     * @param props - pending state, the store, and the translator.
     */
    function Dialog(props) {
      const state = props.state
      const store = props.store
      const t = props.t
      const dialogRef = useRef(null)
      const previous = useRef(null)
      const titleId = PREFIX + '-title'

      useEffect(function () {
        previous.current = document.activeElement
        if (dialogRef.current !== null) dialogRef.current.focus()
        return function () {
          const target = previous.current
          if (target !== null && typeof target.focus === 'function') target.focus()
        }
      }, [state.stage])

      useEffect(function () {
        const onKey = function (event) {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            store.cancel()
            return
          }
          if (event.key !== 'Tab' || dialogRef.current === null) return
          const focusable = dialogRef.current.querySelectorAll('button:not(:disabled), [tabindex]:not([tabindex="-1"])')
          if (focusable.length === 0) return
          const first = focusable[0]
          const last = focusable[focusable.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKey, true)
        return function () { document.removeEventListener('keydown', onKey, true) }
      }, [store])

      const title = state.stage === 1 ? t('title1') : t('title2')
      const description = state.stage === 1
        ? t('desc1', { title: state.title })
        : t('desc2', { title: state.title })
      const primary = state.stage === 1
        ? h('button', {
            type: 'button',
            className: 'xsd-btn xsd-outline',
            onClick: function () { store.next() },
          }, t('next'))
        : h('button', {
            type: 'button',
            className: 'xsd-btn xsd-outline xsd-danger',
            disabled: state.busy,
            onClick: function () { store.commit() },
          }, t('confirm'))

      return h('div', {
        className: 'xsd-root',
        onMouseDown: function (event) {
          if (event.target === event.currentTarget) store.cancel()
        },
      },
        h('div', { className: 'xsd-mask' }),
        h('div', {
          ref: dialogRef,
          className: 'xsd-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': titleId,
          tabIndex: -1,
        },
          h('div', { className: 'xsd-header' },
            h('h2', { className: 'xsd-title', id: titleId }, title),
            h('button', {
              type: 'button',
              className: 'xsd-close',
              'aria-label': t('closeAria'),
              disabled: state.busy,
              onClick: function () { store.cancel() },
            }, '\u00d7'),
          ),
          h('p', { className: 'xsd-desc' }, description),
          state.error !== null ? h('p', { className: 'xsd-error', role: 'alert' }, state.error) : null,
          state.busy ? h('p', { className: 'xsd-status', role: 'status' }, t('pending')) : null,
          h('div', { className: 'xsd-footer' },
            h('button', {
              type: 'button',
              className: 'xsd-btn xsd-outline',
              disabled: state.busy,
              onClick: function () { store.cancel() },
            }, t('cancel')),
            primary,
          ),
        ),
      )
    }

    /**
     * The shell.overlay entry: the pending dialog and the outcome notice.
     * @param props - the store and the translator.
     */
    function Overlay(props) {
      const state = useSnapshot(props.store.hooks.dialog)
      const toast = useSnapshot(props.store.hooks.toast)
      return h(React.Fragment, null,
        h(Styles, null),
        state === null ? null : h(Dialog, { key: state.sessionId, state: state, store: props.store, t: props.t }),
        toast === null ? null : h('div', { className: 'xsd-toast', role: 'status' },
          props.t('done', { title: toast.title }),
          toast.live ? h('span', { className: 'xsd-toast-note' }, ' · ' + props.t('restartNote')) : null,
        ),
      )
    }

    return {
      inject: ['slots', 'contextMenus', 'locale'],
      apply: function (ctx) {
        const store = createStore()
        const fallback = function (key, vars) { return format(zh, key, vars) }
        const bound = typeof ctx.locale.bind === 'function' ? ctx.locale.bind(NS) : fallback
        const translate = function (key, vars) {
          try {
            const text = bound(key, vars)
            return typeof text === 'string' && text !== '' ? text : format(zh, key, vars)
          } catch (error) {
            return format(zh, key, vars)
          }
        }
        ctx.effect(function () { return ctx.locale.register(NS, { zh: zh, en: en }) }, 'dsh-session-delete: dictionaries')
        ctx.effect(function () {
          return ctx.contextMenus.register({
            id: 'dsh-session-delete',
            target: 'session',
            order: 640,
            resolve: function (target) {
              return [{
                id: 'delete-session',
                label: translate('menu'),
                danger: true,
                separatorBefore: true,
                failureLabel: translate('failed'),
                run: function () { store.open(String(target.sessionId), target.displayTitle) },
              }]
            },
          })
        }, 'dsh-session-delete: session menu')
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-session-delete.dialog',
            order: 60,
            locale: NS,
            inject: function () { return { store: store, t: translate } },
          }, Overlay)
        })
        ctx.effect(function () { return function () { store.dispose() } }, 'dsh-session-delete: cleanup')
      },
    }
  },
})
