import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { clearWeatherCacheForTest } from "../src/catalog/weather-service.js";

describe("GET /api/v1/catalog/weather", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    clearWeatherCacheForTest();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 400 for out-of-range latitude", async () => {
    const res = await request(app).get("/api/v1/catalog/weather?latitude=105");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns 400 for out-of-range longitude", async () => {
    const res = await request(app).get("/api/v1/catalog/weather?longitude=-200");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_INPUT");
  });

  it("returns weather hint with default coordinates (Iloilo City) and credits Open-Meteo", async () => {
    const mockPayload = {
      current: {
        temperature_2m: 28.5,
        precipitation: 0,
        weather_code: 1
      },
      hourly: {
        precipitation_probability: [10, 10, 5, 0, 0, 0],
        temperature_2m: [28, 29, 29, 28, 27, 26]
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPayload
    } as unknown as Response);

    const res = await request(app).get("/api/v1/catalog/weather");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=3600");
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(res.body.condition).toBe("cloudy");
    expect(res.body.rainChance).toBe(10);
    expect(res.body.heatFlag).toBe(false);
    expect(res.body.suggestedSetting).toBe("outdoor");
    expect(res.body.hint).toBe("Good weather for outdoor play · Outdoor ideas");
    expect(res.body.provenance).toEqual({
      source: "Open-Meteo",
      attribution: "Weather data by Open-Meteo.com",
      license: "CC BY 4.0"
    });
  });

  it("suggests indoor when rain probability is high", async () => {
    const mockPayload = {
      current: {
        temperature_2m: 26.0,
        precipitation: 1.5,
        weather_code: 61 // Rain
      },
      hourly: {
        precipitation_probability: [80, 85, 70, 60, 40, 20],
        temperature_2m: [26, 26, 25, 25, 24, 24]
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPayload
    } as unknown as Response);

    const res = await request(app).get("/api/v1/catalog/weather?latitude=10.72&longitude=122.56");
    expect(res.status).toBe(200);
    expect(res.body.condition).toBe("rain");
    expect(res.body.suggestedSetting).toBe("indoor");
    expect(res.body.hint).toBe("Rain likely this afternoon · Indoor ideas");
  });

  it("suggests indoor when heat is high (>= 35C)", async () => {
    const mockPayload = {
      current: {
        temperature_2m: 36.2,
        precipitation: 0,
        weather_code: 0
      },
      hourly: {
        precipitation_probability: [0, 0, 0, 0, 0, 0],
        temperature_2m: [36, 37, 36, 35, 33, 31]
      }
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPayload
    } as unknown as Response);

    const res = await request(app).get("/api/v1/catalog/weather?latitude=10.72&longitude=122.56");
    expect(res.status).toBe(200);
    expect(res.body.heatFlag).toBe(true);
    expect(res.body.suggestedSetting).toBe("indoor");
    expect(res.body.hint).toBe("High heat today · Indoor ideas");
  });

  it("serves subsequent requests from in-memory cache with X-Cache: HIT", async () => {
    const mockPayload = {
      current: {
        temperature_2m: 27.0,
        precipitation: 0,
        weather_code: 0
      },
      hourly: {
        precipitation_probability: [0, 0, 0, 0, 0, 0],
        temperature_2m: [27, 27, 27, 26, 25, 24]
      }
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockPayload
    } as unknown as Response);
    global.fetch = fetchSpy;

    const res1 = await request(app).get("/api/v1/catalog/weather?latitude=10.724&longitude=122.562");
    expect(res1.status).toBe(200);
    expect(res1.headers["x-cache"]).toBe("MISS");
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Same coordinates rounded to 2 decimal places (10.72, 122.56) hits cache
    const res2 = await request(app).get("/api/v1/catalog/weather?latitude=10.721&longitude=122.564");
    expect(res2.status).toBe(200);
    expect(res2.headers["x-cache"]).toBe("HIT");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns neutral fallback when upstream returns 500 error", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: true })
    } as unknown as Response);

    const res = await request(app).get("/api/v1/catalog/weather");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.body.condition).toBe("unavailable");
    expect(res.body.suggestedSetting).toBe("either");
    expect(res.body.hint).toBeNull();
    expect(res.body.provenance.source).toBe("Open-Meteo");
  });

  it("returns neutral fallback when upstream times out or rejects", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Timeout connecting to Open-Meteo"));

    const res = await request(app).get("/api/v1/catalog/weather");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("public, max-age=60");
    expect(res.body.condition).toBe("unavailable");
    expect(res.body.suggestedSetting).toBe("either");
    expect(res.body.hint).toBeNull();
  });
});
