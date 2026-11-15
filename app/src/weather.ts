// Времето навън, както идва от сървъра, и думите за него.
import { colors } from './theme';

/** sun, clouds, rain, fog и snow са видовете, по които има оферти; moon е ясна нощ и само се показва */
export type WeatherKind = 'sun' | 'clouds' | 'rain' | 'fog' | 'snow' | 'moon';
export type Weather = {
  kind: WeatherKind; isDay: boolean; temp: number | null;
  /** градът, за който е времето; own казва дали клиентът сам го е избрал (любимият му магазин) */
  city: string; own: boolean;
  /** примерно време (в демото), не истинското навън */
  sample?: boolean;
};

export const weatherLabel: Record<WeatherKind, string> = {
  sun: 'Слънчево', clouds: 'Облачно', rain: 'Вали дъжд', fog: 'Мъгла', snow: 'Вали сняг', moon: 'Ясна нощ',
};
/** Цветът на небето зад картинката; нощем е тъмно каквото и да е времето */
export const skyColor = (kind: WeatherKind, isDay = true) => (!isDay || kind === 'moon' ? colors.skyNight
  : kind === 'sun' ? colors.skySun : kind === 'clouds' ? colors.skyClouds : kind === 'rain' ? colors.skyRain : kind === 'fog' ? colors.skyFog : colors.skySnow);
