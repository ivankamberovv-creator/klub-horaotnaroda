// Талон за изтриване: наградата стои отдолу, а отгоре има сребрист слой, който се трие с пръст (или с мишка).
// Слоят е мрежа от малки плочки; всяка плочка под пръста изчезва. Когато е изтрита половината, се открива всичко.
import { useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { colors, fonts, pointsWord, radius } from '../theme';

const COLS = 14, ROWS = 8, HEIGHT = 200;

export function ScratchSurface({ prize, onDone }: { prize: number; onDone: () => void }) {
  const [cleared, setCleared] = useState<boolean[]>(() => Array(COLS * ROWS).fill(false));
  const [open, setOpen] = useState(false);
  const size = useRef({ width: 1, height: HEIGHT });
  const state = useRef({ cleared, open });
  state.current = { cleared, open };

  const finish = () => {
    if (state.current.open) return;
    state.current.open = true;
    setOpen(true);
    onDone();
  };
  const scratchAt = (e: GestureResponderEvent) => {
    if (state.current.open) return;
    // допирът се мери спрямо прозрачния слой най-отгоре, който покрива целия талон
    const { locationX, locationY } = e.nativeEvent;
    const col = Math.floor((locationX / size.current.width) * COLS), row = Math.floor((locationY / size.current.height) * ROWS);
    const next = state.current.cleared.slice();
    let changed = false;
    // „пръстът“ е широк: трие плочката под себе си и съседните
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = row + dr, c = col + dc;
        if (r < 0 || r >= ROWS || c < 0 || c >= COLS || next[r * COLS + c]) continue;
        next[r * COLS + c] = true;
        changed = true;
      }
    }
    if (!changed) return;
    state.current.cleared = next;
    setCleared(next);
    if (next.filter(Boolean).length >= next.length * 0.5) finish();
  };
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: scratchAt,
    onPanResponderMove: scratchAt,
    onPanResponderTerminationRequest: () => false,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  return (
    <View style={{ gap: 12 }}>
      <View style={st.card} onLayout={(e) => { size.current = { width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height }; }}>
        <View style={st.prize} accessible accessibilityLabel={open ? `Печелите ${prize} ${pointsWord(prize)}` : 'Талон за изтриване'}>
          <Text style={st.prizeLabel}>Печелите</Text>
          <Text testID="scratchPrize" style={st.prizeNumber}>+{prize}</Text>
          <Text style={st.prizeUnit}>{pointsWord(prize)}</Text>
        </View>
        {!open ? (
          <>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {Array.from({ length: ROWS }, (_, r) => (
                <View key={r} style={{ flex: 1, flexDirection: 'row' }}>
                  {Array.from({ length: COLS }, (_, c) => (
                    <View key={c} style={{ flex: 1, backgroundColor: cleared[r * COLS + c] ? 'transparent' : (r + c) % 2 ? '#b7c2bc' : '#c3cdc7' }} />
                  ))}
                </View>
              ))}
            </View>
            {cleared.every((x) => !x) ? (
              <View pointerEvents="none" style={[StyleSheet.absoluteFill, st.hint]}><Text style={st.hintText}>Трийте тук с пръст</Text><Text style={st.hintSub}>или натиснете бутона отдолу</Text></View>
            ) : null}
            <View testID="scratchArea" {...responder.panHandlers} accessibilityLabel="Трийте тук, за да откриете наградата"
              style={[StyleSheet.absoluteFill, st.touch]} />
          </>
        ) : null}
      </View>
      {/* за който не му се трие: наградата се открива с едно докосване */}
      {!open ? <Button testID="scratchOpen" title="Изтрийте веднага" onPress={finish} /> : null}
    </View>
  );
}

const st = StyleSheet.create({
  card: { height: HEIGHT, borderRadius: radius, borderWidth: 2, borderColor: colors.ink, overflow: 'hidden', backgroundColor: colors.paper },
  prize: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  prizeLabel: { fontFamily: fonts.old, fontSize: 16, letterSpacing: 2.4, textTransform: 'uppercase', color: colors.redText },
  prizeNumber: { fontFamily: fonts.old, fontSize: 76, lineHeight: 80, color: colors.greenDeep },
  prizeUnit: { fontFamily: fonts.semi, fontSize: 16, color: colors.ink },
  hint: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  hintText: { fontFamily: fonts.bold, fontSize: 18, color: '#3d4a43' },
  hintSub: { fontFamily: fonts.body, fontSize: 14, color: '#3d4a43' },
  // на телефон в браузър страницата не трябва да се мести, докато се трие
  touch: { cursor: 'pointer', touchAction: 'none', userSelect: 'none' } as object,
});
