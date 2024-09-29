import type { NextFunction, Request, Response } from 'express';
import fastJson, { Schema } from 'fast-json-stringify';

export type { Schema } from 'fast-json-stringify';

/**
 * Set the schema
 * @param {Schema} schema
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
export const fastJsonSchema = (schema: Schema) => {
  if (!schema) {
    throw new TypeError(`express-fast-json-stringify: invalid schema`);
  }
  const fjs = fastJson(schema);
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
