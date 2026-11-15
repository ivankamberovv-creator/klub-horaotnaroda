// Новини от магазините. Отварянето на раздела ги отбелязва като прочетени.
import { useEffect } from 'react';
import { Image, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, mediaUrl } from '../api';
import { ErrorText, H1, Loading, P, s } from '../components/ui';
import { useLoad } from '../useLoad';
import { colors, day, fonts, radius } from '../theme';

export function News({ onSeen }: { onSeen: () => void }) {
  const { data, error, refreshing, refresh } = useLoad(() => api.news());
  // щом новините са дошли, броячът на непрочетените се нулира
  useEffect(() => { if (data) onSeen(); }, [data, onSeen]);
  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <H1>Новини</H1>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data && data.news.length === 0 ? <P muted>Още няма новини.</P> : null}
      {data?.news.map((n) => (
        <View key={n.id} testID={`news-${n.id}`} style={st.card}>
          {n.image_url ? <Image source={{ uri: mediaUrl(n.image_url) }} style={st.image} resizeMode="cover" accessibilityIgnoresInvertColors /> : null}
          <View style={{ padding: 16, gap: 6 }}>
            <Text style={st.date}>{day(n.published_at)}</Text>
            <Text style={st.title}>{n.title}</Text>
            {n.body ? <P style={{ fontSize: 15 }}>{n.body}</P> : null}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius, overflow: 'hidden', backgroundColor: colors.white },
  image: { width: '100%', height: 160, backgroundColor: colors.paper },
  date: { fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.redText },
  title: { fontFamily: fonts.old, fontSize: 22, lineHeight: 25, color: colors.ink },
});
