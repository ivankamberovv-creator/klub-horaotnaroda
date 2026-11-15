// Награди: размяна на точки. Точките се взимат веднага, наградата се получава на касата.
import { useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { api, Reward } from '../api';
import { Button, Card, ErrorText, H1, H2, Loading, P, s } from '../components/ui';
import { useLoad } from '../useLoad';
import { colors, day, fonts, pointsWord, radius } from '../theme';

export function Rewards({ onChanged, onShowCode, onHistory, onParty }: { onChanged: () => void; onShowCode: () => void; onHistory: () => void; onParty: () => void }) {
  const { data, setData, error, setError, refreshing, refresh } = useLoad(() => api.rewards());
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const redeem = async (r: Reward) => {
    setBusyId(r.id);
    try {
      const done = await api.redeem(r.id);
      setData((d) => (d ? { ...d, points: done.points, redemptions: done.redemptions } : d));
      setError('');
      setConfirmId(null);
      onParty(); // наградата е Ваша: малко конфети
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    } finally {
      setBusyId(null);
    }
  };
  const pending = data?.redemptions.filter((x) => x.status === 'pending') ?? [];

  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <View style={{ gap: 6 }}>
        <H1>Награди</H1>
        {data ? <P muted>Имате <Text testID="rewardPoints" style={{ fontFamily: fonts.bold, color: colors.ink }}>{data.points} {pointsWord(data.points)}</Text>. Изберете за какво да ги размените.</P> : null}
      </View>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data ? <Button testID="toHistory" title="История на точките" kind="ghost" onPress={onHistory} style={{ minHeight: 44 }} /> : null}

      {pending.length > 0 ? (
        <Card active>
          <H2>За получаване на касата</H2>
          {pending.map((x) => (
            <View key={x.id} style={{ gap: 2 }}>
              <Text style={{ fontFamily: fonts.bold, fontSize: 16, color: colors.ink }}>{x.reward_title}</Text>
              <P muted style={{ fontSize: 14 }}>Заявена на {day(x.created_at)} срещу {x.points} точки</P>
            </View>
          ))}
          <Button title="Покажете картата" kind="ghost" onPress={onShowCode} />
        </Card>
      ) : null}

      {data && data.rewards.length === 0 ? <P muted>В момента няма награди.</P> : null}
      {data?.rewards.map((r) => {
        const missing = r.cost_points - data.points;
        return (
          <Card key={r.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={{ fontFamily: fonts.old, fontSize: 22, lineHeight: 25, color: colors.ink }}>{r.title}</Text>
                {r.description ? <P muted style={{ fontSize: 15 }}>{r.description}</P> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontFamily: fonts.bold, fontSize: 22, color: colors.ink }}>{r.cost_points}</Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.muted }}>точки</Text>
              </View>
            </View>
            {missing > 0 ? (
              <P muted style={{ fontFamily: fonts.semi, fontSize: 15 }}>Не достигат {missing} {pointsWord(missing)}</P>
            ) : confirmId === r.id ? (
              <View style={{ gap: 8, padding: 12, borderRadius: radius, backgroundColor: colors.paper }}>
                <P style={{ fontSize: 15 }}>Ще бъдат взети {r.cost_points} точки. Наградата получавате на касата.</P>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <Button testID={`confirm-${r.id}`} title="Потвърдете" busy={busyId === r.id} onPress={() => redeem(r)} style={{ flex: 1 }} />
                  <Button title="Не сега" kind="ghost" onPress={() => setConfirmId(null)} style={{ flex: 1 }} />
                </View>
              </View>
            ) : (
              <Button testID={`redeem-${r.id}`} title="Разменете точките" onPress={() => { setConfirmId(r.id); setError(''); }} />
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}
