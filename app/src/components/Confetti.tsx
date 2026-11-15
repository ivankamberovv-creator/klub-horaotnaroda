// Конфети: празничен дъжд от малки знаменца в бяло, зелено и червено. Пуска се, когато `run` се смени.
// Ако човекът е изключил анимациите в настройките на телефона си, не се показва.
import { ElementRef, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';

type Piece = { left: number; size: number; delay: number; drift: number; turn: number };
const COUNT = 128, DURATION = 3400;
const web = Platform.OS === 'web';

/** Едно знаменце: три равни ивици; тънката рамка пази бялата ивица видима и на бял фон */
const flag = (p: Piece) => ({
  position: 'absolute' as const, top: -20, left: p.left, width: p.size, height: Math.round(p.size * 0.62),
  borderWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong, overflow: 'hidden' as const,
});
const stripes = (
  <>
    <View style={{ flex: 1, backgroundColor: colors.white }} />
    <View style={{ flex: 1, backgroundColor: colors.greenFlag }} />
    <View style={{ flex: 1, backgroundColor: colors.red }} />
  </>
);

export function Confetti({ run }: { run: number }) {
  const { width, height } = useWindowDimensions();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const fall = useRef(new Animated.Value(0)).current;
  const box = useRef<ElementRef<typeof View>>(null);
  const first = useRef(true);

  useEffect(() => {
    // при първото показване не празнуваме: само когато нещо наистина се е случило
    if (first.current) { first.current = false; return; }
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      const w = Math.min(width, 520);
      setPieces(Array.from({ length: COUNT }, () => ({
        left: Math.random() * (w - 20), size: 12 + Math.random() * 8,
        delay: Math.random() * 0.4, drift: (Math.random() - 0.5) * 90, turn: (Math.random() - 0.5) * 420,
      })));
      if (web) return; // в браузър движението е по-долу
      fall.setValue(0);
      Animated.timing(fall, { toValue: 1, duration: DURATION, easing: Easing.out(Easing.quad), useNativeDriver: false }).start(() => { if (!cancelled) setPieces([]); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  // В браузър знаменцата ги движи самият браузър (Web Animations), а не кодът на всеки кадър:
  // толкова много парчета иначе насичат на по-слаб телефон. Движението е същото като при Animated по-горе:
  // всяко знаменце тръгва малко по-късно и пада все по-бавно.
  useLayoutEffect(() => {
    if (!web || pieces.length === 0) return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el || typeof el.animate !== 'function') { setPieces([]); return; }
    const moves = Array.from(el.children).map((child, i) => {
      const p = pieces[i], start = 1 - Math.sqrt(1 - p.delay);
      return child.animate([
        { transform: 'translateY(0px) translateX(0px) rotate(0deg)', opacity: 1 },
        { opacity: 1, offset: 0.8 },
        { transform: `translateY(${height * 0.75}px) translateX(${p.drift}px) rotate(${p.turn}deg)`, opacity: 0 },
      ], { delay: start * DURATION, duration: (1 - start) * DURATION, easing: 'cubic-bezier(0.5, 1, 0.89, 1)', fill: 'both' });
    });
    const timer = setTimeout(() => setPieces([]), DURATION + 50);
    return () => { clearTimeout(timer); moves.forEach((m) => m.cancel()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces]);

  if (pieces.length === 0) return null;
  return (
    <View ref={box} pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} testID="confetti">
      {pieces.map((p, i) => {
        if (web) return <View key={i} style={flag(p)}>{stripes}</View>;
        const t = fall.interpolate({ inputRange: [p.delay, 1], outputRange: [0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View key={i} style={[flag(p), {
            opacity: t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.75] }) },
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.turn}deg`] }) },
            ],
          }]}>
            {stripes}
          </Animated.View>
        );
      })}
    </View>
  );
}
