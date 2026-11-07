import { Router, type Request, type Response } from "express";
import {
  getCatalogActivities,
  getCatalogActivityById,
  getBooksCatalog
} from "./catalog-service.js";
import { getWeatherForecast } from "./weather-service.js";
import {
  CatalogActivitiesQuerySchema,
  BooksQuerySchema,
  WeatherQuerySchema,
  CatalogIdParamSchema
} from "./types.js";

const catalogRouter = Router();

catalogRouter.get("/activities", (request: Request, response: Response) => {
  const queryResult = CatalogActivitiesQuerySchema.safeParse(request.query);

  if (!queryResult.success) {
    response.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid catalog query parameters",
        details: queryResult.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message }))
      }
    });
    return;
  }

  const result = getCatalogActivities(queryResult.data);
  response.setHeader("Cache-Control", "public, max-age=3600");
  response.status(200).json(result);
});

catalogRouter.get("/activities/:id", (request: Request, response: Response) => {
  const rawId = request.params.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!CatalogIdParamSchema.safeParse(id).success) {
    response.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid catalog activity id",
        details: [{ field: "id", issue: "Must be 1-64 lowercase letters, digits or hyphens" }]
      }
    });
    return;
  }

  const item = getCatalogActivityById(id as string);

  if (!item) {
    response.status(404).json({
      error: {
        code: "RESOURCE_NOT_FOUND",
        message: "Catalog activity not found"
      }
    });
    return;
  }

  response.setHeader("Cache-Control", "public, max-age=3600");
  response.status(200).json(item);
});

catalogRouter.get("/books", async (request: Request, response: Response) => {
  const queryResult = BooksQuerySchema.safeParse(request.query);

  if (!queryResult.success) {
    response.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid book catalog query parameters",
        details: queryResult.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message }))
      }
    });
    return;
  }

  const { subject, limit } = queryResult.data;
  const { response: booksData, fromCache } = await getBooksCatalog(subject, limit);

  const isFallback = booksData.provenance.source === "local-fallback";
  response.setHeader("Cache-Control", isFallback ? "public, max-age=60" : "public, max-age=3600");
  response.setHeader("X-Cache", fromCache ? "HIT" : "MISS");
  response.status(200).json(booksData);
});

catalogRouter.get("/weather", async (request: Request, response: Response) => {
  const queryResult = WeatherQuerySchema.safeParse(request.query);

  if (!queryResult.success) {
    response.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid weather query parameters",
        details: queryResult.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message }))
      }
    });
    return;
  }

  const { latitude, longitude } = queryResult.data;
  const { response: weatherData, fromCache } = await getWeatherForecast(latitude, longitude);

  const isFallback = weatherData.condition === "unavailable";
  response.setHeader("Cache-Control", isFallback ? "public, max-age=60" : "public, max-age=3600");
  response.setHeader("X-Cache", fromCache ? "HIT" : "MISS");
  response.status(200).json(weatherData);
});

export { catalogRouter };
