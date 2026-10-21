import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { VpnStateKind, VpnUiState } from '../hooks/useVpn';
import { PLUME_HEIGHT, styles } from './RocketScene.styles';

function statusLabel(state: VpnUiState): string {
  switch (state.kind) {
    case VpnStateKind.Connected:
      return 'Orbit secured';
    case VpnStateKind.Connecting:
      return 'Launching secure tunnel';
    case VpnStateKind.Disconnecting:
      return 'Returning to base';
    case VpnStateKind.PermissionRequired:
      return 'Launch clearance required';
    case VpnStateKind.Error:
      return 'Launch failed';
    default:
      return 'Ready at base';
  }
}

function FireBurn({ size, style }: { size: number; style?: object }) {
  const flicker = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, { toValue: 1, duration: 260, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0, duration: 190, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(flicker, { toValue: 0.7, duration: 150, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [flicker]);

  const scale = flicker.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] });
  const lean = flicker.interpolate({ inputRange: [0, 1], outputRange: ['-4deg', '5deg'] });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLabel="Animated fire"
      style={[styles.fireBurn, { width: size, height: size * 1.18 }, style, { transform: [{ scale }, { rotate: lean }] }]}
    >
      <View style={[styles.fireOuter, { borderRadius: size * 0.45 }]} />
      <View style={[styles.fireInner, { width: size * 0.46, height: size * 0.68, borderRadius: size * 0.3 }]} />
      <View style={[styles.fireCore, { width: size * 0.2, height: size * 0.4, borderRadius: size * 0.16 }]} />
    </Animated.View>
  );
}

/**
 * Combustion flicker.
 *
 * Every cycle draws a fresh target and a fresh duration, so the exhaust never
 * settles into a metronome the eye can lock onto. Running two of these at
 * different speeds (length vs. girth) is what stops the plume reading as one
 * rubbery blob being squashed.
 */
function useCombustion({
  min,
  max,
  minMs,
  maxMs,
  initial,
}: {
  min: number;
  max: number;
  minMs: number;
  maxMs: number;
  initial: number;
}) {
  const value = useRef(new Animated.Value(initial)).current;

  useEffect(() => {
    let cancelled = false;

    const step = () => {
      if (cancelled) {
        return;
      }
      Animated.timing(value, {
        toValue: min + Math.random() * (max - min),
        duration: minMs + Math.random() * (maxMs - minMs),
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          step();
        }
      });
    };

    step();

    return () => {
      cancelled = true;
      value.stopAnimation();
    };
  }, [value, min, max, minMs, maxMs]);

  return value;
}

// Coolest/widest envelope outside, hottest/shortest inside. Height is a
// fraction of PLUME_HEIGHT so the tongues nest instead of interleaving.
const PLUME_LAYERS = [
  { color: '#F04A21', width: 16, height: 1 },
  { color: '#FF8C1E', width: 11.5, height: 0.74 },
  { color: '#FFC23C', width: 7.5, height: 0.46 },
  { color: '#FFF7DE', width: 4, height: 0.22 },
] as const;

/**
 * One flame tongue: a domed shoulder that tapers to a point.
 *
 * Two plain views stand in for a path here — a circle forming the shoulder and
 * a bordered box collapsed into a triangle beneath it. Stacking constant-width
 * rounded rectangles instead leaves the plume reading as a pill, because a real
 * exhaust column narrows as it cools.
 */
function PlumeTongue({ color, width, height }: { color: string; width: number; height: number }) {
  const total = PLUME_HEIGHT * height;

  // Domed shoulder whose equator is the widest point, then a taper to the tip.
  // Joining at the equator (not partway down a straight side) is what avoids
  // the notch a capsule-into-triangle join leaves in the silhouette.
  return (
    <View style={[styles.plumeTongue, { width, height: total }]}>
      <View style={{ width, height: width, borderRadius: width / 2, backgroundColor: color }} />
      <View
        style={[
          styles.plumeTaper,
          {
            marginTop: -width / 2,
            borderLeftWidth: width / 2,
            borderRightWidth: width / 2,
            borderTopWidth: total - width / 2,
            borderTopColor: color,
          },
        ]}
      />
    </View>
  );
}

/**
 * Rocket exhaust.
 *
 * Real plumes are not one flat shape: they are a hot, short, near-white core
 * wrapped in progressively cooler, longer envelopes, and the whole column
 * churns. This stacks four nested tongues:
 *
 *   outer (deep orange) -> mid (orange) -> inner (amber) -> core (white)
 *
 * Length flickers fast, girth pulses slower, and the column leans on a slow
 * drift, so the silhouette keeps changing instead of breathing. Thrust is a
 * separate animated value, so launch -> cruise eases down instead of snapping
 * between two hardcoded heights.
 */
function ExhaustPlume({ mode }: { mode: 'launch' | 'cruise' }) {
  const length = useCombustion({ min: 0.58, max: 1.15, minMs: 55, maxMs: 135, initial: 0.9 });
  const girth = useCombustion({ min: 0.88, max: 1.1, minMs: 110, maxMs: 240, initial: 1 });
  const sway = useCombustion({ min: -1, max: 1, minMs: 260, maxMs: 520, initial: 0 });

  // Full column while lifting off; settles to a tight cruise plume once level.
  const thrust = useRef(new Animated.Value(mode === 'cruise' ? 0.55 : 1)).current;
  const ignition = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(thrust, {
      toValue: mode === 'cruise' ? 0.55 : 1,
      duration: mode === 'cruise' ? 950 : 420,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [mode, thrust]);

  // Light up rather than pop into existence.
  useEffect(() => {
    Animated.timing(ignition, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [ignition]);

  const stretch = Animated.multiply(
    length.interpolate({ inputRange: [0.58, 1.15], outputRange: [0.7, 1.1] }),
    thrust,
  );
  const flare = girth.interpolate({ inputRange: [0.88, 1.1], outputRange: [0.92, 1.08] });
  const lean = sway.interpolate({ inputRange: [-1, 1], outputRange: ['-2.6deg', '2.6deg'] });
  const drift = sway.interpolate({ inputRange: [-1, 1], outputRange: [-1.4, 1.4] });
  const heat = length.interpolate({ inputRange: [0.58, 1.15], outputRange: [0.82, 1] });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLabel="Rocket exhaust"
      style={[
        styles.plume,
        {
          transform: [{ translateX: drift }, { rotate: lean }, { scaleX: flare }, { scaleY: stretch }],
          opacity: Animated.multiply(heat, ignition),
        },
      ]}>
      {PLUME_LAYERS.map((layer) => (
        <PlumeTongue key={layer.color} {...layer} />
      ))}
    </Animated.View>
  );
}

const STARS_FAR = [
  [5, 52, 1.5], [12, 18, 2], [18, 68, 1.5], [27, 39, 1.5], [35, 8, 1.5],
  [45, 14, 1.5], [55, 85, 1.5], [62, 31, 2], [72, 66, 1.5], [78, 12, 1.5],
  [89, 42, 2], [92, 78, 1.5],
] as const;

const STARS_NEAR = [
  [10, 80, 2.5], [20, 26, 3], [40, 55, 2.5], [60, 90, 2], [70, 20, 2.5], [85, 60, 3],
] as const;

const FLIGHT_RISE = 96;
const FLIGHT_STEPS = 40;

// Derives from styles.rocketWrap: bottom 109 + height 112 -> the wrapper's centre
// sits 165pt above the scene's content box. Keep these in sync if that changes.
const ROCKET_WRAP_CENTRE_FROM_BOTTOM = 165;
const ROCKET_GROUND_LIFT = 24;

/**
 * Gravity-turn trajectory.
 *
 * The heading sweeps 0deg (straight up) to 90deg (level) and the position is
 * integrated from that heading, so the nose always points along the path it is
 * actually travelling. The old behaviour — climb straight up, then pivot in
 * place once connected — reads as a turntable, not as flight.
 *
 * The u^2.2 turn profile holds the ship near-vertical off the pad and then
 * pitches over hard, which is the shape a hyperbolic escape arc shows as it
 * closes on its asymptote.
 */
const FLIGHT_PATH = (() => {
  const turn = (u: number) => (Math.PI / 2) * u ** 2.2;
  const pts = [{ u: 0, y: 0, deg: '0.00deg' }];
  let y = 0;

  for (let i = 1; i <= FLIGHT_STEPS; i += 1) {
    const u = i / FLIGHT_STEPS;
    y += Math.cos(turn(u)) / FLIGHT_STEPS;
    pts.push({ u, y, deg: `${((turn(u) * 180) / Math.PI).toFixed(2)}deg` });
  }

  const scale = FLIGHT_RISE / y;
  return {
    input: pts.map((p) => p.u),
    y: pts.map((p) => -p.y * scale),
    rotate: pts.map((p) => p.deg),
  };
})();

// The hull's visual centre sits above the wrapper's centre (the wrapper carries
// unused space below the nozzle), so rotating it flat swings that offset out
// sideways. Nudging the wrapper back by the same amount parks the hull itself —
// not the wrapper — on the scene's centreline.
const ROCKET_HULL_OFFSET = 16.5;

// Side-travel of the ascent. 0 parks the ship dead centre. Raise it and the
// ship sweeps out to the right like a real gravity turn, but the parked pose
// then sits off-centre by the same amount — the two cannot both hold, because a
// 90deg heading only exists once horizontal motion dominates.
const LATERAL_ARC = 0;

/**
 * One scrolling band of stars.
 *
 * Two identical copies sit side by side and the pair slides by exactly one
 * width, so the loop restarts on a frame that looks identical to the first —
 * no seam, no jump. Two bands at different speeds give the parallax that sells
 * forward motion rather than a panning wallpaper.
 */
function StarStrip({
  stars,
  width,
  translateX,
  opacity,
}: {
  stars: readonly (readonly [number, number, number])[];
  width: number;
  translateX: Animated.AnimatedInterpolation<number>;
  opacity: number;
}) {
  if (width <= 0) {
    return null;
  }

  return (
    <Animated.View style={[styles.starStrip, { width: width * 2, transform: [{ translateX }] }]}>
      {[0, 1].map((copy) => (
        // Height must be explicit: percentage tops resolve against a zero-height
        // box otherwise, which piles every star onto the top edge.
        <View key={copy} style={[styles.starCopy, { width }]}>
          {stars.map(([left, top, size], i) => (
            <View
              key={i}
              style={[
                styles.star,
                { left: `${left}%`, top: `${top}%`, width: size, height: size, opacity },
              ]}
            />
          ))}
        </View>
      ))}
    </Animated.View>
  );
}

function RocketScene({ state }: { state: VpnUiState }) {
  // motion: 0 = grounded & zoomed-in, 1 = in space & zoomed-out.
  const motion = useRef(new Animated.Value(0)).current;
  const earthSpin = useRef(new Animated.Value(0)).current;
  const starFarDrift = useRef(new Animated.Value(0)).current;
  const starNearDrift = useRef(new Animated.Value(0)).current;
  const [sceneWidth, setSceneWidth] = useState(0);
  const [sceneHeight, setSceneHeight] = useState(0);

  const launching = state.kind === VpnStateKind.Connecting;
  const flying = state.kind === VpnStateKind.Connected;
  const blasting = launching || flying || state.kind === VpnStateKind.Disconnecting;
  const grounded = !launching && !flying && state.kind !== VpnStateKind.Disconnecting;

  // Advance the rocket between grounded/zoomed-in and flying/zoomed-out.
  useEffect(() => {
    // toValue 1 = flying/zoomed-out (Connecting climbs, Connected stays up).
    // Disconnecting, idle, error, permission all return to base.
    const goUp =
      state.kind === VpnStateKind.Connecting || state.kind === VpnStateKind.Connected;
    Animated.timing(motion, {
      toValue: goUp ? 1 : 0,
      duration:
        state.kind === VpnStateKind.Connecting
          ? 2100
          : state.kind === VpnStateKind.Disconnecting
          ? 1700
          : 1500,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [motion, state.kind]);

  // Stars stream right-to-left only once the ship is off the pad, and snap back
  // to a still sky when it lands.
  useEffect(() => {
    if (!blasting) {
      starFarDrift.stopAnimation();
      starNearDrift.stopAnimation();
      starFarDrift.setValue(0);
      starNearDrift.setValue(0);
      return;
    }

    const loopFor = (value: Animated.Value, duration: number) =>
      Animated.loop(
        Animated.timing(value, {
          toValue: 1,
          duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      );

    const far = loopFor(starFarDrift, 30000);
    const near = loopFor(starNearDrift, 11000);
    far.start();
    near.start();

    return () => {
      far.stop();
      near.stop();
    };
  }, [blasting, starFarDrift, starNearDrift]);

  // Earth spins only during connected flight. Keep base orientation stable while idle.
  useEffect(() => {
    if (!flying) {
      earthSpin.stopAnimation();
      earthSpin.setValue(0);
      return;
    }
    const earthLoop = Animated.loop(
      Animated.timing(earthSpin, {
        toValue: 1,
        duration: 7000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    earthLoop.start();
    return () => earthLoop.stop();
  }, [earthSpin, flying]);

  // Camera + ramp: base is a close-up; launch pulls back to normal scene size.
  const zoom = motion.interpolate({ inputRange: [0, 1], outputRange: [1.38, 1] });
  // The park height is derived, not hand-tuned: the climb is sized so the
  // parked rocket lands on the scene's vertical centre whatever the panel
  // height is. Scaling the whole arc (x and y together) keeps every tangent —
  // and therefore the heading — exactly as designed; only its size changes.
  //   wrapCentre = 165 + 24 + FLIGHT_RISE * k  must equal sceneHeight / 2
  const flightScale =
    sceneHeight > 0
      ? Math.min(
          1.6,
          Math.max(
            0.05,
            (sceneHeight / 2 - (ROCKET_WRAP_CENTRE_FROM_BOTTOM + ROCKET_GROUND_LIFT)) / FLIGHT_RISE,
          ),
        )
      : 1;

  // Rests on Earth's upper rim at base (-24), then climbs while pitching over.
  const rocketX = motion.interpolate({
    inputRange: [0, 1],
    outputRange: [0, LATERAL_ARC - ROCKET_HULL_OFFSET],
  });
  const rocketY = motion.interpolate({
    inputRange: FLIGHT_PATH.input,
    outputRange: FLIGHT_PATH.y.map((y) => y * flightScale - ROCKET_GROUND_LIFT),
  });
  const rocketRotate = motion.interpolate({
    inputRange: FLIGHT_PATH.input,
    outputRange: FLIGHT_PATH.rotate,
  });
  const starFarX = starFarDrift.interpolate({ inputRange: [0, 1], outputRange: [0, -sceneWidth] });
  const starNearX = starNearDrift.interpolate({ inputRange: [0, 1], outputRange: [0, -sceneWidth] });
  const earthRotation = earthSpin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-360deg'],
  });

  const connectionStatus =
    state.kind === VpnStateKind.Connected
      ? 'CONNECTED'
      : state.kind === VpnStateKind.Connecting
      ? 'CONNECTING'
      : state.kind === VpnStateKind.Disconnecting
      ? 'DISCONNECTING'
      : 'READY';

  return (
    <View
      style={styles.space}
      accessibilityLabel={statusLabel(state)}
      onLayout={(e) => {
        setSceneWidth(e.nativeEvent.layout.width);
        setSceneHeight(e.nativeEvent.layout.height);
      }}>
      <View style={styles.starField} pointerEvents="none">
        <StarStrip stars={STARS_FAR} width={sceneWidth} translateX={starFarX} opacity={0.45} />
        <StarStrip stars={STARS_NEAR} width={sceneWidth} translateX={starNearX} opacity={0.85} />
      </View>

      <View style={styles.connectionOverlay} pointerEvents="none">
        <View style={styles.connectionHeader}>
          <View
            style={[
              styles.connectionIndicator,
              state.kind === VpnStateKind.Connected && styles.connectionIndicatorLive,
              state.kind === VpnStateKind.Connecting && styles.connectionIndicatorActive,
            ]}
          />
          <Text style={styles.connectionStatus}>{connectionStatus}</Text>
        </View>
        {state.kind === VpnStateKind.Connected ? (
          <View style={styles.connectionDetails}>
            <View style={styles.connectionDetail}>
              <Text style={styles.connectionLabel}>SERVER LOCATION</Text>
              <Text style={styles.connectionValue} numberOfLines={1}>
                {/* Falls back to the endpoint: real data beats a made-up city. */}
                {state.session?.serverLocation || state.session?.serverEndpoint || '—'}
              </Text>
            </View>
            <View style={styles.connectionDetail}>
              <Text style={styles.connectionLabel}>DEVICE IP</Text>
              <Text style={styles.connectionValue} numberOfLines={1}>
                {/* Registry hands back 10.0.0.x/32; the /32 is noise in a label. */}
                {state.session?.address.replace(/\/\d+$/, '') || '—'}
              </Text>
            </View>
          </View>
        ) : (
          <Text style={styles.connectionMessage}>
            {state.kind === VpnStateKind.Connecting
              ? 'Establishing secure route...'
              : state.kind === VpnStateKind.Disconnecting
              ? 'Closing secure route...'
              : 'Secure route offline'}
          </Text>
        )}
      </View>

      <Animated.View
        style={[
          styles.rocketWrap,
          {
            transform: [
              { scale: zoom },
              { translateX: rocketX },
              { translateY: rocketY },
              { rotate: rocketRotate },
            ],
          },
        ]}>
        {state.kind === VpnStateKind.Error ? (
          <>
            <FireBurn size={70} style={styles.fireBottom} />
            <FireBurn size={27} style={styles.fireTopRight} />
            <FireBurn size={31} style={styles.fireMiddleLeft} />
          </>
        ) : null}
        <View style={styles.rocketNose} />
        <View style={styles.rocketBody}>
          <View style={styles.rocketWindow} />
        </View>
        <View style={styles.rocketFins}>
          <View style={[styles.fin, styles.finLeft]} />
          <View style={[styles.fin, styles.finRight]} />
        </View>
        {blasting && !grounded ? (
          <ExhaustPlume mode={flying ? 'cruise' : 'launch'} />
        ) : null}
      </Animated.View>

      <View style={styles.baseGlow} />
      <Animated.View
        style={[
          styles.earth,
          { transform: [{ scale: zoom }, { rotate: earthRotation }] },
        ]}>
        <View style={[styles.land, styles.landOne]} />
        <View style={[styles.land, styles.landTwo]} />
        <View style={[styles.land, styles.landThree]} />
      </Animated.View>
      <Animated.View
        style={[
          styles.earthShade,
          { transform: [{ scale: zoom }] },
        ]}
      />
    </View>
  );
}

export { RocketScene };
