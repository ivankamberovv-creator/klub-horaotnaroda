// Профил: име, рожден ден (записва се веднъж), изход и изтриване на профила.
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Me } from '../api';
import { Button, ErrorText, H1, H2, P, Row, s } from '../components/ui';
import { colors, fonts, radius } from '../theme';

export function Profile({ me, onMe, onLogout, onDeleted }: { me: Me; onMe: (me: Me) => void; onLogout: () => void; onDeleted: () => void }) {
  const [name, setName] = useState(me.name);
  const [birthday, setBirthday] = useState('');
  const [busy, setBusy] = useState<'' | 'name' | 'birthday' | 'delete'>('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  const save = async (what: 'name' | 'birthday') => {
    setBusy(what);
    setError('');
    setSaved('');
    try {
      onMe(await api.setProfile(what === 'name' ? { name } : { birthday }));
      setSaved(what === 'name' ? 'Името е записано.' : 'Рожденият ден е записан.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    } finally {
      setBusy('');
    }
  };
  const remove = async () => {
    setBusy('delete');
    try {
      await api.deleteAccount();
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
      setBusy('');
    }
  };

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled">
      <H1>Профил</H1>
      <View style={st.list}><Row label="Имейл" value={me.email} last /></View>

      <View style={{ gap: 8 }}>
        <Text nativeID="profileNameLabel" style={st.label}>Име</Text>
        <TextInput testID="profileName" accessibilityLabelledBy="profileNameLabel" style={st.input} value={name} onChangeText={setName}
          autoComplete="name" autoCapitalize="words" maxLength={60} />
        <Button testID="saveProfileName" title="Запазете името" kind="ghost" busy={busy === 'name'} disabled={name.trim().length < 2 || name.trim() === me.name} onPress={() => save('name')} />
      </View>

      <View style={{ gap: 8 }}>
        <H2>Рожден ден</H2>
        {me.birthday ? (
          <P>Записан е <Text testID="birthdayValue" style={{ fontFamily: fonts.bold }}>{me.birthday}</Text>. За промяна се обърнете към магазина.</P>
        ) : (
          <>
            <P muted>Кажете ни деня и месеца и на рождения си ден получавате точки подарък. Записва се само веднъж.</P>
            <Text nativeID="birthdayLabel" style={st.label}>Ден и месец</Text>
            <TextInput testID="birthday" accessibilityLabelledBy="birthdayLabel" style={st.input} value={birthday} onChangeText={setBirthday}
              placeholder="14.11" placeholderTextColor={colors.muted} keyboardType="numbers-and-punctuation" maxLength={6} />
            <Button testID="saveBirthday" title="Запишете рождения ден" kind="ghost" busy={busy === 'birthday'} disabled={birthday.trim().length < 3} onPress={() => save('birthday')} />
          </>
        )}
      </View>

      {saved ? <P testID="profileSaved" style={{ fontFamily: fonts.bold, color: colors.greenDeep }}>{saved}</P> : null}
      <ErrorText>{error}</ErrorText>

      <Button testID="logout" title="Изход" kind="ghost" onPress={onLogout} />
      {confirmDelete ? (
        <View style={st.danger}>
          <P style={{ fontSize: 15 }}>Профилът, точките и историята на покупките ще бъдат изтрити завинаги. Това не може да се върне.</P>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button testID="confirmDelete" title="Изтрийте" kind="danger" busy={busy === 'delete'} onPress={remove} style={{ flex: 1 }} />
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
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  label: { fontFamily: fonts.semi, fontSize: 14, color: colors.ink },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 17, color: colors.ink, backgroundColor: colors.white },
  danger: { gap: 10, padding: 14, borderWidth: 1, borderColor: colors.redText, borderRadius: radius },
});
