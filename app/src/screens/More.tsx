// Още: менюто с останалите раздели. Всеки се отваря на мястото на менюто, с бутон за връщане.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Me } from '../api';
import { H1, s } from '../components/ui';
import { Icon, IconName } from '../components/Icon';
import { Purchases } from './Purchases';
import { History } from './History';
import { Stores } from './Stores';
import { News } from './News';
import { Profile } from './Profile';
import { About } from './About';
import { Scratch } from './Scratch';
import { Missions } from './Missions';
import { colors, fonts, radius } from '../theme';

export type MoreSection = 'menu' | 'scratch' | 'missions' | 'purchases' | 'history' | 'stores' | 'news' | 'profile' | 'about';
const ITEMS: { id: Exclude<MoreSection, 'menu'>; label: string; icon: IconName }[] = [
  { id: 'scratch', label: 'Талони за изтриване', icon: 'star' },
  { id: 'missions', label: 'Мисии', icon: 'check' },
  { id: 'purchases', label: 'Моите покупки', icon: 'receipt' },
  { id: 'history', label: 'История на точките', icon: 'history' },
  { id: 'stores', label: 'Магазини', icon: 'pin' },
  { id: 'news', label: 'Новини', icon: 'bell' },
  { id: 'profile', label: 'Профил', icon: 'user' },
  { id: 'about', label: 'Как работи клубът', icon: 'info' },
];

type Props = {
  me: Me; section: MoreSection; onSection: (s: MoreSection) => void; onMe: (me: Me) => void;
  onNewsSeen: () => void; onLogout: () => void; onDeleted: () => void; onWon: () => void;
};

export function More({ me, section, onSection, onMe, onNewsSeen, onLogout, onDeleted, onWon }: Props) {
  if (section !== 'menu') {
    return (
      <View style={{ flex: 1 }}>
        <Pressable testID="backToMore" accessibilityRole="button" onPress={() => onSection('menu')} style={st.back}>
          <Icon name="back" size={22} color={colors.greenDeep} />
          <Text style={st.backText}>Още</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          {section === 'scratch' && <Scratch onWon={onWon} />}
          {section === 'missions' && <Missions />}
          {section === 'purchases' && <Purchases />}
          {section === 'history' && <History />}
          {section === 'stores' && <Stores me={me} onMe={onMe} />}
          {section === 'news' && <News onSeen={onNewsSeen} />}
          {section === 'profile' && <Profile me={me} onMe={onMe} onLogout={onLogout} onDeleted={onDeleted} />}
          {section === 'about' && <About me={me} />}
        </View>
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={s.screen}>
      <H1>Още</H1>
      <View style={st.list}>
        {ITEMS.map((it, i) => (
          <Pressable key={it.id} testID={`more-${it.id}`} accessibilityRole="button" onPress={() => onSection(it.id)}
            style={[st.item, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
            <Icon name={it.icon} color={colors.greenDeep} />
            <Text style={st.itemText}>{it.label}</Text>
            {it.id === 'news' && me.unreadNews > 0 ? <View style={st.badge}><Text style={st.badgeText}>{me.unreadNews}</Text></View> : null}
            {it.id === 'scratch' && me.scratchCards > 0 ? <View style={st.badge}><Text style={st.badgeText}>{me.scratchCards}</Text></View> : null}
            <Icon name="chevron" size={20} color={colors.muted} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 48, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  backText: { fontFamily: fonts.semi, fontSize: 16, color: colors.greenDeep },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  item: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 60, paddingHorizontal: 16 },
  itemText: { flex: 1, fontFamily: fonts.semi, fontSize: 17, color: colors.ink },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: colors.redText, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
