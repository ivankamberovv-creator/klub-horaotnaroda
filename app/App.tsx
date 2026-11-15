// Клуб „Хора от Народа“: началото на приложението. Държи входа и разделите.
// Подредбата е като при големите приложения с карти за лоялност: начало, оферти, картата в средата, награди и „Още“.
import { useCallback, useEffect, useState } from 'react';
import { BackHandler, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
// всяко начертание се внася поотделно, за да не се пакетират ненужни шрифтове
import { OldStandardTT_700Bold } from '@expo-google-fonts/old-standard-tt/700Bold';
import { GolosText_400Regular } from '@expo-google-fonts/golos-text/400Regular';
import { GolosText_500Medium } from '@expo-google-fonts/golos-text/500Medium';
import { GolosText_600SemiBold } from '@expo-google-fonts/golos-text/600SemiBold';
import { GolosText_700Bold } from '@expo-google-fonts/golos-text/700Bold';
import { api, ApiError, HomeData, Me, setToken, setUnauthorizedHandler } from './src/api';
import { loadCachedMe, loadToken, saveCachedMe, saveToken } from './src/storage';
import { Button, ErrorText, Loading, Tricolor } from './src/components/ui';
import { Icon, IconName } from './src/components/Icon';
import { Login } from './src/screens/Login';
import { Home } from './src/screens/Home';
import { Offers } from './src/screens/Offers';
import { CardScreen } from './src/screens/CardScreen';
import { Rewards } from './src/screens/Rewards';
import { More, MoreSection } from './src/screens/More';
import { colors, fonts } from './src/theme';

type Tab = 'home' | 'offers' | 'card' | 'rewards' | 'more';
const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'home', label: 'Начало', icon: 'home' },
  { id: 'offers', label: 'Оферти', icon: 'tag' },
  { id: 'card', label: 'Карта', icon: 'card' },
  { id: 'rewards', label: 'Награди', icon: 'gift' },
  { id: 'more', label: 'Още', icon: 'more' },
];

export default function App() {
  const [fontsReady] = useFonts({ OldStandardTT_700Bold, GolosText_400Regular, GolosText_500Medium, GolosText_600SemiBold, GolosText_700Bold });
  const [state, setState] = useState<'starting' | 'out' | 'in'>('starting');
  const [me, setMeState] = useState<Me | null>(null);
  const [home, setHome] = useState<HomeData | null>(null);
  const [tab, setTab] = useState<Tab>('home');
  const [section, setSection] = useState<MoreSection>('menu');
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);

  // профилът се помни и на устройството, за да се вижда картата и без интернет
  const setMe = useCallback((next: Me | null) => {
    setMeState(next);
    saveCachedMe(next);
  }, []);

  const signOut = useCallback(() => {
    setToken(null);
    saveToken(null);
    setMe(null);
    setHome(null);
    setTab('home');
    setSection('menu');
    setError('');
    setOffline(false);
    setState('out');
  }, [setMe]);

  const refresh = useCallback(async (pulled = false) => {
    if (pulled) setRefreshing(true);
    try {
      const data = await api.home();
      setHome(data);
      setMe(data.me);
      setError('');
      setOffline(false);
    } catch (e) {
      const network = e instanceof ApiError && e.code === 'network';
      setOffline(network);
      setError(network ? '' : e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    } finally {
      setRefreshing(false);
    }
  }, [setMe]);

  // при пускане: ако има запомнен вход, показваме запомнения профил веднага и го освежаваме
  useEffect(() => {
    setUnauthorizedHandler(signOut);
    (async () => {
      const saved = await loadToken();
      if (!saved) return setState('out');
      setToken(saved);
      const cached = await loadCachedMe<Me>();
      if (cached) setMeState(cached);
      setState('in');
      refresh();
    })();
  }, [signOut, refresh]);

  // на Android бутонът „Назад“ връща към менюто или към началото, вместо да затваря приложението
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'more' && section !== 'menu') { setSection('menu'); return true; }
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => sub.remove();
  }, [tab, section]);

  const signedIn = (token: string, profile: Me) => {
    setToken(token);
    saveToken(token);
    setMe(profile);
    setState('in');
    refresh();
  };
  const logout = async () => {
    try { await api.logout(); } catch { /* излизаме и без връзка */ }
    signOut();
  };
  const go = (next: Tab, sub: MoreSection = 'menu') => {
    setTab(next);
    setSection(sub);
    if (next === 'home' || next === 'card') refresh();
  };
  const goFromHome = (to: 'offers' | 'rewards' | 'purchases' | 'news' | 'stores' | 'history') =>
    (to === 'offers' || to === 'rewards' ? go(to) : go('more', to));
  const newsSeen = useCallback(() => setMeState((m) => (m && m.unreadNews ? { ...m, unreadNews: 0 } : m)), []);

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
            {offline && me ? <View testID="offlineBar" style={st.offline}><Text style={st.offlineText}>Няма връзка. Показваме последно запомненото.</Text></View> : null}

            <View style={{ flex: 1 }}>
              {!me ? (
                <View style={{ padding: 20, gap: 14 }}>
                  {error || offline ? (
                    <>
                      <ErrorText>{error || 'Няма връзка със сървъра. Проверете интернета и опитайте пак.'}</ErrorText>
                      <Button title="Опитайте пак" onPress={() => refresh()} />
                    </>
                  ) : <Loading />}
                </View>
              ) : (
                <>
                  {tab === 'home' && <Home me={me} home={home} refreshing={refreshing} onRefresh={() => refresh(true)} onShowCard={() => go('card')} onGo={goFromHome} />}
                  {tab === 'offers' && <Offers onChanged={refresh} />}
                  {tab === 'card' && <CardScreen me={me} offline={offline} />}
                  {tab === 'rewards' && <Rewards onChanged={refresh} onShowCode={() => go('card')} onHistory={() => go('more', 'history')} />}
                  {tab === 'more' && <More me={me} section={section} onSection={setSection} onMe={setMe} onNewsSeen={newsSeen} onLogout={logout} onDeleted={signOut} />}
                </>
              )}
              {me && error ? <View style={st.errorBox}><ErrorText>{error}</ErrorText></View> : null}
            </View>

            <View accessibilityRole="tablist" style={st.tabs}>
              {TABS.map((t) => {
                const on = tab === t.id, center = t.id === 'card';
                return (
                  <Pressable key={t.id} testID={`tab-${t.id}`} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={t.label}
                    onPress={() => go(t.id)} style={st.tab}>
                    {center ? (
                      <View style={[st.cardButton, on && { backgroundColor: colors.greenDeep }]}><Icon name="card" size={28} color={colors.white} /></View>
                    ) : (
                      <View>
                        <Icon name={t.icon} color={on ? colors.greenDeep : colors.muted} />
                        {t.id === 'more' && me && me.unreadNews > 0 ? <View testID="moreDot" style={st.dot} /> : null}
                      </View>
                    )}
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
  offline: { backgroundColor: colors.ink, paddingVertical: 6, paddingHorizontal: 20 },
  offlineText: { fontFamily: fonts.semi, fontSize: 13, color: colors.white, textAlign: 'center' },
  errorBox: { position: 'absolute', left: 12, right: 12, bottom: 12, padding: 12, borderRadius: 4, borderWidth: 1, borderColor: colors.redText, backgroundColor: colors.bg },
  tabs: { flexDirection: 'row', alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.bg, paddingBottom: 4 },
  tab: { flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'flex-end', gap: 3, paddingHorizontal: 2, paddingBottom: 4 },
  tabText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  cardButton: { width: 56, height: 56, borderRadius: 28, marginTop: -22, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: colors.bg },
  dot: { position: 'absolute', top: -2, right: -6, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.redText },
});
