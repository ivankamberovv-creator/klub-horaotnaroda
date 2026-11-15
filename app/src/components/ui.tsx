// Малките градивни части на екраните: текстове, бутони, карти.
import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { colors, fonts, radius } from '../theme';

export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text accessibilityRole="header" style={[s.h1, style]}>{children}</Text>;
}
export function H2({ children }: { children: ReactNode }) {
  return <Text accessibilityRole="header" style={s.h2}>{children}</Text>;
}
export function P({ children, muted, style, testID }: { children: ReactNode; muted?: boolean; style?: StyleProp<TextStyle>; testID?: string }) {
  return <Text testID={testID} style={[s.p, muted && { color: colors.muted }, style]}>{children}</Text>;
}
export function Eyebrow({ children }: { children: ReactNode }) {
  return <Text style={s.eyebrow}>{children}</Text>;
}
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text accessibilityRole="alert" style={s.error}>{children}</Text>;
}

type ButtonProps = {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'light' | 'danger';
  disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>; testID?: string;
};
export function Button({ title, onPress, kind = 'primary', disabled, busy, style, testID }: ButtonProps) {
  const off = disabled || busy;
  const bg = off && kind === 'primary' ? colors.disabledBg
    : kind === 'primary' ? colors.green : kind === 'danger' ? colors.redText : colors.white;
  const fg = off && kind === 'primary' ? colors.muted
    : kind === 'primary' || kind === 'danger' ? colors.white : kind === 'light' ? colors.greenDeep : colors.ink;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ disabled: Boolean(off), busy: Boolean(busy) }}
      disabled={off} onPress={onPress}
      style={({ pressed }) => [s.button, { backgroundColor: bg, opacity: pressed ? 0.85 : 1 },
        kind === 'ghost' && { borderWidth: 1, borderColor: colors.lineStrong }, style]}>
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[s.buttonText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, active, style, testID }: { children: ReactNode; active?: boolean; style?: StyleProp<ViewStyle>; testID?: string }) {
  return <View testID={testID} style={[s.card, active && { borderColor: colors.greenFlag, backgroundColor: colors.paper }, style]}>{children}</View>;
}

/** Ред „етикет … стойност“ в списък с черти */
export function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[s.row, !last && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
      <Text style={[s.p, { color: colors.muted, flexShrink: 1 }]}>{label}</Text>
      <Text style={[s.p, { fontFamily: fonts.bold }]}>{value}</Text>
    </View>
  );
}

export function Loading() {
  return <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={colors.green} size="large" /></View>;
}

/** Трикольорът от сайта: бяло, зелено, червено */
export function Tricolor() {
  return (
    <View style={{ height: 8 }}>
      <View style={{ flex: 1, backgroundColor: colors.white }} />
      <View style={{ flex: 1, backgroundColor: colors.greenFlag }} />
      <View style={{ flex: 1, backgroundColor: colors.red }} />
    </View>
  );
}

export const s = StyleSheet.create({
  h1: { fontFamily: fonts.old, fontSize: 30, lineHeight: 33, color: colors.ink },
  h2: { fontFamily: fonts.old, fontSize: 23, lineHeight: 26, color: colors.ink },
  p: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.ink },
  eyebrow: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.redText },
  error: { fontFamily: fonts.semi, fontSize: 15, lineHeight: 21, color: colors.redText },
  button: { minHeight: 50, paddingHorizontal: 16, borderRadius: radius, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontFamily: fonts.bold, fontSize: 16 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius, padding: 16, gap: 12, backgroundColor: colors.white },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  // долният отстъп пази последния ред от кръглия бутон „Карта“
  screen: { padding: 20, paddingBottom: 44, gap: 18 },
});
