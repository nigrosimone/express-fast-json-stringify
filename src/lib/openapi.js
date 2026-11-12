'use strict';

const fastJsonStringify = require('fast-json-stringify');

const { installFastJson, setResolver } = require('./install.js');

/** @import { Application, OpenApiDocument, OpenApiOptions, Schema } from '../index.js' */
/** @import { Serializer } from './install.js' */

/**
 * A documented response. Swagger 2.0 puts the schema straight on it, OpenAPI 3.x under a media type.
 *
 * @typedef {object} ResponseObject
 * @property {Readonly<Record<string, { schema?: unknown } | undefined>>} [content]
 * @property {unknown} [schema]
 */

/**
 * Translate an Express route pattern into the OpenAPI equivalent:
 * `/users/:id` becomes `/users/{id}`. Express parameter modifiers, a trailing
 * `?` or an inline `(regex)`, are dropped, since OpenAPI has no notion of them.
 *
 * @param {string} path the Express route pattern
 * @returns {string}
 */
const toOpenApiPath = (path) => path.replace(/:([A-Za-z0-9_]+)(\([^)]*\))?\??/g, '{$1}');

/**
 * Express answers a HEAD request with the GET handler, and documents rarely
 * describe a `head` operation, so fall back to `get`.
 *
 * @param {string} method lowercase
 * @returns {readonly string[]}
 */
const methodCandidates = (method) => (method === 'head' ? ['head', 'get'] : [method]);

/**
 * Response keys to try, most specific first. OpenAPI allows a wildcard range
 * (`2XX`) and a catch all (`default`) next to explicit codes.
 *
 * @param {number} status
 * @returns {readonly string[]}
 */
const statusCandidates = (status) => {
  const range = Math.floor(status / 100);
  return [String(status), `${range}XX`, `${range}xx`, 'default'];
};

/**
 * The schema the document declares for one response, as it is written there.
 *
 * @param {OpenApiDocument} document
 * @param {string} path the OpenAPI path
 * @param {string} method lowercase
 * @param {number} status
 * @param {string} contentType
 * @returns {unknown} undefined when the document describes no such response
 */
const findResponseSchema = (document, path, method, status, contentType) => {
  const operations = /** @type {Readonly<Record<string, unknown>> | undefined} */ (document.paths?.[path]);
  if (!operations) {
    return undefined;
  }

  for (const candidate of methodCandidates(method)) {
    const operation = /** @type {{ responses?: Readonly<Record<string, ResponseObject | undefined>> } | undefined} */ (operations[candidate]);
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
 * under the key the references already use: `components` for OpenAPI 3.x,
 * `definitions` for Swagger 2.0. No rewriting needed, and recursive references
 * keep working.
 *
 * @param {OpenApiDocument} document
 * @param {unknown} schema
 * @returns {Schema}
 */
const withSharedSchemas = (document, schema) => {
  const result = { .../** @type {Readonly<Record<string, unknown>>} */ (schema) };
  if (document.components && result.components === undefined) {
    result.components = document.components;
  }
  if (document.definitions && result.definitions === undefined) {
    result.definitions = document.definitions;
  }
  return /** @type {Schema} */ (/** @type {unknown} */ (result));
};

/**
 * @param {OpenApiDocument} document
 * @returns {void}
 */
const validateDocument = (document) => {
  if (!document || typeof document !== 'object' || typeof document.paths !== 'object' || document.paths === null) {
    throw new TypeError(`express-fast-json-stringify: invalid OpenAPI document`);
  }
};

/**
 * The schema the document declares for one operation and status, with the
 * shared schemas attached so `$ref` resolves, ready for `fastJsonSchema`.
 *
 * @param {OpenApiDocument} document the OpenAPI 3.x or Swagger 2.0 document
 * @param {string} path the OpenAPI path, `/users/{id}`
 * @param {string} method the operation, `get`
 * @param {number} [status] the response status
 * @param {string} [contentType] the media type
 * @returns {Schema | undefined} undefined when the document describes no such response
 */
const openApiSchema = (document, path, method, status = 200, contentType = 'application/json') => {
  validateDocument(document);
  const schema = findResponseSchema(document, path, method.toLowerCase(), status, contentType);
  return schema ? withSharedSchemas(document, schema) : undefined;
};

/**
 * Serialize every documented response of an application from its OpenAPI or
 * Swagger document. Once per app, at setup: it calls `installFastJson(app)`
 * itself, and no middleware runs per request.
 *
 * @param {Application} app the application
 * @param {OpenApiDocument} document the OpenAPI 3.x or Swagger 2.0 document
 * @param {OpenApiOptions} [options]
 * @returns {void}
 */
const fastJsonOpenApi = (app, document, options = {}) => {
  validateDocument(document);
  const { contentType = 'application/json', overrideJson, onError, strict, ...fastJsonOptions } = options;
  installFastJson(app, { overrideJson, onError, strict });

  /**
   * @param {string} path the OpenAPI path
   * @param {string} method lowercase
   * @param {number} status
   * @returns {Serializer | null}
   */
  const compile = (path, method, status) => {
    const schema = findResponseSchema(document, path, method, status, contentType);
    return schema ? fastJsonStringify(withSharedSchemas(document, schema), fastJsonOptions) : null;
  };

  // One compiled serializer per route, mount and status, found from the route object the
  // framework already matched: no path is rebuilt per request. Misses are cached as `null`.
  // A router mounted twice answers under two mounts, so the mount is a key of its own.
  /** @type {WeakMap<object, Map<string, Map<number, Serializer | null>>>} */
  const byRoute = new WeakMap();
  // Answered from plain middleware, before any route matched: the request path is what names
  // the operation, and a string key is all there is.
  /** @type {Map<string, Serializer | null>} */
  const byPath = new Map();

  setResolver(app, (res) => {
    const req = res.req;
    const status = res.statusCode;
    const method = req.method.toLowerCase();
    /** @type {{ readonly path: string } | undefined} */
    const route = req.route;
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

module.exports = { toOpenApiPath, openApiSchema, fastJsonOpenApi };
