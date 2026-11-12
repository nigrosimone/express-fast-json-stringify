'use strict';

const fastJsonStringify = require('fast-json-stringify');

const { kSerializer } = require('./install.js');

/** @import { RequestHandler } from 'express' */
/** @import { FastJsonSchemaOptions, Schema } from '../index.js' */
/** @import { Serializer } from './install.js' */

/**
 * Build a middleware that gives its route a serializer compiled from the schema.
 * The application needs `installFastJson(app)` once for `res.fastJson()` to exist.
 *
 * @param {Schema} schema the schema used to stringify values
 * @param {FastJsonSchemaOptions} [options] the fast-json-stringify options
 * @returns {RequestHandler}
 */
const fastJsonSchema = (schema, options) => {
  if (!schema || (typeof schema !== 'object' && typeof schema !== 'boolean')) {
    throw new TypeError(`express-fast-json-stringify: invalid schema`);
  }
  /** @type {Serializer} */
  const serialize = fastJsonStringify(schema, options);
  // One write on res.locals and a next(), nothing else on req or res: a framework that reads a
  // middleware's source to skip work, fulmine does, must be able to see this touches no header
  return (_req, res, next) => {
    res.locals[kSerializer] = serialize;
    next();
  };
};

module.exports = { fastJsonSchema };
