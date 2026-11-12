'use strict';

const { sendSerialized } = require('./send.js');

/** @import { Request, Response } from 'express' */
/** @import { Application, FastJsonOptions, OverrideErrorHandler } from '../index.js' */

/**
 * A compiled serializer, as fast-json-stringify builds it.
 *
 * @typedef {(body: any) => string} Serializer
 */

/**
 * Finds the serializer for a response from something other than the route, an OpenAPI document.
 *
 * @typedef {(res: Response) => Serializer | null} SerializerResolver
 */

/**
 * What one application has installed.
 *
 * @typedef {object} State
 * @property {(body: any) => Response} stockJson the `res.json()` the application had before
 * @property {SerializerResolver | null} resolver the document based serializers, see fastJsonOpenApi
 * @property {boolean} overrideJson
 * @property {OverrideErrorHandler | undefined} onError
 * @property {boolean} strict
 */

/**
 * Where `fastJsonSchema` leaves the serializer of the route, on `res.locals`. Typed `any` because
 * Express types `res.locals` with string keys, and a cast at the write would land in the
 * middleware source fulmine reads.
 *
 * @type {any}
 */
const kSerializer = Symbol('express-fast-json-stringify');

// one state per response prototype, which is one per app
/** @type {WeakMap<object, State>} */
const states = new WeakMap();

/**
 * The route as the application declared it, for an error message.
 *
 * @param {Request} req
 * @returns {string}
 */
const routeOf = (req) => `${req.baseUrl}${req.route?.path ?? req.path}`;

/**
 * The route's own serializer first, then what the document says.
 *
 * @param {State} state
 * @param {Response} res
 * @param {boolean} successOnly whether the route's own schema applies only to a `2xx`
 * @returns {Serializer | null}
 */
const pick = (state, res, successOnly) => {
  /** @type {Serializer | undefined} */
  const own = res.locals[kSerializer];
  if (own !== undefined && (!successOnly || (res.statusCode >= 200 && res.statusCode < 300))) {
    return own;
  }
  return state.resolver === null ? null : state.resolver(res);
};

/**
 * Build `res.fastJson()` for one application.
 *
 * @param {State} state
 * @returns {(this: Response, body: any) => Response}
 */
const fastJsonMethod = (state) =>
  function fastJson(body) {
    const serialize = pick(state, this, false);
    if (serialize === null) {
      if (state.strict) {
        throw new Error(`express-fast-json-stringify: no schema for ${this.req.method} ${routeOf(this.req)}`);
      }
      return state.stockJson.call(this, body);
    }
    return sendSerialized(this, serialize(body));
  };

/**
 * Build the overridden `res.json()` for one application. The stock one runs whenever the fast
 * path does not apply: a setting that changes the bytes (json replacer, spaces, escape), no
 * schema for this response, or a body the schema refuses.
 *
 * @param {State} state
 * @returns {(this: Response, body: any) => Response}
 */
const jsonMethod = (state) =>
  function json(body) {
    const app = this.app;
    if (!app.get('json replacer') && !app.get('json spaces') && !app.get('json escape')) {
      const serialize = pick(state, this, true);
      if (serialize !== null) {
        /** @type {string | undefined} */
        let out;
        try {
          out = serialize(body);
        } catch (error) {
          state.onError?.(error, this.req);
        }
        if (out !== undefined) {
          return sendSerialized(this, out);
        }
      }
    }
    return state.stockJson.call(this, body);
  };

/**
 * Give an application `res.fastJson()`, and with `overrideJson` a `res.json()`
 * that serializes through the schema in force. Once per app, at setup: the
 * methods go on `app.response`, so a request pays nothing to have them.
 *
 * @param {Application} app the application to extend
 * @param {FastJsonOptions} [options]
 * @returns {void}
 */
const installFastJson = (app, options = {}) => {
  const proto = app?.response;
  if (!proto || typeof proto.json !== 'function') {
    throw new TypeError('express-fast-json-stringify: an Express application is required');
  }
  let state = states.get(proto);
  if (state === undefined) {
    state = { stockJson: proto.json, resolver: null, overrideJson: false, onError: undefined, strict: false };
    states.set(proto, state);
    proto.fastJson = fastJsonMethod(state);
  }
  state.overrideJson = options.overrideJson === true;
  state.onError = options.onError;
  state.strict = options.strict === true;
  // the stock method is put back when the override is off, so nothing runs on res.json() that
  // was not there before, and a framework reading the prototype sees the method it knows
  proto.json = state.overrideJson ? jsonMethod(state) : state.stockJson;
};

/**
 * Registers where the document based serializers come from, see fastJsonOpenApi.
 *
 * @param {Application} app an application `installFastJson` already ran on
 * @param {SerializerResolver} resolver
 * @returns {void}
 */
const setResolver = (app, resolver) => {
  /** @type {State} */ (states.get(app.response)).resolver = resolver;
};

module.exports = { kSerializer, installFastJson, setResolver };
