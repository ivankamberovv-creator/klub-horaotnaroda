// Иконките на приложението: прости линии, рисувани тук, без външен пакет с икони.
import Svg, { Circle, Path } from 'react-native-svg';

export type IconName = 'home' | 'tag' | 'card' | 'gift' | 'more' | 'chevron' | 'back' | 'receipt' | 'history' | 'pin' | 'bell'
  | 'user' | 'phone' | 'route' | 'info' | 'check' | 'star' | 'install';

const PATHS: Record<Exclude<IconName, 'more'>, string[]> = {
  home: ['M3 11l9-8 9 8', 'M5 10v10h14V10'],
  tag: ['M3 12V4h8l10 10-8 8z', 'M7.5 8.5h.01'],
  card: ['M3 5h18v14H3z', 'M7 9v6', 'M10 9v6', 'M13.5 9v6', 'M17 9v6'],
  gift: ['M3 9h18v12H3z', 'M2 5h20v4H2z', 'M12 5v16', 'M12 5c-2-4-7-3-5 0', 'M12 5c2-4 7-3 5 0'],
  chevron: ['M9 6l6 6-6 6'],
  back: ['M15 6l-6 6 6 6'],
  receipt: ['M6 3h12v18l-3-2-3 2-3-2-3 2z', 'M9 8h6', 'M9 12h6'],
  history: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M12 7v5l3 2'],
  pin: ['M12 21s7-6.2 7-11a7 7 0 10-14 0c0 4.8 7 11 7 11z', 'M12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z'],
  bell: ['M6 16v-5a6 6 0 1112 0v5l2 2H4z', 'M10 20a2 2 0 004 0'],
  user: ['M12 12a4 4 0 100-8 4 4 0 000 8z', 'M4 21c0-4 4-6 8-6s8 2 8 6'],
  phone: ['M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z'],
  route: ['M3 11l18-8-8 18-2-8z'],
  info: ['M12 3a9 9 0 100 18 9 9 0 000-18z', 'M12 11v6', 'M12 7.5v.5'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  star: ['M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z'],
  install: ['M12 4v11', 'M7 11l5 5 5-5', 'M5 20h14'],
};

export function Icon({ name, size = 24, color, filled }: { name: IconName; size?: number; color: string; filled?: boolean }) {
  if (name === 'more') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" accessibilityElementsHidden importantForAccessibility="no">
        <Circle cx={5} cy={12} r={1.8} fill={color} /><Circle cx={12} cy={12} r={1.8} fill={color} /><Circle cx={19} cy={12} r={1.8} fill={color} />
      </Svg>
    );
  }
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? color : 'none'} stroke={color} strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" accessibilityElementsHidden importantForAccessibility="no">
      {PATHS[name].map((d, i) => <Path key={i} d={d} />)}
    </Svg>
  );
}
