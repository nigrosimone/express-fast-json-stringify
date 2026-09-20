import type { Response } from 'express';
import fastJsonStringify, { type Options, type Schema } from 'fast-json-stringify';

import { type Application, type FastJsonOptions, installFastJson, type Serializer, setResolver } from './install';

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

export type OpenApiOptions = Omit<Options, 'mode'> &
  FastJsonOptions & {
    /** Media type to read the schema from. Defaults to `application/json`. */
    readonly contentType?: string;
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

const validateDocument = (document: OpenApiDocument): void => {
  if (!document || typeof document !== 'object' || typeof document.paths !== 'object' || document.paths === null) {
    throw new TypeError(`express-fast-json-stringify: invalid OpenAPI document`);
  }
};

/**
 * The schema the document declares for one operation and status, with the
 * shared schemas attached so `$ref` resolves, ready for `fastJsonSchema`. For
 * a route whose Express path does not match the document.
 *
 * @param {OpenApiDocument} document The OpenAPI 3.x or Swagger 2.0 document
 * @param {string} path The OpenAPI path, `/users/{id}`
 * @param {string} method The operation, `get`
 * @param {number} status The response status, `200` when omitted
 * @param {string} contentType The media type, `application/json` when omitted
 * @returns {Schema | undefined} undefined when the document describes no such response
 *
 * Examples:
 * ```ts
 * app.get('/v2/people/:id', fastJsonSchema(openApiSchema(document, '/users/{id}', 'get')!), handler);
 * ```
 */
export const openApiSchema = (document: OpenApiDocument, path: string, method: string, status = 200, contentType = 'application/json'): Schema | undefined => {
  validateDocument(document);
  const schema = findResponseSchema(document, path, method.toLowerCase(), status, contentType);
  return schema ? withSharedSchemas(document, schema) : undefined;
};

/**
 * Serialize every documented response of an application from its OpenAPI or
 * Swagger document, so the contract you already publish is the one used to
 * serialize. Once per app, at setup: it calls `installFastJson(app)` itself, and no
 * middleware runs per request.
 *
 * The operation is resolved from the matched Express route, and the schema
 * from the response status code, which means `res.status(201).fastJson()`
 * serializes with the `201` schema. Routes the document does not describe fall
 * back to `res.json()` unless `strict` is set.
 *
 * @param {Application} app The application
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
 * fastJsonOpenApi(app, document);
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
export const fastJsonOpenApi = (app: Application, document: OpenApiDocument, options: OpenApiOptions = {}): void => {
  validateDocument(document);
  const { contentType = 'application/json', overrideJson, onError, strict, ...fastJsonOptions } = options;
  installFastJson(app, { overrideJson, onError, strict });

  const compile = (path: string, method: string, status: number): Serializer | null => {
    const schema = findResponseSchema(document, path, method, status, contentType);
    return schema ? fastJsonStringify(withSharedSchemas(document, schema), fastJsonOptions) : null;
  };

  // One compiled serializer per route, mount and status, found from the route object the
  // framework already matched: no path is rebuilt per request. Misses are cached as `null`.
  // A router mounted twice answers under two mounts, so the mount is a key of its own.
  const byRoute = new WeakMap<object, Map<string, Map<number, Serializer | null>>>();
  // Answered from plain middleware, before any route matched: the request path is what names
  // the operation, and a string key is all there is.
  const byPath = new Map<string, Serializer | null>();

  setResolver(app, (res: Response): Serializer | null => {
    const req = res.req;
    const status = res.statusCode;
    const method = req.method.toLowerCase();
    const route: { readonly path: string } | undefined = req.route;
    if (route === undefined) {
      const key = `${method} ${req.baseUrl}${req.path} ${status}`;
      let serialize = byPath.get(key);
      if (serialize === undefined) {
        serialize = compile(toOpenApiPath(`${req.baseUrl}${req.path}`), method, status);
        byPath.set(key, serialize);
      }
      return serialize;
    }
    let byMount = byRoute.get(route);
    if (byMount === undefined) {
      byMount = new Map();
      byRoute.set(route, byMount);
    }
    const baseUrl = req.baseUrl;
    let byStatus = byMount.get(baseUrl);
    if (byStatus === undefined) {
      byStatus = new Map();
      byMount.set(baseUrl, byStatus);
    }
    let serialize = byStatus.get(status);
    if (serialize === undefined) {
      serialize = compile(toOpenApiPath(`${baseUrl}${route.path}`), method, status);
      byStatus.set(status, serialize);
    }
    return serialize;
  });
};
