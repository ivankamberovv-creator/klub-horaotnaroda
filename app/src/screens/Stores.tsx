// Магазини: търсене, работно време, обаждане и упътване. Любимият магазин стои най-отгоре.
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Me, Store } from '../api';
import { ErrorText, H1, Loading, P, s } from '../components/ui';
import { Icon } from '../components/Icon';
import { useLoad } from '../useLoad';
import { hoursLines, openNow } from '../hours';
import { colors, fonts, radius } from '../theme';

const fold = (t: string) => t.toLocaleLowerCase('bg').replace(/\s+/g, ' ').trim();
const routeUrl = (st: Store) => 'https://www.google.com/maps/dir/?api=1&destination=' +
  encodeURIComponent(st.lat !== null && st.lng !== null ? `${st.lat},${st.lng}` : `${st.address}, ${st.city}`);
const prettyPhone = (p: string) => p.replace(/^\+359(\d{2,3})(\d{3})(\d{3})$/, '0$1 $2 $3');

export function Stores({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const { data, error, setError, refreshing, refresh } = useLoad(() => api.stores());
  const [query, setQuery] = useState('');

  const setFavorite = async (id: number | null) => {
    try {
      onMe(await api.setProfile({ favoriteStoreId: id }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    }
  };
  const q = fold(query);
  const stores = (data?.stores ?? [])
    .filter((x) => !q || fold(`${x.name} ${x.city} ${x.address}`).includes(q))
    .sort((a, b) => Number(b.id === me.favoriteStoreId) - Number(a.id === me.favoriteStoreId));

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <H1>Магазини</H1>
      <View style={{ gap: 6 }}>
        <Text nativeID="storeSearchLabel" style={st.label}>Търсете по град, квартал или адрес</Text>
        <TextInput testID="storeSearch" accessibilityLabelledBy="storeSearchLabel" style={st.input} value={query} onChangeText={setQuery}
          placeholder="Варна" placeholderTextColor={colors.muted} autoCorrect={false} returnKeyType="search" />
      </View>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data && stores.length === 0 ? <P muted>Няма магазин, който да отговаря на „{query}“.</P> : null}
      {stores.map((x) => {
        const open = openNow(x.hours), favorite = x.id === me.favoriteStoreId;
        return (
          <View key={x.id} testID={`store-${x.id}`} style={[st.card, favorite && { borderColor: colors.greenFlag, backgroundColor: colors.paper }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.name}>{x.name}</Text>
                <Text style={st.address}>{x.address}</Text>
              </View>
              <Pressable testID={`favorite-${x.id}`} accessibilityRole="button" accessibilityState={{ selected: favorite }}
                accessibilityLabel={favorite ? 'Махнете от любими' : 'Направете любим магазин'} onPress={() => setFavorite(favorite ? null : x.id)} hitSlop={8} style={st.star}>
                <Icon name="star" color={favorite ? colors.redText : colors.muted} filled={favorite} />
              </Pressable>
            </View>
            <View style={{ gap: 2 }}>
              {open !== null ? <Text style={[st.open, { color: open ? colors.greenDeep : colors.redText }]}>{open ? 'Отворено сега' : 'Затворено сега'}</Text> : null}
              {hoursLines(x.hours).map((line) => <Text key={line} style={st.hours}>{line}</Text>)}
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {x.phone ? (
                <Pressable accessibilityRole="link" accessibilityLabel={`Обадете се на ${prettyPhone(x.phone)}`} onPress={() => Linking.openURL(`tel:${x.phone}`)} style={st.action}>
                  <Icon name="phone" size={20} color={colors.greenDeep} /><Text style={st.actionText}>Обадете се</Text>
                </Pressable>
              ) : null}
              <Pressable accessibilityRole="link" onPress={() => Linking.openURL(routeUrl(x))} style={st.action}>
                <Icon name="route" size={20} color={colors.greenDeep} /><Text style={st.actionText}>Упътване</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  label: { fontFamily: fonts.semi, fontSize: 14, color: colors.ink },
  input: { minHeight: 50, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius, paddingHorizontal: 14, fontFamily: fonts.body, fontSize: 17, color: colors.ink, backgroundColor: colors.white },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius, padding: 16, gap: 12, backgroundColor: colors.white },
  name: { fontFamily: fonts.old, fontSize: 21, lineHeight: 24, color: colors.ink },
  address: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
  open: { fontFamily: fonts.bold, fontSize: 14 },
  hours: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  action: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius },
  actionText: { fontFamily: fonts.bold, fontSize: 15, color: colors.greenDeep },
});
