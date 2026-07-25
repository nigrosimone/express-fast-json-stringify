import type { NextFunction, Request, Response } from 'express';
import fastJson, { type Options, type Schema } from 'fast-json-stringify';

export type { Schema, Options } from 'fast-json-stringify';

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
export const fastJsonSchema = (schema: Schema, options?: Omit<Options, 'mode'>) => {
  if (!schema || (typeof schema !== 'object' && typeof schema !== 'boolean')) {
    throw new TypeError(`express-fast-json-stringify: invalid schema`);
  }
  const fjs = fastJson(schema, options);
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
    res.fastJson = (body: any): Response => {
      let payload = fjs(body);

      // Do not clobber a content type the route set on purpose (eg. res.type('application/vnd.api+json')).
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
      }

      // Mirror res.send(): honour the app `etag` setting so that swapping
      // res.json() for res.fastJson() keeps conditional requests working.
      const etagFn = res.app?.get('etag fn') as ((payload: string, encoding: string) => string | undefined) | undefined;
      if (typeof etagFn === 'function' && !res.getHeader('ETag')) {
        const etag = etagFn(payload, 'utf-8');
        if (etag) {
          res.setHeader('ETag', etag);
        }
      }

      if (req.fresh) {
        res.statusCode = 304;
      }

      // 204 No Content and 304 Not Modified must not carry a body, nor describe one.
      if (res.statusCode === 204 || res.statusCode === 304) {
        res.removeHeader('Content-Type');
        res.removeHeader('Content-Length');
        res.removeHeader('Transfer-Encoding');
        payload = '';
      } else {
        // Without this the response falls back to chunked encoding, and HEAD
        // requests answer with no length at all.
        res.setHeader('Content-Length', Buffer.byteLength(payload));
      }

      return res.end(payload);
    };
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
