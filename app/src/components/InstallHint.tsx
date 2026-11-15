// Подкана приложението да се сложи на началния екран. Показва се само в браузър,
// докато приложението още не е инсталирано: на Android с бутон, на iPhone с указания.
import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { Button, Card, P } from './ui';
import { Icon } from './Icon';
import { colors, fonts } from '../theme';

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const DISMISS_KEY = 'klub_install_dismissed';

export function InstallHint() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [mode, setMode] = useState<'none' | 'android' | 'ios'>('none');

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const w = globalThis as unknown as Window;
    const nav = w.navigator as Navigator & { standalone?: boolean };
    const installed = w.matchMedia?.('(display-mode: standalone)').matches || nav.standalone === true;
    let dismissed = false;
    try { dismissed = w.localStorage.getItem(DISMISS_KEY) === '1'; } catch { /* без памет */ }
    if (installed || dismissed) return;
    // iPhone и iPad нямат бутон за инсталиране: става от менюто „Споделяне“ на Safari
    if (/iphone|ipad|ipod/i.test(nav.userAgent)) setMode('ios');
    const onPrompt = (e: Event) => { e.preventDefault(); setEvent(e as InstallEvent); setMode('android'); };
    const onInstalled = () => setMode('none');
    w.addEventListener('beforeinstallprompt', onPrompt);
    w.addEventListener('appinstalled', onInstalled);
    return () => { w.removeEventListener('beforeinstallprompt', onPrompt); w.removeEventListener('appinstalled', onInstalled); };
  }, []);

  if (mode === 'none') return null;
  const dismiss = () => {
    try { (globalThis as unknown as Window).localStorage.setItem(DISMISS_KEY, '1'); } catch { /* без памет */ }
    setMode('none');
  };
  const install = async () => {
    if (!event) return;
    await event.prompt();
    await event.userChoice;
    setEvent(null);
    setMode('none');
  };

  return (
    <Card testID="installHint" style={{ backgroundColor: colors.paper }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="install" color={colors.greenDeep} />
        <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink, flex: 1 }}>Сложете приложението на началния екран</Text>
      </View>
      {mode === 'ios' ? (
        <P style={{ fontSize: 15 }}>В Safari натиснете бутона „Споделяне“ долу и изберете „Към началния екран“. После го отваряте като всяко друго приложение.</P>
      ) : (
        <P style={{ fontSize: 15 }}>Отваря се с едно докосване и картата Ви се вижда и без интернет.</P>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {mode === 'android' ? <Button testID="installNow" title="Инсталирайте" onPress={install} style={{ flex: 1 }} /> : null}
        <Button title={mode === 'ios' ? 'Разбрах' : 'Не сега'} kind="ghost" onPress={dismiss} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
