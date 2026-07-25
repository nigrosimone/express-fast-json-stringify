import type { NextFunction, Request, Response } from 'express';
import fastJson, { type Options, type Schema } from 'fast-json-stringify';

import { type OverrideErrorHandler, overrideResJson } from './override';
import { sendJson } from './send';

export type { Schema, Options } from 'fast-json-stringify';

export type FastJsonSchemaOptions = Omit<Options, 'mode'> & {
  /**
   * Also route `res.json()` — and therefore `res.send(object)`, which Express
   * implements on top of it — through the compiled serializer.
   *
   * Off by default. Because a single schema describes the successful payload,
   * only `2xx` responses take the fast path: an error body would otherwise be
   * rewritten into the shape of the success schema.
   */
  readonly overrideJson?: boolean;
  /**
   * Called when an overridden `res.json()` could not use the fast path because
   * the serializer threw. The response falls back to the stock `res.json()`
   * either way; this is only so the mismatch is visible.
   */
  readonly onError?: OverrideErrorHandler;
};

/**
 * Build a stringify function using a schema of the documents that should be stringified
 * @param {Schema} schema The schema used to stringify values
 * @param {Options} options The options to use (optional)
 * @see https://www.npmjs.com/package/fast-json-stringify
 *
 * Examples:
 * ```ts
 * import express from 'express';
 * import { fastJsonSchema, Schema } from 'express-fast-json-stringify';
 *
 * const app = express();
 *
 * const schema: Schema = {
 *   title: 'Example Schema',
 *   type: 'object',
 *   properties: {
 *     firstName: {
 *       type: 'string',
 *     },
 *     lastName: {
 *       type: 'string',
 *     },
 *     age: {
 *       type: 'integer',
 *     }
 *   },
 * };
 *
 * app.get('/', fastJsonSchema(schema), (req, res, next) => {
 *  try {
 *    const data = {
 *      firstName: "Simone",
 *      lastName: "Nigro",
 *      age: 40
 *    };
 *    res.fastJson(data);
 *  } catch (error) {
 *    next(error);
 *  }
 * });
 * ```
 */
export const fastJsonSchema = (schema: Schema, options?: FastJsonSchemaOptions) => {
  if (!schema || (typeof schema !== 'object' && typeof schema !== 'boolean')) {
    throw new TypeError(`express-fast-json-stringify: invalid schema`);
  }
  const { overrideJson = false, onError, ...fastJsonOptions } = options ?? {};
  const fjs = fastJson(schema, fastJsonOptions);
  return (req: Request, res: Response, next: NextFunction) => {
    /**
     * Send JSON response.
     *
     * Examples:
     * ```ts
     * res.fastJson({ user: 'Simone Nigro' });
     * res.status(200).fastJson({ user: 'Simone Nigro' });
     * ```
     */
    res.fastJson = (body: any): Response => sendJson(req, res, fjs(body));

    if (overrideJson) {
      // A single schema describes the successful payload, so applying it to an
      // error body would rewrite it into the wrong shape. Only 2xx responses
      // take the fast path; everything else keeps the stock res.json().
      overrideResJson(req, res, (status) => (status >= 200 && status < 300 ? fjs : null), onError);
    }

    next();
  };
};

declare global {
  namespace Express {
    export interface Response {
      /**
       * Send JSON response.
       *
       * Examples:
       * ```ts
       * res.fastJson({ user: 'Simone Nigro' });
       * res.status(200).fastJson({ user: 'Simone Nigro' });
       * ```
       */
      fastJson: (body: any) => Response;
    }
  }
}
