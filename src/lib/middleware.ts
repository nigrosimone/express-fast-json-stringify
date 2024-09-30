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
 * import { fastJsonSchemas, Schema } from 'express-fast-json-stringify';
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
export const fastJsonSchema = (schema: Schema, options?: Options) => {
  if (!schema) {
    throw new TypeError(`express-fast-json-stringify: invalid schema`);
  }
  const fjs = fastJson(schema, options);
  return (_req: Request, res: Response, next: NextFunction) => {
    /**
     * Send JSON response.
     *
     * Examples:
     * ```ts
     * res.fastJson({ user: 'tj' });
     * res.status(200).fastJson({ user: 'tj' });
     * ```
     */
    res.fastJson = (data: any): Response => {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/json');
      }
      return res.send(fjs(data));
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
       * res.fastJson({ user: 'tj' });
       * res.status(200).fastJson({ user: 'tj' });
       * ```
       */
      fastJson: (data: any) => Response;
    }
  }
}
