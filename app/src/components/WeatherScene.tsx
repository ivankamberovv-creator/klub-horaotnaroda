// Малка жива картинка на времето: слънце, облаци, дъжд, мъгла, сняг или ясна нощ.
// Рисува се само с кутийки и кръгчета, без снимки. Ако човекът е изключил анимациите в телефона си
// (или е подадено still), картинката стои неподвижна.
import { useEffect, useMemo, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleProp, View, ViewStyle } from 'react-native';
import { colors } from '../theme';
import { skyColor, WeatherKind } from '../weather';

/** Стойност, която върви от 0 до 1 отново и отново */
function useLoop(duration: number, still: boolean) {
  const value = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    if (still) return;
    let loop: Animated.CompositeAnimation | null = null, cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      value.setValue(0);
      loop = Animated.loop(Animated.timing(value, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: false }));
      loop.start();
    });
    return () => { cancelled = true; loop?.stop(); };
  }, [value, duration, still]);
  return value;
}

/** (t + offset), превъртяно в рамките на 0..1 и разтегнато между from и to: така всяка капка пада по свое време */
function wrapped(t: Animated.Value, offset: number, from: number, to: number) {
  if (offset <= 0.001 || offset >= 0.999) return t.interpolate({ inputRange: [0, 1], outputRange: [from, to] });
  const at = from + (to - from) * offset, cut = 1 - offset;
  return t.interpolate({ inputRange: [0, cut, cut + 0.0001, 1], outputRange: [at, to, from, at] });
}
/** Люлеене напред-назад между a и b за едно завъртане на t */
const swing = (t: Animated.Value, a: number, b: number) => t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [a, b, a] });

function Cloud({ w, color, style }: { w: number; color: string; style?: StyleProp<ViewStyle> }) {
  return (
    <Animated.View style={[{ position: 'absolute', width: w, height: w * 0.6 }, style]}>
      <View style={{ position: 'absolute', left: 0, bottom: 0, width: w, height: w * 0.3, borderRadius: w * 0.15, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: w * 0.14, bottom: w * 0.12, width: w * 0.36, height: w * 0.36, borderRadius: w * 0.18, backgroundColor: color }} />
      <View style={{ position: 'absolute', left: w * 0.4, bottom: w * 0.1, width: w * 0.46, height: w * 0.46, borderRadius: w * 0.23, backgroundColor: color }} />
    </Animated.View>
  );
}

function Sun({ size, turn, style }: { size: number; turn: Animated.Value; style?: StyleProp<ViewStyle> }) {
  const ray = { w: size * 0.07, h: size * 0.17 };
  return (
    <Animated.View style={[{ position: 'absolute', width: size, height: size, transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }, style]}>
      {Array.from({ length: 8 }, (_, i) => (
        <View key={i} style={{
          position: 'absolute', left: (size - ray.w) / 2, top: (size - ray.h) / 2, width: ray.w, height: ray.h, borderRadius: ray.w / 2,
          backgroundColor: colors.sun, transform: [{ rotate: `${i * 45}deg` }, { translateY: -size * 0.4 }],
        }} />
      ))}
      <View style={{ position: 'absolute', left: size * 0.24, top: size * 0.24, width: size * 0.52, height: size * 0.52, borderRadius: size * 0.26, backgroundColor: colors.sun }} />
    </Animated.View>
  );
}

type Props = { kind: WeatherKind; isDay?: boolean; width: number; height: number; still?: boolean; style?: StyleProp<ViewStyle> };

export function WeatherScene({ kind, isDay = true, width: W, height: H, still = false, style }: Props) {
  const slow = useLoop(kind === 'sun' ? 26000 : 9000, still);
  const fast = useLoop(kind === 'snow' ? 3600 : 1000, still || (kind !== 'rain' && kind !== 'snow' && kind !== 'moon'));
  const sky = skyColor(kind, isDay);
  // къде пада всяка капка или снежинка: подредени равномерно, с различно начало, за да не вървят в редица
  const drops = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ x: W * 0.2 + (i * W * 0.62) / 8, offset: ((i * 37) % 9) / 9 + 0.03 })), [W]);
  const night = !isDay && kind !== 'moon';

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[{ width: W, height: H, overflow: 'hidden', backgroundColor: sky }, style]}>
      {/* нощем зад облаците има малка луна, за да личи, че е нощ */}
      {night ? <View style={{ position: 'absolute', right: W * 0.08, top: H * 0.1, width: H * 0.26, height: H * 0.26, borderRadius: H * 0.13, backgroundColor: colors.cloud, opacity: 0.85 }} /> : null}

      {kind === 'sun' ? <Sun size={Math.min(H * 0.92, W * 0.62)} turn={slow} style={{ right: W * 0.14, top: H * 0.04 }} /> : null}

      {kind === 'moon' ? (
        <>
          <View style={{ position: 'absolute', right: W * 0.26, top: H * 0.2, width: H * 0.56, height: H * 0.56, borderRadius: H * 0.28, backgroundColor: colors.cloud }} />
          <View style={{ position: 'absolute', right: W * 0.26 - H * 0.14, top: H * 0.12, width: H * 0.5, height: H * 0.5, borderRadius: H * 0.25, backgroundColor: sky }} />
          {[[0.16, 0.22, 0], [0.34, 0.62, 0.4], [0.78, 0.7, 0.7]].map(([x, y, shift], i) => (
            <Animated.View key={i} style={{ position: 'absolute', left: W * x, top: H * y, width: 5, height: 5, borderRadius: 3, backgroundColor: colors.sun, opacity: wrapped(fast, shift, 0.25, 1) }} />
          ))}
        </>
      ) : null}

      {kind === 'clouds' ? (
        <>
          <Cloud w={W * 0.46} color={colors.cloudDark} style={{ right: W * 0.02, top: H * 0.08, transform: [{ translateX: swing(slow, 6, -8) }] }} />
          <Cloud w={W * 0.62} color={colors.cloud} style={{ right: W * 0.2, top: H * 0.3, transform: [{ translateX: swing(slow, -8, 10) }] }} />
        </>
      ) : null}

      {kind === 'rain' ? (
        <>
          {drops.map((d, i) => (
            <Animated.View key={i} style={{ position: 'absolute', left: d.x, top: 0, width: 3, height: 10, borderRadius: 2, backgroundColor: colors.drop,
              transform: [{ translateY: wrapped(fast, d.offset, H * 0.34, H + 12) }, { rotate: '12deg' }] }} />
          ))}
          <Cloud w={W * 0.58} color={colors.cloudDark} style={{ right: W * 0.2, top: -H * 0.12, transform: [{ translateX: swing(slow, -4, 4) }] }} />
        </>
      ) : null}

      {kind === 'snow' ? (
        <>
          {drops.map((d, i) => (
            <Animated.View key={i} style={{ position: 'absolute', left: d.x, top: 0, width: 6, height: 6, borderRadius: 3, backgroundColor: colors.white,
              transform: [{ translateY: wrapped(fast, d.offset, H * 0.34, H + 8) }, { translateX: swing(slow, i % 2 ? -5 : 5, i % 2 ? 5 : -5) }] }} />
          ))}
          <Cloud w={W * 0.58} color={colors.cloud} style={{ right: W * 0.2, top: -H * 0.12, transform: [{ translateX: swing(slow, 4, -4) }] }} />
        </>
      ) : null}

      {kind === 'fog' ? [[0.18, 0.5, 0.9], [0.36, 0.72, 0.7], [0.54, 0.6, 0.85], [0.72, 0.44, 0.6]].map(([y, w, opacity], i) => (
        <Animated.View key={i} style={{ position: 'absolute', right: W * (i % 2 ? 0.2 : 0.08), top: H * y, width: W * w, height: Math.max(6, H * 0.09), borderRadius: H * 0.05,
          backgroundColor: colors.cloud, opacity, transform: [{ translateX: swing(slow, i % 2 ? -12 : 10, i % 2 ? 10 : -12) }] }} />
      )) : null}
    </View>
  );
}
