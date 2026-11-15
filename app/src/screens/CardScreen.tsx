// Карта: баркодът, който касата сканира. Показва се и без интернет, от последно запомнения профил.
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Me } from '../api';
import { Barcode } from '../components/Barcode';
import { H1, P, Row, s } from '../components/ui';
import { groupCode } from '../barcode';
import { colors, fonts, radius } from '../theme';

export function CardScreen({ me, offline }: { me: Me; offline: boolean }) {
  const { width } = useWindowDimensions();
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <View style={{ gap: 6, alignItems: 'center' }}>
        <H1 style={{ textAlign: 'center' }}>Моята карта</H1>
        <P muted style={{ textAlign: 'center' }}>Покажете я на касата преди плащане. Касиерът сканира кода.</P>
      </View>

      <View style={st.card}>
        <Text style={st.owner}>{me.name || 'Клуб „Хора от Народа“'}</Text>
        <Barcode code={me.cardCode} width={Math.min(width, 480) - 2 * 20 - 2 * 14} />
        <Text testID="cardCode" style={st.digits}>{groupCode(me.cardCode)}</Text>
      </View>
      <P muted style={{ textAlign: 'center', fontSize: 14 }}>Ако четецът не го хване, усилете яркостта на екрана.</P>
      {offline ? <P testID="offlineNote" style={st.offline}>Няма интернет. Картата работи, но точките по-долу може да не са последните.</P> : null}

      <View style={st.list}>
        <Row label="Точки" value={String(me.points)} />
        <Row label="Активирани оферти" value={String(me.activePromotions)} />
        <Row label="Награди за получаване" value={String(me.pendingRewards)} last />
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 2, borderColor: colors.ink, borderRadius: radius, backgroundColor: '#ffffff', paddingVertical: 12, paddingHorizontal: 12, alignItems: 'center', gap: 2 },
  owner: { fontFamily: fonts.old, fontSize: 20, color: '#000000' },
  digits: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: 2, color: '#000000', paddingBottom: 4 },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  offline: { fontSize: 14, padding: 12, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius, backgroundColor: colors.paper },
});
