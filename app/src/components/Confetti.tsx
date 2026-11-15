// Конфети: кратък празничен дъжд от цветни парченца. Пуска се, когато `run` се смени.
// Ако човекът е изключил анимациите в настройките на телефона си, не се показва.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';

const COLORS = [colors.red, colors.greenFlag, '#e9b949', colors.greenDeep, '#f08a7c'];
type Piece = { left: number; size: number; color: string; delay: number; drift: number; turn: number; round: boolean };

export function Confetti({ run }: { run: number }) {
  const { width, height } = useWindowDimensions();
  const [pieces, setPieces] = useState<Piece[]>([]);
  const fall = useRef(new Animated.Value(0)).current;
  const first = useRef(true);

  useEffect(() => {
    // при първото показване не празнуваме: само когато нещо наистина се е случило
    if (first.current) { first.current = false; return; }
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      const w = Math.min(width, 520);
      setPieces(Array.from({ length: 36 }, (_, i) => ({
        left: Math.random() * (w - 12), size: 6 + Math.random() * 7, color: COLORS[i % COLORS.length],
        delay: Math.random() * 0.25, drift: (Math.random() - 0.5) * 90, turn: (Math.random() - 0.5) * 900, round: i % 4 === 0,
      })));
      fall.setValue(0);
      Animated.timing(fall, { toValue: 1, duration: 1700, easing: Easing.out(Easing.quad), useNativeDriver: false }).start(() => { if (!cancelled) setPieces([]); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  if (pieces.length === 0) return null;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]} testID="confetti">
      {pieces.map((p, i) => {
        const t = fall.interpolate({ inputRange: [p.delay, 1], outputRange: [0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View key={i} style={{
            position: 'absolute', top: -20, left: p.left, width: p.size, height: p.round ? p.size : p.size * 0.5,
            borderRadius: p.round ? p.size / 2 : 1, backgroundColor: p.color,
            opacity: t.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 1, 0] }),
            transform: [
              { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.75] }) },
              { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, p.drift] }) },
              { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.turn}deg`] }) },
            ],
          }} />
        );
      })}
    </View>
  );
}
