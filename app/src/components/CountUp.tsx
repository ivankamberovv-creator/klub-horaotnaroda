// Число, което „брои“ до новата си стойност, когато се промени (например точките след покупка).
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleProp, Text, TextStyle } from 'react-native';

export function CountUp({ value, style, testID }: { value: number; style?: StyleProp<TextStyle>; testID?: string }) {
  const [shown, setShown] = useState(value);
  const current = useRef(value);

  useEffect(() => {
    if (current.current === value) return;
    const from = current.current, started = Date.now(), duration = 700;
    let frame = 0, stopped = false;
    const finish = () => { current.current = value; setShown(value); };
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (stopped) return;
      if (reduced) return finish();
      const step = () => {
        const k = Math.min(1, (Date.now() - started) / duration);
        const next = Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))); // бързо в началото, плавно накрая
        current.current = next;
        setShown(next);
        if (k < 1) frame = requestAnimationFrame(step);
      };
      frame = requestAnimationFrame(step);
    });
    return () => { stopped = true; cancelAnimationFrame(frame); current.current = value; };
  }, [value]);

  // за екранните четци се казва крайната стойност, не междинните
  return <Text testID={testID} accessibilityLabel={String(value)} style={style}>{shown}</Text>;
}
