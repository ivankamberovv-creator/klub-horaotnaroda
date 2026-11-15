// Мисии: задачи със срок, които носят точки, когато се изпълнят.
import { RefreshControl, ScrollView, View } from 'react-native';
import { api } from '../api';
import { Challenges } from '../components/Challenges';
import { ErrorText, H1, Loading, P, s } from '../components/ui';
import { useLoad } from '../useLoad';
import { colors } from '../theme';

export function Missions() {
  const { data, error, refreshing, refresh } = useLoad(() => api.challenges());
  return (
    <ScrollView contentContainerStyle={s.screen} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.green} />}>
      <View style={{ gap: 6 }}>
        <H1>Мисии</H1>
        <P muted>Изпълнете мисия и точките идват сами след покупката, с която я завършите.</P>
      </View>
      <ErrorText>{error}</ErrorText>
      {!data && !error ? <Loading /> : null}
      {data && data.challenges.length === 0 ? <P muted>В момента няма мисии. Проверете пак скоро.</P> : null}
      {data ? <Challenges challenges={data.challenges} /> : null}
    </ScrollView>
  );
}
