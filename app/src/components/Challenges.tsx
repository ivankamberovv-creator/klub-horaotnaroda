// Мисиите с напредъка на клиента: „2 от 3 покупки“, лента и наградата.
import { StyleSheet, Text, View } from 'react-native';
import { Challenge } from '../api';
import { Icon } from './Icon';
import { colors, euro, fonts, radius } from '../theme';

const progressText = (c: Challenge) => (c.kind === 'purchases' ? `${c.progress} от ${c.goal} покупки` : `${euro(c.progress)} от ${euro(c.goal)}`);
function daysLeft(endsAt: string | null, now = new Date()) {
  if (!endsAt) return '';
  const days = Math.ceil((new Date(endsAt).getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
  return days <= 1 ? 'Последен ден' : `Остават ${days} дни`;
}

export function Challenges({ challenges }: { challenges: Challenge[] }) {
  return (
    <View style={{ gap: 10 }}>
      {challenges.map((c) => {
        const part = Math.max(0.03, Math.min(1, c.progress / c.goal));
        return (
          <View key={c.id} testID={`challenge-${c.id}`} style={[st.card, c.done && { borderColor: colors.greenFlag, backgroundColor: colors.paper }]}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={st.title}>{c.title}</Text>
                {c.description ? <Text style={st.sub}>{c.description}</Text> : null}
              </View>
              <View style={st.reward}><Text style={st.rewardText}>+{c.reward_points}</Text><Text style={st.rewardUnit}>точки</Text></View>
            </View>
            <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: c.goal, now: c.progress }} style={st.track}>
              <View style={[st.fill, { width: `${Math.round(part * 100)}%` }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              {c.done ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={18} color={colors.greenDeep} /><Text style={st.done}>Изпълнена</Text>
                </View>
              ) : <Text style={st.progress}>{progressText(c)}</Text>}
              {!c.done && c.ends_at ? <Text style={st.sub}>{daysLeft(c.ends_at)}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius, padding: 16, gap: 10, backgroundColor: colors.white },
  title: { fontFamily: fonts.old, fontSize: 20, lineHeight: 23, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  reward: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius, backgroundColor: colors.greenDeep },
  rewardText: { fontFamily: fonts.bold, fontSize: 18, color: colors.white },
  rewardUnit: { fontFamily: fonts.body, fontSize: 11, color: colors.onGreenSoft },
  track: { height: 10, borderRadius: 5, backgroundColor: colors.disabledBg, overflow: 'hidden' },
  fill: { height: 10, borderRadius: 5, backgroundColor: colors.green },
  progress: { fontFamily: fonts.semi, fontSize: 14, color: colors.ink },
  done: { fontFamily: fonts.bold, fontSize: 14, color: colors.greenDeep },
});
