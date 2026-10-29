// Build: bundle main process with esbuild into a staging dir, package for darwin arm64 + x64,
// drop unused Chromium locales, so the download stays small.
const { packager } = require('@electron/packager');
const esbuild = require('esbuild');
const fs = require('fs'), path = require('path');
const STAGE = path.join(__dirname, 'stage');
(async () => {
  fs.rmSync(STAGE, { recursive: true, force: true });
  fs.mkdirSync(path.join(STAGE, 'src'), { recursive: true });
  await esbuild.build({ entryPoints: ['src/main.js'], bundle: true, platform: 'node', target: 'node20', external: ['electron'], minify: true, outfile: path.join(STAGE, 'src/main.js'), logLevel: 'warning' });
  fs.copyFileSync('src/preload.js', path.join(STAGE, 'src/preload.js'));
  fs.copyFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'), path.join(STAGE, 'src/sql-wasm.wasm'));
  fs.cpSync('src/renderer', path.join(STAGE, 'src/renderer'), { recursive: true });
  const pkg = require('./package.json');
  fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify({ name: pkg.name, productName: pkg.productName, version: pkg.version, description: pkg.description, author: pkg.author, main: 'src/main.js' }, null, 2));
  if (process.argv.includes('--stage-only')) return console.log('staged', STAGE);
  const paths = await packager({
    dir: STAGE, out: path.join(__dirname, 'dist'), overwrite: true, platform: 'darwin', arch: ['arm64', 'x64'],
    name: 'Letterhead', executableName: 'Letterhead', appBundleId: 'com.shabdwarar.letterhead', appVersion: pkg.version,
    appCategoryType: 'public.app-category.productivity', icon: path.join(__dirname, 'build/icon.icns'), asar: true, prune: false,
    electronVersion: require('electron/package.json').version,
    extendInfo: { NSHumanReadableCopyright: 'Made for Shabd Warar', LSMinimumSystemVersion: '11.0' },
  });
  const KEEP = new Set(['en.lproj', 'en_GB.lproj', 'Base.lproj']);
  for (const p of paths) {
    const app = path.join(p, 'Letterhead.app', 'Contents');
    for (const dir of [path.join(app, 'Resources'), path.join(app, 'Frameworks/Electron Framework.framework/Versions/A/Resources')]) {
      for (const f of fs.readdirSync(dir)) if (f.endsWith('.lproj') && !KEEP.has(f)) fs.rmSync(path.join(dir, f), { recursive: true });
    }
    // Info.plist must not advertise locales we removed
  }
  console.log(paths);
})().catch(e => { console.error(e); process.exit(1); });
