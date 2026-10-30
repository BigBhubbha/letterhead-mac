'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
contextBridge.exposeInMainWorld('lh', {
  platform: process.platform,
  account: { get: () => inv('account:get'), save: a => inv('account:save', a), clear: () => inv('account:clear'), verify: a => inv('account:verify', a) },
  draft: { get: () => inv('draft:get'), save: d => inv('draft:save', d) },
  settings: { get: () => inv('settings:get'), save: s => inv('settings:save', s) },
  usage: { get: () => inv('usage:get'), reset: () => inv('usage:reset') },
  drafts: { list: () => inv('drafts:list'), verify: a => inv('drafts:verify', a) },
  csvOpen: () => inv('csv:open'),
  attachPick: () => inv('attach:pick'),
  attachStat: p => inv('attach:stat', p),
  sendTest: x => inv('send:test', x),
  openExternal: u => inv('open:external', u),
  campaign: {
    start: c => inv('campaign:start', c), pause: () => inv('campaign:pause'), resume: () => inv('campaign:resume'),
    cancel: () => inv('campaign:cancel'), retry: () => inv('campaign:retry'), snapshot: () => inv('campaign:snapshot'),
    clear: () => inv('campaign:clear'), exportCsv: () => inv('campaign:export'),
  },
  batches: {
    list: () => inv('batches:list'), get: id => inv('batches:get', id), save: b => inv('batches:save', b), duplicate: id => inv('batches:duplicate', id),
    remove: id => inv('batches:remove', id), cancel: id => inv('batches:cancel', id), reschedule: (id, at) => inv('batches:reschedule', id, at),
    sendNow: id => inv('batches:sendNow', id), pause: id => inv('batches:pause', id), resume: id => inv('batches:resume', id),
    retry: id => inv('batches:retry', id), exportCsv: id => inv('batches:export', id),
  },
  app: { info: () => inv('app:info'), setOpenAtLogin: on => inv('app:openAtLogin', on) },
  update: { state: () => inv('update:state'), check: () => inv('update:check'), install: () => inv('update:install') },
  power: { status: () => inv('power:status'), restore: () => inv('power:restore') },
  mail: {
    status: () => inv('mail:status'), restart: () => inv('mail:restart'), folders: () => inv('mail:folders'), threads: (f, o) => inv('mail:threads', f, o),
    thread: k => inv('mail:thread', k), body: (f, u) => inv('mail:body', f, u), sync: f => inv('mail:sync', f), more: f => inv('mail:more', f),
    action: a => inv('mail:action', a), search: q => inv('mail:search', q), contacts: q => inv('mail:contacts', q), select: f => inv('mail:select', f),
    attachment: (f, u, i, how) => inv('mail:attachment', f, u, i, how), send: d => inv('mail:send', d), saveDraft: d => inv('mail:saveDraft', d),
    deleteDraft: d => inv('mail:deleteDraft', d), openLink: u => inv('mail:openLink', u),
  },
  ai: { status: () => inv('ai:status'), setKey: (p, k) => inv('ai:setKey', p, k), test: () => inv('ai:test') },
  style: { index: n => inv('style:index', n), progress: () => inv('style:progress'), profile: () => inv('style:profile'), saveProfile: p => inv('style:saveProfile', p), clear: () => inv('style:clear') },
  assist: {
    draft: (id, o) => inv('assist:draft', id, o), list: () => inv('assist:list'), candidates: () => inv('assist:candidates'), suggestion: id => inv('assist:suggestion', id),
    setDraft: (k, t) => inv('assist:setDraft', k, t), dismiss: k => inv('assist:dismiss', k), hold: k => inv('assist:hold', k), sendNow: k => inv('assist:sendNow', k),
    autolog: () => inv('assist:autolog'), queueBacklog: ids => inv('assist:queueBacklog', ids),
  },
  diag: { report: (where, msg) => inv('diag:report', where, msg), log: () => inv('diag:log'), copy: () => inv('diag:copy'), reveal: () => inv('diag:reveal') },
  on: (ch, fn) => { const h = (e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); },
});
