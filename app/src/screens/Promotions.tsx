// Промоции: клиентът активира тези, които иска. На касата важат само активираните.
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, Promotion } from '../api';
import { Button, Card, ErrorText, Eyebrow, H1, Loading, P, s } from '../components/ui';
import { useLoad } from '../useLoad';
import { colors, day, euro, fonts } from '../theme';

const effect = (p: Promotion) => (p.kind === 'discount' ? `Отстъпка ${p.value}% на касата`
  : p.kind === 'double_points' ? (p.value === 2 ? 'Двойни точки' : `Точки по ${p.value}`)
    : p.kind === 'bonus_points' ? `+${p.value} точки при покупка над ${euro(p.min_total_cents)}` : '');

export function Promotions({ onChanged }: { onChanged: () => void }) {
  const { data, setData, error, setError, refreshing, refresh } = useLoad(() => api.promotions());
  const [busyId, setBusyId] = useState<number | null>(null);

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

  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <View style={{ gap: 6 }}>
        <H1>Промоции</H1>
        <P muted>Активирайте тези, които искате. На касата важат само активираните.</P>
      </View>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data && data.promotions.length === 0 ? <P muted>В момента няма промоции. Проверете пак скоро.</P> : null}
      {data?.promotions.map((p) => (
        <Card key={p.id} active={p.activated}>
          <View style={{ gap: 4 }}>
            {p.tag ? <Eyebrow>{p.tag}</Eyebrow> : null}
            <Text style={{ fontFamily: fonts.old, fontSize: 22, lineHeight: 25, color: colors.ink }}>{p.title}</Text>
            {p.description ? <P muted style={{ fontSize: 15 }}>{p.description}</P> : null}
            {effect(p) ? <P style={{ fontSize: 14, fontFamily: fonts.semi }}>{effect(p)}</P> : null}
            {p.ends_at ? <P muted style={{ fontSize: 13 }}>Важи до {day(p.ends_at)}</P> : null}
          </View>
          {p.activated ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 15, color: colors.greenDeep }}>Активирана</Text>
              <Button testID={`deactivate-${p.id}`} title="Откажете" kind="ghost" busy={busyId === p.id} onPress={() => toggle(p)} style={{ minHeight: 44 }} />
            </View>
          ) : (
            <Button testID={`activate-${p.id}`} title="Активирайте" busy={busyId === p.id} onPress={() => toggle(p)} />
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
