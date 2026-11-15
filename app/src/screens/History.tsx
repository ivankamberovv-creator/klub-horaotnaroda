// История на точките: всяко начисляване и всяко харчене.
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { ErrorText, H1, Loading, P, s } from '../components/ui';
import { useLoad } from '../useLoad';
import { colors, dayTime, fonts, pointsWord, radius } from '../theme';

export function History() {
  const { data, error, refreshing, refresh } = useLoad(() => api.history());
  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <View style={{ gap: 6 }}>
        <H1>История на точките</H1>
        {data ? <P muted>В момента имате <Text style={{ fontFamily: fonts.bold, color: colors.ink }}>{data.points} {pointsWord(data.points)}</Text>.</P> : null}
      </View>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data && data.history.length === 0 ? <P muted>Още няма движения. Точките идват с първата покупка, при която покажете картата си.</P> : null}
      {data && data.history.length > 0 ? (
        <View style={st.list}>
          {data.history.map((h, i) => (
            <View key={h.id} testID={`history-${i}`} style={[st.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.label}>{h.label}</Text>
                <Text style={st.when}>{dayTime(h.at)}</Text>
              </View>
              <Text style={[st.delta, { color: h.delta >= 0 ? colors.greenDeep : colors.redText }]}>{h.delta > 0 ? '+' : ''}{h.delta}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16, minHeight: 56 },
  label: { fontFamily: fonts.semi, fontSize: 15, color: colors.ink },
  when: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  delta: { fontFamily: fonts.bold, fontSize: 18 },
});
