import { Router, type Request, type Response } from "express";
import {
  getCatalogActivities,
  getCatalogActivityById,
  getBooksCatalog
} from "./catalog-service.js";
import {
  CatalogActivitiesQuerySchema,
  BooksQuerySchema
} from "./types.js";

const catalogRouter = Router();

catalogRouter.get("/activities", (request: Request, response: Response) => {
  const queryResult = CatalogActivitiesQuerySchema.safeParse(request.query);

  if (!queryResult.success) {
    response.status(400).json({
      error: {
        code: "INVALID_INPUT",
        message: "Invalid catalog query parameters",
        details: queryResult.error.issues
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
  const item = id ? getCatalogActivityById(id) : undefined;

  if (!item) {
    response.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: `Catalog activity '${id}' was not found`
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
        details: queryResult.error.issues
      }
    });
    return;
  }

  const { subject, limit } = queryResult.data;
  const { response: booksData, fromCache } = await getBooksCatalog(subject, limit);

  response.setHeader("Cache-Control", "public, max-age=3600");
  response.setHeader("X-Cache", fromCache ? "HIT" : "MISS");
  response.status(200).json(booksData);
});

export { catalogRouter };
