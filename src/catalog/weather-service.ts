import type { WeatherResponse } from "./types.js";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const CACHE_MAX_ENTRIES = 100;

interface CacheEntry {
  data: WeatherResponse;
  timestamp: number;
}

const weatherCache = new Map<string, CacheEntry>();

export function clearWeatherCacheForTest(): void {
  weatherCache.clear();
}

export function roundCoordinate(val: number): number {
  return Math.round(val * 100) / 100;
}

export const NEUTRAL_WEATHER_FALLBACK: WeatherResponse = {
  condition: "unavailable",
  rainChance: 0,
  heatFlag: false,
  suggestedSetting: "either",
  hint: null,
  provenance: {
    source: "Open-Meteo",
    attribution: "Weather data by Open-Meteo.com",
    license: "CC BY 4.0"
  }
};

function parseWmoCondition(code?: number): string {
  if (code === undefined || code === null) return "clear";
  if (code === 0) return "clear";
  if ([1, 2, 3].includes(code)) return "cloudy";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "rain";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snow";
  if ([80, 81, 82].includes(code)) return "showers";
  if ([95, 96, 99].includes(code)) return "thunderstorm";
  return "partly cloudy";
}

export async function getWeatherForecast(
  latitude = 10.72,
  longitude = 122.56,
  fetchTimeoutMs = 3000
): Promise<{ response: WeatherResponse; fromCache: boolean }> {
  const roundedLat = roundCoordinate(latitude);
  const roundedLon = roundCoordinate(longitude);
  const cacheKey = `${roundedLat.toFixed(2)}:${roundedLon.toFixed(2)}`;
  const now = Date.now();

  const cached = weatherCache.get(cacheKey);
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return { response: cached.data, fromCache: true };
  }

  try {
    const upstreamUrl = `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLon}&current=temperature_2m,precipitation,weather_code&hourly=precipitation_probability,temperature_2m&forecast_days=1&timezone=Asia%2FManila`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), fetchTimeoutMs);

    const res = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "LittleSteps/0.1.0 (academic development)" }
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Open-Meteo returned status ${res.status}`);
    }

    const data = (await res.json()) as {
      current?: {
        temperature_2m?: number;
        precipitation?: number;
        weather_code?: number;
      };
      hourly?: {
        precipitation_probability?: number[];
        temperature_2m?: number[];
      };
    };

    const currentTemp = data.current?.temperature_2m;
    const currentPrecip = data.current?.precipitation ?? 0;
    const weatherCode = data.current?.weather_code;
    const condition = parseWmoCondition(weatherCode);

    // Calculate rain chance from current or upcoming hours
    const hourlyProbs = data.hourly?.precipitation_probability ?? [];
    const maxUpcomingProb = hourlyProbs.slice(0, 6).reduce((max, val) => Math.max(max, val ?? 0), 0);
    const rainChance = Math.min(100, Math.max(currentPrecip > 0 ? 80 : 0, maxUpcomingProb));

    const heatFlag = typeof currentTemp === "number" && currentTemp >= 35;

    let suggestedSetting: "indoor" | "outdoor" | "either" = "either";
    let hint: string | null = null;

    if (rainChance >= 50 || ["rain", "showers", "thunderstorm", "drizzle"].includes(condition)) {
      suggestedSetting = "indoor";
      hint = "Rain likely this afternoon · Indoor ideas";
    } else if (heatFlag) {
      suggestedSetting = "indoor";
      hint = "High heat today · Indoor ideas";
    } else if (rainChance <= 20 && typeof currentTemp === "number" && currentTemp >= 20 && currentTemp <= 30) {
      suggestedSetting = "outdoor";
      hint = "Good weather for outdoor play · Outdoor ideas";
    }

    const result: WeatherResponse = {
      condition,
      rainChance,
      heatFlag,
      suggestedSetting,
      hint,
      provenance: {
        source: "Open-Meteo",
        attribution: "Weather data by Open-Meteo.com",
        license: "CC BY 4.0"
      }
    };

    // Cache result
    if (!weatherCache.has(cacheKey) && weatherCache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = weatherCache.keys().next().value;
      if (oldestKey !== undefined) weatherCache.delete(oldestKey);
    }
    weatherCache.set(cacheKey, { data: result, timestamp: now });

    return { response: result, fromCache: false };
  } catch {
    // Neutral fallback on error, timeout, or bad payload
    return { response: NEUTRAL_WEATHER_FALLBACK, fromCache: false };
  }
}
