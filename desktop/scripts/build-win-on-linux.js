#!/usr/bin/env node
/*
 * Build the Windows installer on Linux without Wine.
 *
 * electron-builder extracts the NSIS uninstaller from the installer stub. On
 * macOS it uses its built-in reader (nsisUtil.UninstallerReader); on Linux it
 * runs the stub under Wine instead. This helper selects the built-in reader on
 * Linux too. On Windows (and in CI) just use `npm run dist:win`.
 */
const macosVersion = require('app-builder-lib/out/util/macosVersion');
macosVersion.isMacOsCatalina = () => true;

const { build, Platform, Arch } = require('electron-builder');

build({ targets: Platform.WINDOWS.createTarget('nsis', Arch.x64), publish: 'never' })
  .then((files) => { console.log('built:\n  ' + files.join('\n  ')); })
  .catch((e) => { console.error(e); process.exit(1); });
