// Начало: точките, бърз достъп до картата, офертите, последната покупка и новините.
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { HomeData, Me, mediaUrl, Promotion } from '../api';
import { Button, H2, P, s } from '../components/ui';
import { Icon, IconName } from '../components/Icon';
import { InstallHint } from '../components/InstallHint';
import { CountUp } from '../components/CountUp';
import { Challenges } from '../components/Challenges';
import { colors, day, dayTime, euro, fonts, pointsWord, radius } from '../theme';

type Target = 'offers' | 'rewards' | 'purchases' | 'news' | 'stores' | 'history' | 'scratch' | 'missions';
type Props = { me: Me; home: HomeData | null; refreshing: boolean; onRefresh: () => void; onShowCard: () => void; onGo: (to: Target) => void };

function OfferTile({ offer, onPress }: { offer: Promotion; onPress: () => void }) {
  return (
    <Pressable testID={`offerTile-${offer.id}`} accessibilityRole="button" accessibilityLabel={offer.title} onPress={onPress}
      style={[st.tile, offer.activated && { borderColor: colors.greenFlag }]}>
      {offer.image_url
        ? <Image source={{ uri: mediaUrl(offer.image_url) }} style={st.tileImage} resizeMode="cover" accessibilityIgnoresInvertColors />
        : <View style={[st.tileImage, st.tileBlank]}><Icon name="tag" size={30} color={colors.white} /></View>}
      <View style={{ padding: 12, gap: 4, flex: 1 }}>
        {offer.tag ? <Text numberOfLines={1} style={st.tileTag}>{offer.tag}</Text> : null}
        <Text numberOfLines={2} style={st.tileTitle}>{offer.title}</Text>
        {offer.activated ? <Text style={st.tileOn}>Активирана</Text> : null}
      </View>
    </Pressable>
  );
}

function Shortcut({ icon, label, onPress, testID }: { icon: IconName; label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" onPress={onPress} style={st.shortcut}>
      <Icon name={icon} color={colors.greenDeep} />
      <Text numberOfLines={1} style={st.shortcutText}>{label}</Text>
    </Pressable>
  );
}

export function Home({ me, home, refreshing, onRefresh, onShowCard, onGo }: Props) {
  const next = me.nextReward;
  const progress = next ? Math.max(0.04, Math.min(1, me.points / next.costPoints)) : 1;
  const last = home?.lastPurchase ?? null;
  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.green} />}>
      {me.name ? <P muted>Здравейте, {me.name}!</P> : null}

      <View style={st.hero}>
        <Text style={st.heroLabel}>Вашите точки</Text>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
          <CountUp testID="points" value={me.points} style={st.heroNumber} />
          <Text style={st.heroUnit}>{pointsWord(me.points)}</Text>
        </View>
        <View style={{ gap: 6 }}>
          <View style={st.track}><View style={[st.fill, { width: `${Math.round(progress * 100)}%` }]} /></View>
          <Text style={st.heroHint}>
            {next ? `Още ${next.missing} ${pointsWord(next.missing)} до „${next.title}“` : 'Точките Ви стигат за всяка награда'}
          </Text>
        </View>
        <Button testID="showCard" title="Покажете картата на касата" kind="light" onPress={onShowCard} />
      </View>

      {me.welcomePoints > 0 ? (
        <View testID="welcomeGift" style={st.gift}>
          <Icon name="star" size={22} color={colors.greenDeep} filled />
          <Text style={st.giftText}>Подарък за добре дошли: +{me.welcomePoints} {pointsWord(me.welcomePoints)} с първата Ви покупка.</Text>
        </View>
      ) : null}

      {me.scratchCards > 0 ? (
        <Pressable testID="toScratch" accessibilityRole="button" onPress={() => onGo('scratch')} style={st.scratch}>
          <Icon name="star" size={30} color={colors.white} filled />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={st.scratchTitle}>{me.scratchCards === 1 ? 'Имате талон за изтриване' : `Имате ${me.scratchCards} талона за изтриване`}</Text>
            <Text style={st.scratchSub}>Изтрийте го и вижте колко точки печелите</Text>
          </View>
          <Icon name="chevron" size={22} color={colors.white} />
        </Pressable>
      ) : null}

      <InstallHint />

      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Shortcut testID="toPurchases" icon="receipt" label="Покупки" onPress={() => onGo('purchases')} />
        <Shortcut testID="toStores" icon="pin" label="Магазини" onPress={() => onGo('stores')} />
        <Shortcut testID="toHistoryHome" icon="history" label="Точки" onPress={() => onGo('history')} />
      </View>

      {home && home.offers.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View style={st.headRow}>
            <H2>Оферти за Вас</H2>
            <Pressable accessibilityRole="button" onPress={() => onGo('offers')} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={st.link}>Вижте всички</Text>
            </Pressable>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingRight: 20 }} style={{ marginRight: -20 }}>
            {home.offers.map((o) => <OfferTile key={o.id} offer={o} onPress={() => onGo('offers')} />)}
          </ScrollView>
        </View>
      ) : null}

      {home && home.challenges.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View style={st.headRow}>
            <H2>Мисии</H2>
            <Pressable accessibilityRole="button" onPress={() => onGo('missions')} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={st.link}>Вижте всички</Text>
            </Pressable>
          </View>
          <Challenges challenges={home.challenges.slice(0, 2)} />
        </View>
      ) : null}

      {last ? (
        <View style={{ gap: 10 }}>
          <H2>Последна покупка</H2>
          <Pressable accessibilityRole="button" onPress={() => onGo('purchases')} style={st.rowCard}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={st.rowTitle}>{last.shop || 'Магазин'}</Text>
              <Text style={st.rowSub}>{dayTime(last.purchased_at)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <Text style={st.rowTitle}>{euro(last.total_cents)}</Text>
              <Text style={[st.rowSub, { color: colors.greenDeep, fontFamily: fonts.semi }]}>+{last.points_earned} точки</Text>
            </View>
          </Pressable>
        </View>
      ) : null}

      {home && home.news.length > 0 ? (
        <View style={{ gap: 10 }}>
          <View style={st.headRow}>
            <H2>Новини</H2>
            {me.unreadNews > 0 ? <View style={st.badge}><Text style={st.badgeText}>{me.unreadNews}</Text></View> : null}
          </View>
          <View style={st.list}>
            {home.news.map((n, i) => (
              <Pressable key={n.id} accessibilityRole="button" onPress={() => onGo('news')} style={[st.newsRow, i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text numberOfLines={2} style={st.rowTitle}>{n.title}</Text>
                  <Text style={st.rowSub}>{day(n.published_at)}</Text>
                </View>
                <Icon name="chevron" size={20} color={colors.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  hero: { backgroundColor: colors.greenDeep, borderRadius: radius, padding: 20, gap: 14 },
  heroLabel: { fontFamily: fonts.old, fontSize: 14, letterSpacing: 2.6, textTransform: 'uppercase', color: '#b9f0d9' },
  heroNumber: { fontFamily: fonts.old, fontSize: 64, lineHeight: 64, color: colors.white },
  heroUnit: { fontFamily: fonts.body, fontSize: 16, color: colors.onGreenSoft, paddingBottom: 8 },
  track: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: colors.white },
  heroHint: { fontFamily: fonts.body, fontSize: 14, color: '#e6faf1' },
  gift: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.paper },
  giftText: { flex: 1, fontFamily: fonts.semi, fontSize: 15, lineHeight: 21, color: colors.ink },
  scratch: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius, backgroundColor: colors.redText, minHeight: 64 },
  scratchTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.white },
  scratchSub: { fontFamily: fonts.body, fontSize: 14, color: '#ffe3de' },
  shortcut: { flex: 1, minHeight: 72, borderWidth: 1, borderColor: colors.line, borderRadius: radius, alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 4 },
  shortcutText: { fontFamily: fonts.semi, fontSize: 13, color: colors.ink },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  link: { fontFamily: fonts.semi, fontSize: 15, color: colors.greenDeep, textDecorationLine: 'underline' },
  tile: { width: 190, borderWidth: 1, borderColor: colors.line, borderRadius: radius, backgroundColor: colors.white, overflow: 'hidden' },
  tileImage: { width: '100%', height: 104, backgroundColor: colors.paper },
  tileBlank: { backgroundColor: colors.greenDeep, alignItems: 'center', justifyContent: 'center' },
  tileTag: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.redText },
  tileTitle: { fontFamily: fonts.old, fontSize: 18, lineHeight: 21, color: colors.ink },
  tileOn: { fontFamily: fonts.bold, fontSize: 13, color: colors.greenDeep },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderWidth: 1, borderColor: colors.line, borderRadius: radius, minHeight: 56 },
  rowTitle: { fontFamily: fonts.semi, fontSize: 16, color: colors.ink },
  rowSub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  newsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 16, minHeight: 56 },
  badge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 7, backgroundColor: colors.redText, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontFamily: fonts.bold, fontSize: 13, color: colors.white },
});
