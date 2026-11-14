// Моят код: баркодът, който касата сканира, и профилът на клиента.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { api, Me } from '../api';
import { Barcode } from '../components/Barcode';
import { Button, ErrorText, H1, H2, P, Row, s } from '../components/ui';
import { groupCode } from '../barcode';
import { colors, fonts, radius } from '../theme';

export function Code({ me, onLogout, onDeleted }: { me: Me; onLogout: () => void; onDeleted: () => void }) {
  const { width } = useWindowDimensions();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const remove = async () => {
    setBusy(true);
    try {
      await api.deleteAccount();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={s.screen}>
      <View style={{ gap: 6, alignItems: 'center' }}>
        <H1 style={{ textAlign: 'center' }}>Моят код</H1>
        <P muted style={{ textAlign: 'center' }}>Покажете го на касата преди плащане. Касиерът го сканира.</P>
      </View>

      <View style={st.codeBox}>
        <Barcode code={me.cardCode} width={Math.min(width, 480) - 2 * 20 - 2 * 14} />
        <Text testID="cardCode" style={st.digits}>{groupCode(me.cardCode)}</Text>
      </View>
      <P muted style={{ textAlign: 'center', fontSize: 14 }}>Ако четецът не го хване, усилете яркостта на екрана.</P>

      <View style={st.list}>
        <Row label="Точки" value={String(me.points)} />
        <Row label="Активирани промоции" value={String(me.activePromotions)} />
        <Row label="Награди за получаване" value={String(me.pendingRewards)} last />
      </View>

      <H2>Профил</H2>
      <View style={st.list}>
        <Row label="Име" value={me.name || 'Без име'} />
        <Row label="Телефон" value={me.phone} last />
      </View>
      <ErrorText>{error}</ErrorText>
      <Button testID="logout" title="Изход" kind="ghost" onPress={onLogout} />
      {confirmDelete ? (
        <View style={st.danger}>
          <P style={{ fontSize: 15 }}>Профилът, точките и историята на покупките ще бъдат изтрити завинаги. Това не може да се върне.</P>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button testID="confirmDelete" title="Изтрийте" kind="danger" busy={busy} onPress={remove} style={{ flex: 1 }} />
            <Button title="Откажете" kind="ghost" onPress={() => setConfirmDelete(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <Button testID="deleteAccount" title="Изтрийте профила" kind="ghost" onPress={() => setConfirmDelete(true)} />
      )}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  codeBox: { borderWidth: 2, borderColor: colors.ink, borderRadius: radius, backgroundColor: '#ffffff', paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center', gap: 2 },
  digits: { fontFamily: fonts.bold, fontSize: 20, letterSpacing: 2, color: '#000000', paddingBottom: 8 },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  danger: { gap: 10, padding: 14, borderWidth: 1, borderColor: colors.redText, borderRadius: radius },
});
