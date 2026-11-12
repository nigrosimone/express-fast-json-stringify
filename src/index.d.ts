import type { Express, Request, RequestHandler, Response } from 'express';
import type { Options, Schema } from 'fast-json-stringify';

export type { Options, Schema } from 'fast-json-stringify';

/** What the install needs of an application: the prototype its responses share. Fulmine has one too. */
export type Application = Pick<Express, 'response'>;

/** Notified when an overridden `res.json()` could not use the fast path. */
export type OverrideErrorHandler = (error: unknown, req: Request) => void;

export type FastJsonOptions = {
  /**
   * Also route `res.json()`, and `res.send(object)` which Express implements on
   * top of it, through the serializer in force.
   *
   * Off by default. A route's own schema describes the successful payload, so
   * under it only `2xx` responses take the fast path: an error body would
   * otherwise be rewritten into the wrong shape.
   */
  readonly overrideJson?: boolean | undefined;
  /**
   * Called when an overridden `res.json()` could not use the fast path because
   * the serializer threw. The response falls back to the stock `res.json()`
   * either way; this is only so the mismatch is visible.
   */
  readonly onError?: OverrideErrorHandler | undefined;
  /**
   * Make `res.fastJson()` throw when no schema is known for the response,
   * instead of quietly falling back to `res.json()`. An overridden `res.json()`
   * always falls back.
   */
  readonly strict?: boolean | undefined;
};

export type FastJsonSchemaOptions = Omit<Options, 'mode'>;

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

export type OpenApiOptions = FastJsonSchemaOptions &
  FastJsonOptions & {
    /** Media type to read the schema from. Defaults to `application/json`. */
    readonly contentType?: string;
  };

/**
 * Give an application `res.fastJson()`, and with `overrideJson` a `res.json()`
 * that serializes through the schema in force. Once per app, at setup: the
 * methods go on `app.response`, so a request pays nothing to have them.
 *
 * `fastJsonSchema` chooses the schema per route, `fastJsonOpenApi` per
 * operation from a document and calls this itself.
 *
 * @param app The application to extend
 * @param options The options to use (optional)
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { installFastJson, fastJsonSchema } from 'express-fast-json-stringify';
 *
 * const app = express();
 * installFastJson(app);
 *
 * app.get('/', fastJsonSchema(schema), (req, res) => {
 *   res.fastJson({ firstName: 'Simone', lastName: 'Nigro', age: 40 });
 * });
 * ```
 */
export declare function installFastJson(app: Application, options?: FastJsonOptions): void;

/**
 * Build a middleware that gives its route a serializer compiled from the schema.
 * The application needs `installFastJson(app)` once for `res.fastJson()` to exist.
 *
 * @param schema The schema used to stringify values
 * @param options The fast-json-stringify options (optional)
 * @see https://www.npmjs.com/package/fast-json-stringify
 *
 * @example
 * ```ts
 * import express from 'express';
 * import { installFastJson, fastJsonSchema, type Schema } from 'express-fast-json-stringify';
 *
 * const app = express();
 * installFastJson(app);
 *
 * const schema: Schema = {
 *   title: 'Example Schema',
 *   type: 'object',
 *   properties: {
 *     firstName: { type: 'string' },
 *     lastName: { type: 'string' },
 *     age: { type: 'integer' },
 *   },
 * };
 *
 * app.get('/', fastJsonSchema(schema), (req, res) => {
 *   res.fastJson({ firstName: 'Simone', lastName: 'Nigro', age: 40 });
 * });
 * ```
 */
export declare function fastJsonSchema(schema: Schema, options?: FastJsonSchemaOptions): RequestHandler;

/**
 * Translate an Express route pattern into the OpenAPI equivalent:
 * `/users/:id` becomes `/users/{id}`. Express parameter modifiers, a trailing
 * `?` or an inline `(regex)`, are dropped, since OpenAPI has no notion of them.
 */
export declare function toOpenApiPath(path: string): string;

/**
 * The schema the document declares for one operation and status, with the
 * shared schemas attached so `$ref` resolves, ready for `fastJsonSchema`. For
 * a route whose Express path does not match the document.
 *
 * @param document The OpenAPI 3.x or Swagger 2.0 document
 * @param path The OpenAPI path, `/users/{id}`
 * @param method The operation, `get`
 * @param status The response status, `200` when omitted
 * @param contentType The media type, `application/json` when omitted
 * @returns undefined when the document describes no such response
 *
 * @example
 * ```ts
 * app.get('/v2/people/:id', fastJsonSchema(openApiSchema(document, '/users/{id}', 'get')!), handler);
 * ```
 */
export declare function openApiSchema(document: OpenApiDocument, path: string, method: string, status?: number, contentType?: string): Schema | undefined;

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
 * @param app The application
 * @param document The OpenAPI 3.x or Swagger 2.0 document
 * @param options The options to use (optional)
 *
 * @example
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
 * app.get('/users/:id', (req, res) => {
 *   res.fastJson({ id: Number(req.params.id), firstName: 'Simone' });
 * });
 * ```
 */
export declare function fastJsonOpenApi(app: Application, document: OpenApiDocument, options?: OpenApiOptions): void;

declare global {
  namespace Express {
    interface Response {
      /**
       * Send JSON response, serialized with the schema in force for the route.
       *
       * @example
       * ```ts
       * res.fastJson({ user: 'Simone Nigro' });
       * res.status(200).fastJson({ user: 'Simone Nigro' });
       * ```
       */
      fastJson(body: any): this;
    }
  }
}
