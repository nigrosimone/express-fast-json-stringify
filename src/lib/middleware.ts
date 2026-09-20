import type { NextFunction, Request, Response } from 'express';
import fastJsonStringify, { type Options, type Schema } from 'fast-json-stringify';

import { kSerializer, type Serializer } from './install';

export type { Schema, Options } from 'fast-json-stringify';

export type FastJsonSchemaOptions = Omit<Options, 'mode'>;

/**
 * Build a middleware that gives its route a serializer compiled from the schema.
 * The application needs `installFastJson(app)` once for `res.fastJson()` to exist.
 *
 * @param {Schema} schema The schema used to stringify values
 * @param {FastJsonSchemaOptions} options The fast-json-stringify options (optional)
 * @see https://www.npmjs.com/package/fast-json-stringify
 *
 * Examples:
 * ```ts
 * import express from 'express';
 * import { installFastJson, fastJsonSchema, Schema } from 'express-fast-json-stringify';
 *
 * const app = express();
 * installFastJson(app);
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
  const serialize: Serializer = fastJsonStringify(schema, options);
  // One write on res.locals and a next(), nothing else on req or res: a framework that reads a
  // middleware's source to skip work, fulmine does, must be able to see this touches no header
  return (_req: Request, res: Response, next: NextFunction): void => {
    (res.locals as Record<typeof kSerializer, Serializer>)[kSerializer] = serialize;
    next();
  };
};
