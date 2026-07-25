import type { NextFunction, Request, Response } from 'express';
import fastJson, { type Options, type Schema } from 'fast-json-stringify';

import { sendJson } from './send';

/**
 * The parts of an OpenAPI 3.x or Swagger 2.0 document this package reads.
 *
 * It is deliberately a plain document rather than an integration with a
 * specific library: every popular Express toolchain either consumes or produces
 * one of these, so `swagger-jsdoc`, `swagger-ui-express`, `tsoa`,
 * `express-openapi-validator` and a hand written file all work unchanged.
 */
export type OpenApiDocument = {
  readonly openapi?: string;
  readonly swagger?: string;
  readonly paths?: Readonly<Record<string, unknown>>;
  readonly components?: Readonly<Record<string, unknown>>;
  readonly definitions?: Readonly<Record<string, unknown>>;
};

export type OpenApiOptions = Omit<Options, 'mode'> & {
  /** Media type to read the schema from. Defaults to `application/json`. */
  readonly contentType?: string;
  /** Pin the OpenAPI path instead of deriving it from the matched route. */
  readonly path?: string;
  /** Pin the OpenAPI method instead of using the request method. */
  readonly method?: string;
  /**
   * Throw when the document describes no schema for a response, instead of
   * quietly falling back to `res.json()`.
   */
  readonly strict?: boolean;
};

/**
 * Translate an Express route pattern into the OpenAPI equivalent:
 * `/users/:id` becomes `/users/{id}`. Express parameter modifiers — a trailing
 * `?` or an inline `(regex)` — are dropped, since OpenAPI has no notion of them.
 */
export const toOpenApiPath = (path: string): string => path.replace(/:([A-Za-z0-9_]+)(\([^)]*\))?\??/g, '{$1}');

/**
 * Express answers a HEAD request with the GET handler, and documents rarely
 * describe a `head` operation, so fall back to `get`.
 */
const methodCandidates = (method: string): readonly string[] => (method === 'head' ? ['head', 'get'] : [method]);

/**
 * Response keys to try, most specific first. OpenAPI allows a wildcard range
 * (`2XX`) and a catch all (`default`) next to explicit codes.
 */
const statusCandidates = (status: number): readonly string[] => {
  const range = Math.floor(status / 100);
  return [String(status), `${range}XX`, `${range}xx`, 'default'];
};

type ResponseObject = {
  readonly content?: Readonly<Record<string, { readonly schema?: unknown } | undefined>>;
  /** Swagger 2.0 puts the schema straight on the response. */
  readonly schema?: unknown;
};

const findResponseSchema = (document: OpenApiDocument, path: string, method: string, status: number, contentType: string): unknown => {
  const operations = document.paths?.[path] as Readonly<Record<string, unknown>> | undefined;
  if (!operations) {
    return undefined;
  }

  for (const candidate of methodCandidates(method)) {
    const operation = operations[candidate] as { readonly responses?: Readonly<Record<string, ResponseObject | undefined>> } | undefined;
    const responses = operation?.responses;
    if (!responses) {
      continue;
    }
    for (const key of statusCandidates(status)) {
      const response = responses[key];
      if (!response) {
        continue;
      }
      // OpenAPI 3.x keys the schema by media type; Swagger 2.0 does not.
      const schema = response.content?.[contentType]?.schema ?? response.schema;
      if (schema) {
        return schema;
      }
    }
  }
  return undefined;
};

/**
 * fast-json-stringify resolves `$ref` as a JSON pointer against the root of the
 * schema it is given, so the document's shared schemas only have to be reachable
 * under the key the references already use — `components` for OpenAPI 3.x,
 * `definitions` for Swagger 2.0. No rewriting needed, and recursive references
 * keep working.
 */
const withSharedSchemas = (document: OpenApiDocument, schema: unknown): Schema => {
  const result = { ...(schema as Readonly<Record<string, unknown>>) };
  if (document.components && result.components === undefined) {
    result.components = document.components;
  }
  if (document.definitions && result.definitions === undefined) {
    result.definitions = document.definitions;
  }
  return result as unknown as Schema;
};

/**
 * Build a stringify middleware that takes its schemas from an OpenAPI or Swagger
 * document, so the contract you already publish is the one used to serialize.
 *
 * The operation is resolved per request from the matched Express route, and the
 * schema from the response status code, which means `res.status(201).fastJson()`
 * serializes with the `201` schema. Routes the document does not describe fall
 * back to `res.json()` unless `strict` is set.
 *
 * @param {OpenApiDocument} document The OpenAPI 3.x or Swagger 2.0 document
 * @param {OpenApiOptions} options The options to use (optional)
 *
 * Examples:
 * ```ts
 * import express from 'express';
 * import swaggerJsdoc from 'swagger-jsdoc';
 * import { fastJsonOpenApi } from 'express-fast-json-stringify';
 *
 * const app = express();
 * const document = swaggerJsdoc({ definition: { openapi: '3.1.0', info: { title: 'API', version: '1.0.0' } }, apis: ['./routes/*.ts'] });
 *
 * app.use(fastJsonOpenApi(document));
 *
 * app.get('/users/:id', (req, res, next) => {
 *   try {
 *     res.fastJson({ id: Number(req.params.id), firstName: 'Simone' });
 *   } catch (error) {
 *     next(error);
 *   }
 * });
 * ```
 */
export const fastJsonOpenApi = (document: OpenApiDocument, options: OpenApiOptions = {}) => {
  if (!document || typeof document !== 'object' || typeof document.paths !== 'object' || document.paths === null) {
    throw new TypeError(`express-fast-json-stringify: invalid OpenAPI document`);
  }

  const { contentType = 'application/json', path: pinnedPath, method: pinnedMethod, strict = false, ...fastJsonOptions } = options;

  // One compiled serializer per operation and status code. Misses are cached as
  // `null` so an undocumented route costs a single lookup.
  const serializers = new Map<string, ((body: any) => string) | null>();

  const routePath = (req: Request): string => pinnedPath ?? toOpenApiPath(`${req.baseUrl}${req.route?.path ?? req.path}`);

  const serializerFor = (req: Request, status: number): ((body: any) => string) | null => {
    const path = routePath(req);
    const method = (pinnedMethod ?? req.method).toLowerCase();
    const key = `${method} ${path} ${status}`;

    const cached = serializers.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const schema = findResponseSchema(document, path, method, status, contentType);
    const serializer = schema ? fastJson(withSharedSchemas(document, schema), fastJsonOptions) : null;
    serializers.set(key, serializer);
    return serializer;
  };

  return (req: Request, res: Response, next: NextFunction) => {
    /**
     * Send JSON response, serialized with the schema the document declares for
     * this route and status code.
     *
     * Examples:
     * ```ts
     * res.fastJson({ user: 'Simone Nigro' });
     * res.status(201).fastJson({ user: 'Simone Nigro' });
     * ```
     */
    res.fastJson = (body: any): Response => {
      const serializer = serializerFor(req, res.statusCode);
      if (!serializer) {
        if (strict) {
          throw new Error(`express-fast-json-stringify: no ${contentType} schema for ${req.method} ${routePath(req)} with status ${res.statusCode}`);
        }
        return res.json(body);
      }
      return sendJson(req, res, serializer(body));
    };
    next();
  };
};
