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
  on: (ch, fn) => { const h = (e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.removeListener(ch, h); },
});
