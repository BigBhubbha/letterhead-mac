// Upgrade from 2.1: old inbox/assistant data is removed, batches, account and usage are kept.
// Run: LETTERHEAD_USERDATA=<seeded dir> LETTERHEAD_HARNESS=test/harness-cleanup.js electron .
const fs = require('fs'), path = require('path');
module.exports = (win) => {
  const { app } = require('electron');
  win.webContents.once('did-finish-load', async () => {
    const dir = app.getPath('userData'), has = n => fs.existsSync(path.join(dir, n));
    const st = JSON.parse(fs.readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    const res = {
      removed: ['mail.sqlite', 'mailcache', 'style.json', 'aikeys.json'].every(n => !has(n)),
      kept: ['batches.json', 'account.json', 'usage.json', 'draft.json'].every(has),
      batchesIntact: JSON.parse(fs.readFileSync(path.join(dir, 'batches.json'), 'utf8')).batches.length === 2,
      settingsPruned: !('aiEnabled' in st) && !('indexWindow' in st) && !('keepAwakeLid' in st) && st.cap === 450 && st.keepAwake === true && !!st._legacyCleaned,
    };
    res.ok = Object.values(res).every(Boolean);
    console.log('[cleanup] ' + JSON.stringify(res));
    app.exit(res.ok ? 0 : 1);
  });
};
