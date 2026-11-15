// Магазини: търсене, най-близкият до клиента, работно време, обаждане и упътване. Любимият магазин стои най-отгоре,
// а след „Намерете най-близкия“ магазините се подреждат по разстояние.
import { useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, Me, Store } from '../api';
import { Button, ErrorText, H1, Loading, P, s } from '../components/ui';
import { Icon } from '../components/Icon';
import { useLoad } from '../useLoad';
import { hoursLines, openNow } from '../hours';
import { colors, fonts, radius } from '../theme';
import { byDistance, formatDistance, locate, Point } from '../geo';

const fold = (t: string) => t.toLocaleLowerCase('bg').replace(/\s+/g, ' ').trim();
const routeUrl = (st: Store) => 'https://www.google.com/maps/dir/?api=1&destination=' +
  encodeURIComponent(st.lat !== null && st.lng !== null ? `${st.lat},${st.lng}` : `${st.address}, ${st.city}`);
const prettyPhone = (p: string) => p.replace(/^\+359(\d{2,3})(\d{3})(\d{3})$/, '0$1 $2 $3');

export function Stores({ me, onMe }: { me: Me; onMe: (me: Me) => void }) {
  const { data, error, setError, refreshing, refresh } = useLoad(() => api.stores());
  const [query, setQuery] = useState('');
  const [here, setHere] = useState<Point | null>(null);
  const [locating, setLocating] = useState(false);

  const findNearest = async () => {
    setLocating(true);
    try {
      setHere(await locate());
      setQuery('');
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не успяхме да определим къде сте. Опитайте пак.');
    } finally {
      setLocating(false);
    }
  };

  const setFavorite = async (id: number | null) => {
    try {
      onMe(await api.setProfile({ favoriteStoreId: id }));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Нещо се обърка. Опитайте пак.');
    }
  };
  const q = fold(query);
  const found = (data?.stores ?? []).filter((x) => !q || fold(`${x.name} ${x.city} ${x.address}`).includes(q));
  // с известно място: от най-близкия; иначе любимият е най-отгоре
  const stores = here ? byDistance(found, here)
    : found.map((x) => ({ ...x, km: null as number | null })).sort((a, b) => Number(b.id === me.favoriteStoreId) - Number(a.id === me.favoriteStoreId));
  const nearestId = here && !q && stores.length > 0 && stores[0].km !== null ? stores[0].id : null;

  return (
    <ScrollView contentContainerStyle={s.screen} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <H1>Магазини</H1>
      <View style={{ gap: 6 }}>
        <Text nativeID="storeSearchLabel" style={st.label}>Търсете по град, квартал или адрес</Text>
        <TextInput testID="storeSearch" accessibilityLabelledBy="storeSearchLabel" style={st.input} value={query} onChangeText={setQuery}
          placeholder="Варна" placeholderTextColor={colors.muted} autoCorrect={false} returnKeyType="search" />
      </View>
      <View style={{ gap: 6 }}>
        <Button testID="nearest" title={here ? 'Обновете местоположението' : 'Намерете най-близкия магазин'} kind={here ? 'ghost' : 'primary'} busy={locating} onPress={findNearest} />
        <Text style={st.note}>Местоположението Ви остава в телефона: не го пращаме никъде.</Text>
      </View>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data && stores.length === 0 ? <P muted>Няма магазин, който да отговаря на „{query}“.</P> : null}
      {stores.map((x) => {
        const open = openNow(x.hours), favorite = x.id === me.favoriteStoreId;
        return (
          <View key={x.id} testID={`store-${x.id}`} style={[st.card, (favorite || x.id === nearestId) && { borderColor: colors.greenFlag, backgroundColor: colors.paper }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1, gap: 2 }}>
                {x.id === nearestId ? <Text testID="nearestBadge" style={st.nearest}>Най-близо до Вас</Text> : null}
                <Text style={st.name}>{x.name}</Text>
                <Text style={st.address}>{x.address}</Text>
                {x.km !== null ? <Text testID={`distance-${x.id}`} style={st.distance}>На {formatDistance(x.km)} от Вас по права линия</Text> : null}
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
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
  nearest: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.redText },
  distance: { fontFamily: fonts.semi, fontSize: 14, color: colors.greenDeep },
  star: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginTop: -8, marginRight: -8 },
  open: { fontFamily: fonts.bold, fontSize: 14 },
  hours: { fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  action: { flex: 1, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius },
  actionText: { fontFamily: fonts.bold, fontSize: 15, color: colors.greenDeep },
});
