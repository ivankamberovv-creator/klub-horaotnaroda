// Оферти: клиентът активира тези, които иска. На касата важат само активираните.
import { useState } from 'react';
import { Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, mediaUrl, Promotion } from '../api';
import { Button, Card, ErrorText, Eyebrow, H1, Loading, P, s } from '../components/ui';
import { Icon } from '../components/Icon';
import { useLoad } from '../useLoad';
import { colors, day, euro, fonts, radius } from '../theme';

const effect = (p: Promotion) => (p.kind === 'discount' ? `Отстъпка ${p.value}% на касата`
  : p.kind === 'double_points' ? (p.value === 2 ? 'Двойни точки' : `Точки по ${p.value}`)
    : p.kind === 'bonus_points' ? `+${p.value} точки при покупка над ${euro(p.min_total_cents)}` : '');

/** „Важи до 20 ноември 2026“, а в последните дни: „Остават 3 дни“ */
function expiry(endsAt: string | null, now = new Date()) {
  if (!endsAt) return null;
  const days = Math.ceil((new Date(endsAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 1) return { text: 'Изтича днес', soon: true };
  if (days <= 7) return { text: `Остават ${days} дни`, soon: true };
  return { text: `Важи до ${day(endsAt)}`, soon: false };
}

export function Offers({ onChanged }: { onChanged: () => void }) {
  const { data, setData, error, setError, refreshing, refresh } = useLoad(() => api.promotions());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);

  const toggle = async (p: Promotion) => {
    setBusyId(p.id);
    try {
      setData(await (p.activated ? api.deactivate(p.id) : api.activate(p.id)));
      setError('');
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    } finally {
      setBusyId(null);
    }
  };
  const all = data?.promotions ?? [];
  const mine = all.filter((p) => p.activated);
  const shown = onlyMine ? mine : all;

  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <View style={{ gap: 6 }}>
        <H1>Оферти</H1>
        <P muted>Активирайте тези, които искате. На касата важат само активираните.</P>
      </View>
      {data ? (
        <View accessibilityRole="tablist" style={{ flexDirection: 'row', gap: 8 }}>
          {[{ on: !onlyMine, label: `Всички (${all.length})`, set: false, id: 'filterAll' }, { on: onlyMine, label: `Активирани (${mine.length})`, set: true, id: 'filterMine' }].map((f) => (
            <Pressable key={f.id} testID={f.id} accessibilityRole="tab" accessibilityState={{ selected: f.on }} onPress={() => setOnlyMine(f.set)}
              style={[st.chip, f.on && { backgroundColor: colors.greenDeep, borderColor: colors.greenDeep }]}>
              <Text style={[st.chipText, f.on && { color: colors.white }]}>{f.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data && shown.length === 0 ? (
        <P muted>{onlyMine ? 'Още не сте активирали оферти. Изберете от „Всички“.' : 'В момента няма оферти. Проверете пак скоро.'}</P>
      ) : null}
      {shown.map((p) => {
        const ex = expiry(p.ends_at);
        return (
          <Card key={p.id} active={p.activated} style={{ padding: 0, gap: 0, overflow: 'hidden' }}>
            {p.image_url ? <Image source={{ uri: mediaUrl(p.image_url) }} style={st.image} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
            <View style={{ padding: 16, gap: 12 }}>
              <View style={{ gap: 4 }}>
                {p.tag ? <Eyebrow>{p.tag}</Eyebrow> : null}
                <Text style={st.title}>{p.title}</Text>
                {p.description ? <P muted style={{ fontSize: 15 }}>{p.description}</P> : null}
                {effect(p) && effect(p) !== p.title ? <P style={{ fontSize: 14, fontFamily: fonts.semi }}>{effect(p)}</P> : null}
                {ex ? <Text style={[st.expiry, ex.soon && { color: colors.redText, fontFamily: fonts.semi }]}>{ex.text}</Text> : null}
              </View>
              {p.activated ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Icon name="check" size={20} color={colors.greenDeep} />
                    <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.greenDeep }}>Активирана</Text>
                  </View>
                  <Button testID={`deactivate-${p.id}`} title="Откажете" kind="ghost" busy={busyId === p.id} onPress={() => toggle(p)} style={{ minHeight: 44 }} />
                </View>
              ) : (
                <Button testID={`activate-${p.id}`} title="Активирайте" busy={busyId === p.id} onPress={() => toggle(p)} />
              )}
            </View>
          </Card>
        );
      })}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  chip: { minHeight: 44, paddingHorizontal: 16, borderRadius: 22, borderWidth: 1, borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: fonts.semi, fontSize: 14, color: colors.ink },
  image: { width: '100%', height: 150, backgroundColor: colors.paper },
  title: { fontFamily: fonts.old, fontSize: 22, lineHeight: 25, color: colors.ink },
  expiry: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, borderRadius: radius },
});
