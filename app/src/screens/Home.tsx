// Начало: точките, колко остава до следващата награда и как работи клубът.
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Me } from '../api';
import { Button, Card, H2, P, Row, s } from '../components/ui';
import { colors, fonts, pointsWord, radius } from '../theme';

type Props = { me: Me; refreshing: boolean; onRefresh: () => void; onShowCode: () => void; onGo: (tab: 'promotions' | 'rewards') => void };

export function Home({ me, refreshing, onRefresh, onShowCode, onGo }: Props) {
  const next = me.nextReward;
  const progress = next ? Math.max(0.04, Math.min(1, me.points / next.costPoints)) : 1;
  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}>
      <View style={st.hero}>
        <Text style={st.heroLabel}>Вашите точки</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <Text testID="points" style={st.heroNumber}>{me.points}</Text>
          <Text style={st.heroUnit}>{pointsWord(me.points)}</Text>
        </View>
        <View style={{ gap: 6 }}>
          <View style={st.track}><View style={[st.fill, { width: `${Math.round(progress * 100)}%` }]} /></View>
          <Text style={st.heroHint}>
            {next ? `Още ${next.missing} ${pointsWord(next.missing)} до „${next.title}“` : 'Точките Ви стигат за всяка награда'}
          </Text>
        </View>
        <Button testID="showCode" title="Покажете кода на касата" kind="light" onPress={onShowCode} />
      </View>

      {me.name ? <P muted>Здравейте, {me.name}!</P> : null}

      <View style={st.list}>
        <Row label="Активирани промоции" value={String(me.activePromotions)} />
        <Row label="Награди за получаване" value={String(me.pendingRewards)} last />
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Промоции" kind="ghost" style={{ flex: 1 }} onPress={() => onGo('promotions')} />
        <Button title="Награди" kind="ghost" style={{ flex: 1 }} onPress={() => onGo('rewards')} />
      </View>

      <H2>Как работи</H2>
      <Card style={{ padding: 0, gap: 0 }}>
        {[
          'Показвате кода си на касата при всяка покупка.',
          `Печелите точки: ${me.pointsPerEuro} ${pointsWord(me.pointsPerEuro)} за всяко 1\u00A0€.`,
          'Разменяте точките за продукти и отстъпки.',
        ].map((line, i) => (
          <View key={i} style={[st.step, i < 2 && { borderBottomWidth: 1, borderBottomColor: colors.line }]}>
            <View style={st.stepNo}><Text style={st.stepNoText}>{i + 1}</Text></View>
            <P style={{ flex: 1, fontSize: 15 }}>{line}</P>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  hero: { backgroundColor: colors.greenDeep, borderRadius: radius, padding: 20, gap: 14 },
  heroLabel: { fontFamily: fonts.old, fontSize: 14, letterSpacing: 2.6, textTransform: 'uppercase', color: '#b9f0d9' },
  heroNumber: { fontFamily: fonts.old, fontSize: 72, lineHeight: 72, color: colors.white },
  heroUnit: { fontFamily: fonts.body, fontSize: 16, color: colors.onGreenSoft, paddingBottom: 10 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.white },
  heroHint: { fontFamily: fonts.body, fontSize: 14, color: '#e6faf1' },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  step: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16 },
  stepNo: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  stepNoText: { fontFamily: fonts.old, fontSize: 18, color: colors.redText },
});
