// Баркодът на клиента, нарисуван с обикновени правоъгълници: работи на всеки телефон без допълнителни библиотеки.
import { View } from 'react-native';
import { ean13Bits, runs } from '../barcode';

const QUIET = 11; // празно поле от двете страни, за да го хваща четецът

export function Barcode({ code, width, height = 120 }: { code: string; width: number; height?: number }) {
  // цяла ширина на модула, за да няма размазани ивици
  const unit = Math.max(1, Math.floor(width / (95 + 2 * QUIET)));
  const bars = runs(ean13Bits(code));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Баркод ${code}`}
      style={{ backgroundColor: '#ffffff', paddingHorizontal: QUIET * unit, paddingVertical: 12, alignSelf: 'center' }}>
      <View style={{ flexDirection: 'row', height }}>
        {bars.map((len, i) => (
          <View key={i} style={{ width: len * unit, height, backgroundColor: i % 2 === 0 ? '#000000' : '#ffffff' }} />
        ))}
      </View>
    </View>
  );
}
