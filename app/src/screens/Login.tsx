// Вход: имейл → код, пратен на него → (при първо влизане) име.
import { useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Me, setToken } from '../api';
import { Button, ErrorText, H1, P, s } from '../components/ui';
import { colors, fonts, radius } from '../theme';

type Props = { onDone: (token: string, me: Me) => void };

export function Login({ onDone }: Props) {
  const [step, setStep] = useState<'email' | 'code' | 'name'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [demoCode, setDemoCode] = useState('');
  const [session, setSession] = useState<{ token: string; me: Me } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.'); } finally { setBusy(false); }
  };
  const sendCode = () => guard(async () => {
    const r = await api.requestCode(email.trim());
    setDemoCode(r.demoCode ?? '');
    setCode('');
    setStep('code');
  });
  const verify = () => guard(async () => {
    const r = await api.verify(email.trim(), code);
    if (r.me.name) onDone(r.token, r.me);
    else { setSession({ token: r.token, me: r.me }); setStep('name'); }
  });
  const saveName = () => guard(async () => {
    if (!session) return;
    // името се записва с новата сесия; App я запомня чак след това
    setToken(session.token);
    onDone(session.token, await api.setName(name));
  });

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[s.screen, { paddingTop: 36 }]} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 10 }}>
          <Image source={require('../../assets/logo.png')} style={{ width: 88, height: 88, borderRadius: 44 }} accessibilityIgnoresInvertColors />
          <Text style={st.brand}>Хора от Народа</Text>
          <Text style={st.sub}>Клуб</Text>
        </View>

        {step === 'email' && (
          <View style={{ gap: 14 }}>
            <H1>Влезте с имейла си</H1>
            <P muted>Ще Ви пратим писмо с код. С него влизате и събирате точки от всяка покупка.</P>
            <View style={{ gap: 6 }}>
              <Text nativeID="emailLabel" style={st.label}>Имейл</Text>
              <TextInput testID="email" accessibilityLabelledBy="emailLabel" style={st.input} value={email} onChangeText={setEmail}
                keyboardType="email-address" inputMode="email" autoComplete="email" textContentType="emailAddress" autoCapitalize="none" autoCorrect={false}
                maxLength={254} placeholder="ime@primer.bg" placeholderTextColor={colors.muted} returnKeyType="done" onSubmitEditing={sendCode} />
            </View>
            <ErrorText>{error}</ErrorText>
            <Button testID="sendCode" title="Изпратете ми код" onPress={sendCode} busy={busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())} />
          </View>
        )}

        {step === 'code' && (
          <View style={{ gap: 14 }}>
            <H1>Въведете кода</H1>
            <P muted>Пратихме писмо с 6-цифрен код на {email.trim()}. Важи 10 минути. Ако не го виждате, погледнете и в папка „Спам“.</P>
            {demoCode ? <P testID="demoCode" style={st.demo}>Демо: писмо не се праща. Кодът е {demoCode}.</P> : null}
            <View style={{ gap: 6 }}>
              <Text nativeID="codeLabel" style={st.label}>Код от писмото</Text>
              <TextInput testID="code" accessibilityLabelledBy="codeLabel" style={[st.input, st.code]} value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))} keyboardType="number-pad" autoComplete="one-time-code"
                textContentType="oneTimeCode" maxLength={6} autoFocus returnKeyType="done" onSubmitEditing={verify} />
            </View>
            <ErrorText>{error}</ErrorText>
            <Button testID="verify" title="Влезте" onPress={verify} busy={busy} disabled={code.length !== 6} />
            <Button title="Друг имейл или нов код" kind="ghost" onPress={() => { setStep('email'); setError(''); }} />
          </View>
        )}

        {step === 'name' && (
          <View style={{ gap: 14 }}>
            <H1>Как да Ви наричаме?</H1>
            <P muted>Името се вижда на касата, когато покажете кода си.</P>
            <View style={{ gap: 6 }}>
              <Text nativeID="nameLabel" style={st.label}>Име</Text>
              <TextInput testID="name" accessibilityLabelledBy="nameLabel" style={st.input} value={name} onChangeText={setName}
                autoComplete="name" textContentType="name" autoCapitalize="words" maxLength={60} autoFocus returnKeyType="done" onSubmitEditing={saveName} />
            </View>
            <ErrorText>{error}</ErrorText>
            <Button testID="saveName" title="Готово" onPress={saveName} busy={busy} disabled={name.trim().length < 2} />
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  brand: { fontFamily: fonts.old, fontSize: 28, color: colors.ink },
  sub: { fontFamily: fonts.semi, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted },
  label: { fontFamily: fonts.semi, fontSize: 14, color: colors.ink },
  input: { minHeight: 52, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 18, color: colors.ink, backgroundColor: colors.white },
  code: { fontFamily: fonts.bold, fontSize: 26, letterSpacing: 8, textAlign: 'center' },
  demo: { backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radius, padding: 12 },
});
