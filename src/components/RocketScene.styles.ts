import { StyleSheet } from 'react-native';

/** Base exhaust length; shared with the component so the tapers nest exactly. */
export const PLUME_HEIGHT = 38;

/**
 * Styles for the flight scene. Kept beside the component so the screen file only owns
 * chrome (header, telemetry, action button, About sheet).
 */
export const styles = StyleSheet.create({
  space: {
    flex: 1,
    minHeight: 300,
    marginTop: 16,
    borderRadius: 30,
    overflow: 'hidden',
    backgroundColor: '#091B35',
    borderWidth: 1,
    borderColor: '#15365D',
  },

  starField: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },

  starStrip: { position: 'absolute', top: 0, bottom: 0, left: 0, flexDirection: 'row' },

  starCopy: { height: '100%' },

  star: { position: 'absolute', borderRadius: 4, backgroundColor: '#D6F3FF' },

  fireBurn: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'flex-end',
    shadowColor: '#FF5A24',
    shadowOpacity: 0.9,
    shadowRadius: 14,
    elevation: 9,
  },

  fireBottom: { top: 68, left: -7, zIndex: -1 },

  fireTopRight: { top: 7, left: 46, zIndex: -1 },

  fireMiddleLeft: { top: 43, left: -24, zIndex: -1 },

  fireOuter: {
    position: 'absolute',
    bottom: 0,
    width: '100%',
    height: '86%',
    backgroundColor: '#F04425',
    transform: [{ rotate: '45deg' }],
  },

  fireInner: {
    position: 'absolute',
    bottom: 1,
    backgroundColor: '#FF9F1C',
    transform: [{ rotate: '45deg' }],
  },

  fireCore: {
    position: 'absolute',
    bottom: 2,
    backgroundColor: '#FFE69A',
    transform: [{ rotate: '45deg' }],
  },

  connectionOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    zIndex: 6,
    padding: 13,
    borderRadius: 16,
    backgroundColor: 'rgba(5, 19, 39, 0.82)',
    borderWidth: 1,
    borderColor: '#1B5276',
  },

  connectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  connectionIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#71849B',
  },

  connectionIndicatorActive: { backgroundColor: '#FFC857' },

  connectionIndicatorLive: { backgroundColor: '#55E39B' },

  connectionStatus: {
    color: '#DCEAFF',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.5,
  },

  connectionDetails: {
    flexDirection: 'row',
    gap: 28,
    marginTop: 10,
  },

  connectionDetail: { flexShrink: 1 },

  connectionLabel: {
    color: '#6D98BC',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.1,
  },

  connectionValue: { color: '#F2F8FF', fontSize: 13, fontWeight: '700', marginTop: 3 },

  connectionMessage: { color: '#88A5C1', fontSize: 11, marginTop: 7 },

  rocketWrap: {
    position: 'absolute',
    zIndex: 4,
    // Align visible rocket base with earth top; wrapper has 33 px unused space below flame.
    bottom: 109,
    alignSelf: 'center',
    width: 58,
    height: 112,
    alignItems: 'center',
  },

  rocketNose: {
    width: 36,
    height: 29,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: '#F4F7FB',
  },

  rocketBody: {
    width: 36,
    height: 50,
    alignItems: 'center',
    backgroundColor: '#E5ECF5',
    borderBottomLeftRadius: 9,
    borderBottomRightRadius: 9,
  },

  rocketWindow: {
    width: 17,
    height: 17,
    marginTop: 3,
    borderRadius: 9,
    backgroundColor: '#38C8F4',
    borderWidth: 3,
    borderColor: '#1C5273',
  },

  rocketFins: { position: 'absolute', top: 57, width: 58, flexDirection: 'row', justifyContent: 'space-between' },

  fin: { width: 14, height: 29, backgroundColor: '#FF5B58' },

  finLeft: { borderTopLeftRadius: 12, transform: [{ skewY: '-18deg' }] },

  finRight: { borderTopRightRadius: 12, transform: [{ skewY: '18deg' }] },

  // Anchored at the nozzle throat (nose 29 + body 50 = 77), allowed to
  // overflow the wrapper so the plume can run behind the planet rim.
  // Anchored at the nozzle: without a top transform origin the plume scales and
  // rotates about its middle, so the flame appears to twitch into its own centre
  // and detach from the hull instead of extending out from the throat.
  plume: {
    position: 'absolute',
    top: 77,
    alignSelf: 'center',
    width: 16,
    height: PLUME_HEIGHT,
    alignItems: 'center',
    transformOrigin: '50% 0%',
  },

  plumeTongue: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    alignItems: 'center',
  },

  // Borders-only box that collapses into the tapering triangle under each dome.
  plumeTaper: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },

  baseGlow: {
    position: 'absolute',
    bottom: 76,
    alignSelf: 'center',
    width: 180,
    height: 50,
    borderRadius: 90,
    backgroundColor: 'rgba(44, 188, 255, 0.12)',
  },

  earth: {
    position: 'absolute',
    bottom: -78,
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    overflow: 'hidden',
    backgroundColor: '#168FD1',
    borderWidth: 5,
    borderColor: '#47D8F5',
  },

  earthShade: {
    position: 'absolute',
    bottom: -72,
    alignSelf: 'center',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderRightWidth: 42,
    borderRightColor: 'rgba(1, 30, 72, 0.38)',
  },

  land: { position: 'absolute', backgroundColor: '#62D397', borderRadius: 28 },

  landOne: { width: 82, height: 47, left: 20, top: 28, transform: [{ rotate: '17deg' }] },

  landTwo: { width: 63, height: 89, right: 18, top: 75, transform: [{ rotate: '-23deg' }] },

  landThree: { width: 48, height: 35, left: 32, bottom: 24 },
});
