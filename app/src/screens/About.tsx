// Как работи клубът: кратко и без условия, които още не са решени от собственика.
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Me } from '../api';
import { Card, H1, P, s } from '../components/ui';
import { colors, fonts, pointsWord } from '../theme';

export function About({ me }: { me: Me }) {
  const steps = [
    ['Покажете картата си', 'Преди плащане отворете „Карта“ и дайте на касиера да сканира кода.'],
    ['Печелите точки', `За всяко 1 € от покупката получавате ${me.pointsPerEuro} ${pointsWord(me.pointsPerEuro)}. Активираните оферти могат да ги увеличат.`],
    ['Активирайте оферти', 'В „Оферти“ избирате кои да ползвате. На касата важат само активираните.'],
    ['Разменете точките', 'В „Награди“ избирате награда. Точките се взимат веднага, а наградата получавате на касата.'],
    ['Следете покупките си', 'В „Покупки“ стои всичко, купено с картата Ви, с точките и отстъпките.'],
  ];
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <H1>Как работи клубът</H1>
      <Card style={{ padding: 0, gap: 0 }}>
        {steps.map(([title, body], i) => (
          <View key={title} style={[st.step, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
            <View style={st.no}><Text style={st.noText}>{i + 1}</Text></View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.title}>{title}</Text>
              <P muted style={{ fontSize: 15 }}>{body}</P>
            </View>
          </View>
        ))}
      </Card>
      <P muted style={{ fontSize: 14 }}>Профила си можете да изтриете по всяко време от „Профил“. Тогава се изтриват и точките, и историята на покупките.</P>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 16 },
  no: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper, alignItems: 'center', justifyContent: 'center' },
  noText: { fontFamily: fonts.old, fontSize: 18, color: colors.redText },
  title: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
});
