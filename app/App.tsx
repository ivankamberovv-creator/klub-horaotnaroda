// Клуб „Хора от Народа“: началото на приложението. Държи входа и петте раздела.
import { useCallback, useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// всяко начертание се внася поотделно, за да не се пакетират ненужни шрифтове
import { OldStandardTT_700Bold } from '@expo-google-fonts/old-standard-tt/700Bold';
import { GolosText_400Regular } from '@expo-google-fonts/golos-text/400Regular';
import { GolosText_500Medium } from '@expo-google-fonts/golos-text/500Medium';
import { GolosText_600SemiBold } from '@expo-google-fonts/golos-text/600SemiBold';
import { GolosText_700Bold } from '@expo-google-fonts/golos-text/700Bold';
import { api, Me, setToken, setUnauthorizedHandler } from './src/api';
import { loadToken, saveToken } from './src/storage';
import { Button, ErrorText, Loading, P, Tricolor } from './src/components/ui';
import { Login } from './src/screens/Login';
import { Home } from './src/screens/Home';
import { Promotions } from './src/screens/Promotions';
import { Rewards } from './src/screens/Rewards';
import { Purchases } from './src/screens/Purchases';
import { Code } from './src/screens/Code';
import { colors, fonts } from './src/theme';

type Tab = 'home' | 'promotions' | 'rewards' | 'purchases' | 'code';
const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Начало' },
  { id: 'promotions', label: 'Промоции' },
  { id: 'rewards', label: 'Награди' },
  { id: 'purchases', label: 'Покупки' },
  { id: 'code', label: 'Моят код' },
];

export default function App() {
  const [fontsReady] = useFonts({ OldStandardTT_700Bold, GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold });
  const [state, setState] = useState<'starting' | 'out' | 'in'>('starting');
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const signOut = useCallback(() => {
    setToken(null);
    saveToken(null);
    setMe(null);
    setTab('home');
    setState('out');
  }, []);

  const refreshMe = useCallback(async (pulled = false) => {
    if (pulled) setRefreshing(true);
    try {
      setMe(await api.me());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    } finally {
      setRefreshing(false);
    }
  }, []);

  // при пускане: ако има запомнен вход, пробваме го
  useEffect(() => {
    setUnauthorizedHandler(signOut);
    (async () => {
      const saved = await loadToken();
      if (!saved) return setState('out');
      setToken(saved);
      setState('in');
      refreshMe();
    })();
  }, [signOut, refreshMe]);

  const signedIn = (token: string, profile: Me) => {
    setToken(token);
    saveToken(token);
    setMe(profile);
    setState('in');
  };
  const logout = async () => {
    try { await api.logout(); } catch { /* излизаме и без връзка */ }
    signOut();
  };
  const go = (next: Tab) => {
    setTab(next);
    if (next === 'home' || next === 'code') refreshMe();
  };

  if (!fontsReady || state === 'starting') {
    return <View style={[st.root, { justifyContent: 'center' }]}><Loading /></View>;
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={st.root} edges={['top', 'left', 'right', 'bottom']}>
        <StatusBar style="dark" />
        <Tricolor />
        {state === 'out' ? (
          <Login onDone={signedIn} />
        ) : (
          <>
            <View style={st.header}>
              <Image source={require('./assets/logo.png')} style={st.logo} accessibilityIgnoresInvertColors />
              <View style={{ gap: 2 }}>
                <Text style={st.brand}>Хора от Народа</Text>
                <Text style={st.sub}>Клуб</Text>
              </View>
              {me ? (
                <View style={{ marginLeft: 'auto', alignItems: 'flex-end' }}>
                  <Text testID="headerPoints" style={st.headerPoints}>{me.points}</Text>
                  <Text style={st.headerUnit}>точки</Text>
                </View>
              ) : null}
            </View>

            <View style={{ flex: 1 }}>
              {!me ? (
                <View style={{ padding: 20, gap: 14 }}>
                  {error ? <><ErrorText>{error}</ErrorText><Button title="Опитайте пак" onPress={() => refreshMe()} /></> : <Loading />}
                </View>
              ) : (
                <>
                  {tab === 'home' && <Home me={me} refreshing={refreshing} onRefresh={() => refreshMe(true)} onShowCode={() => go('code')} onGo={go} />}
                  {tab === 'promotions' && <Promotions onChanged={refreshMe} />}
                  {tab === 'rewards' && <Rewards onChanged={refreshMe} onShowCode={() => go('code')} />}
                  {tab === 'purchases' && <Purchases />}
                  {tab === 'code' && <Code me={me} onLogout={logout} onDeleted={signOut} />}
                </>
              )}
              {me && error ? <View style={st.offline}><P style={{ fontSize: 14 }}>{error}</P></View> : null}
            </View>

            <View accessibilityRole="tablist" style={st.tabs}>
              {TABS.map((t) => {
                const on = tab === t.id;
                return (
                  <Pressable key={t.id} testID={`tab-${t.id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => go(t.id)} style={st.tab}>
                    <View style={[st.tabMark, on && { backgroundColor: colors.red }]} />
                    <Text numberOfLines={1} style={[st.tabText, on && { color: colors.greenDeep, fontFamily: fonts.bold }]}>{t.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: colors.line },
  logo: { width: 44, height: 44, borderRadius: 22 },
  brand: { fontFamily: fonts.old, fontSize: 21, lineHeight: 23, color: colors.ink },
  sub: { fontFamily: fonts.semi, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.muted },
  headerPoints: { fontFamily: fonts.bold, fontSize: 22, lineHeight: 24, color: colors.greenDeep },
  headerUnit: { fontFamily: fonts.body, fontSize: 11, color: colors.muted },
  tabs: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 2 },
  tabMark: { width: 22, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  offline: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: 12, borderRadius: 4, borderWidth: 1, borderColor: colors.redText, backgroundColor: colors.bg },
});
