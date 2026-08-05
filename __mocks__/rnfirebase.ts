// Jest substitutes for the actual Firebase native modules so the app can be
// unit-tested without a device/emulator. Values mirror the remote-config defaults.
const asString = () => '';
const asNumber = () => 0;
const asBoolean = () => false;

export const getRemoteConfig = () => ({
  defaultConfig: {},
});
export const fetchAndActivate = () => Promise.resolve(false);
export const getValue = () => ({
  asString,
  asNumber,
  asBoolean,
  getSource: () => 'static',
});
