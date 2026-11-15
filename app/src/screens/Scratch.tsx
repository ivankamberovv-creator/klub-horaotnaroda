// Талони за изтриване: след покупка идва талон, който се трие с пръст и носи точки.
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { ScratchSurface } from '../components/ScratchSurface';
import { Button, ErrorText, H1, H2, Loading, P, s } from '../components/ui';
import { useLoad } from '../useLoad';
import { colors, day, fonts, pointsWord, radius } from '../theme';

export function Scratch({ onWon }: { onWon: () => void }) {
  const { data, error, setError, reload } = useLoad(() => api.scratch());
  const [active, setActive] = useState<{ id: number; prize: number } | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const fresh = data?.cards.filter((c) => c.status === 'new') ?? [];
  const past = data?.cards.filter((c) => c.status === 'revealed' && c.id !== active?.id) ?? [];

  const start = async (id: number) => {
    setBusy(true);
    try {
      // наградата идва от сървъра чак сега; точките вече са начислени, дори човекът да не доизтрие талона
      const won = await api.reveal(id);
      setActive({ id: won.id, prize: won.prize });
      setDone(false);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    } finally {
      setBusy(false);
    }
  };
  const finished = () => {
    setDone(true);
    onWon(); // обновява точките горе и пуска конфетите
  };
  const next = async () => {
    setActive(null);
    setDone(false);
    await reload();
  };

  // екранът не се превърта, за да не се мести, докато се трие
  return (
    <View style={[s.screen, { flex: 1 }]}>
      <H1>Талони за изтриване</H1>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}

      {active ? (
        <View style={{ gap: 12 }}>
          <ScratchSurface key={active.id} prize={active.prize} onDone={finished} />
          {done ? (
            <>
              <P testID="scratchWon" style={st.won}>Спечелихте {active.prize} {pointsWord(active.prize)}!</P>
              <Button testID="scratchNext" title={fresh.length > 1 ? 'Следващ талон' : 'Готово'} onPress={next} />
            </>
          ) : null}
        </View>
      ) : data && fresh.length > 0 ? (
        <View style={st.box}>
          <Text style={st.count}>{fresh.length}</Text>
          <P style={{ textAlign: 'center' }}>{fresh.length === 1 ? 'талон чака да го изтриете' : 'талона чакат да ги изтриете'}</P>
          <P muted style={{ textAlign: 'center', fontSize: 14 }}>От покупката Ви в {fresh[0].shop || 'магазина'} на {day(fresh[0].created_at)}. Всеки талон печели точки.</P>
          <Button testID="scratchStart" title="Изтрийте талона" busy={busy} onPress={() => start(fresh[0].id)} style={{ alignSelf: 'stretch' }} />
        </View>
      ) : data ? (
        <P muted>Нямате талони в момента. След всяка по-голяма покупка с картата идва нов.</P>
      ) : null}

      {!active && past.length > 0 ? (
        <View style={{ gap: 8 }}>
          <H2>Изтрити талони</H2>
          <View style={st.list}>
            {past.slice(0, 5).map((c, i) => (
              <View key={c.id} style={[st.row, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                <Text style={st.rowText}>{day(c.revealed_at ?? c.created_at)}</Text>
                <Text style={st.rowPrize}>+{c.prize} {pointsWord(c.prize ?? 0)}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const st = StyleSheet.create({
  box: { alignItems: 'center', gap: 10, padding: 20, borderWidth: 1, borderColor: colors.greenFlag, borderRadius: radius, backgroundColor: colors.paper },
  count: { fontFamily: fonts.old, fontSize: 64, lineHeight: 66, color: colors.greenDeep },
  won: { textAlign: 'center', fontFamily: fonts.bold, fontSize: 20, color: colors.greenDeep },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  rowText: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  rowPrize: { fontFamily: fonts.bold, fontSize: 15, color: colors.greenDeep },
});
