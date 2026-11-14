// Покупки: всичко, купено с кода на клиента, с точките и отстъпките за всяка покупка.
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, PurchaseDetail } from '../api';
import { ErrorText, H1, Loading, P, s } from '../components/ui';
import { useLoad } from '../useLoad';
import { colors, dayTime, euro, fonts, radius } from '../theme';

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3).replace('.', ',').replace(/0+$/, ''));

export function Purchases() {
  const { data, error, setError, refreshing, refresh } = useLoad(() => api.purchases());
  const [openId, setOpenId] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, PurchaseDetail>>({});

  const toggle = async (id: number) => {
    if (openId === id) return setOpenId(null);
    setOpenId(id);
    if (details[id]) return;
    try {
      const d = await api.purchase(id);
      setDetails((all) => ({ ...all, [id]: d }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    }
  };

  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <H1>Моите покупки</H1>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}

      {data ? (
        <View style={st.totals}>
          <View style={st.total}><Text style={st.totalNo}>{data.totals.count}</Text><Text style={st.totalLabel}>покупки</Text></View>
          <View style={[st.total, st.mid]}><Text style={st.totalNo}>{euro(data.totals.total_cents)}</Text><Text style={st.totalLabel}>общо</Text></View>
          <View style={st.total}><Text style={st.totalNo}>{euro(data.totals.discount_cents)}</Text><Text style={st.totalLabel}>спестени</Text></View>
        </View>
      ) : null}

      {data && data.purchases.length === 0 ? (
        <P muted>Още нямате покупки с кода си. Покажете го на касата и те ще се появят тук.</P>
      ) : null}

      {data && data.purchases.length > 0 ? (
        <View style={st.list}>
          {data.purchases.map((p, i) => {
            const open = openId === p.id, d = details[p.id];
            return (
              <View key={p.id} style={i > 0 && { borderTopWidth: 1, borderTopColor: colors.line }}>
                <Pressable testID={`purchase-${p.id}`} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => toggle(p.id)} style={st.item}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={st.shop}>{p.shop || 'Магазин'}</Text>
                    <Text style={st.when}>{dayTime(p.purchased_at)}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={st.sum}>{euro(p.total_cents)}</Text>
                    <Text style={st.pts}>+{p.points_earned} точки</Text>
                  </View>
                </Pressable>
                {open ? (
                  <View style={st.detail}>
                    {!d ? <P muted style={{ fontSize: 14 }}>Зарежда се…</P> : null}
                    {d && d.items.length === 0 ? <P muted style={{ fontSize: 14 }}>Няма записани артикули за тази покупка.</P> : null}
                    {d?.items.map((it, k) => (
                      <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                        <P style={{ fontSize: 14, flex: 1 }}>{it.name}{it.quantity !== 1 ? ` × ${qty(it.quantity)}` : ''}</P>
                        <P style={{ fontSize: 14 }}>{euro(it.total_cents)}</P>
                      </View>
                    ))}
                    {p.discount_cents > 0 ? <P style={{ fontSize: 14, fontFamily: fonts.semi, color: colors.greenDeep }}>Отстъпка: {euro(p.discount_cents)}</P> : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  totals: { flexDirection: 'row', borderWidth: 1, borderColor: colors.line, borderRadius: radius, backgroundColor: colors.paper },
  total: { flex: 1, paddingVertical: 14, paddingHorizontal: 6, alignItems: 'center', gap: 2 },
  mid: { borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  totalNo: { fontFamily: fonts.bold, fontSize: 18, color: colors.ink },
  totalLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.muted },
  list: { borderWidth: 1, borderColor: colors.line, borderRadius: radius },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 16, minHeight: 56 },
  shop: { fontFamily: fonts.semi, fontSize: 16, color: colors.ink },
  when: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  sum: { fontFamily: fonts.bold, fontSize: 16, color: colors.ink },
  pts: { fontFamily: fonts.semi, fontSize: 13, color: colors.greenDeep },
  detail: { paddingHorizontal: 16, paddingBottom: 14, gap: 6 },
});
