import type { Express, Request, Response } from 'express';

import { sendSerialized } from './send';

/** What the install needs of an application: the prototype its responses share. Fulmine has one too. */
export type Application = Pick<Express, 'response'>;

/** A compiled serializer, as fast-json-stringify builds it. */
export type Serializer = (body: any) => string;

/** Finds the serializer for a response from something other than the route, an OpenAPI document. */
export type SerializerResolver = (res: Response) => Serializer | null;

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
  readonly overrideJson?: boolean;
  /**
   * Called when an overridden `res.json()` could not use the fast path because
   * the serializer threw. The response falls back to the stock `res.json()`
   * either way; this is only so the mismatch is visible.
   */
  readonly onError?: OverrideErrorHandler;
  /**
   * Make `res.fastJson()` throw when no schema is known for the response,
   * instead of quietly falling back to `res.json()`. An overridden `res.json()`
   * always falls back.
   */
  readonly strict?: boolean;
};

/** Where `fastJsonSchema` leaves the serializer of the route, on `res.locals`. */
export const kSerializer: unique symbol = Symbol('express-fast-json-stringify');

type Locals = Record<typeof kSerializer, Serializer | undefined>;

type State = {
  readonly stockJson: (body: any) => Response;
  resolver: SerializerResolver | null;
  overrideJson: boolean;
  onError: OverrideErrorHandler | undefined;
  strict: boolean;
};

// one state per response prototype, which is one per app
const states = new WeakMap<object, State>();

const routeOf = (req: Request): string => `${req.baseUrl}${req.route?.path ?? req.path}`;

// the route's own serializer first, then what the document says
const pick = (state: State, res: Response, successOnly: boolean): Serializer | null => {
  const own = (res.locals as Locals)[kSerializer];
  if (own !== undefined && (!successOnly || (res.statusCode >= 200 && res.statusCode < 300))) {
    return own;
  }
  return state.resolver === null ? null : state.resolver(res);
};

const fastJsonMethod = (state: State) =>
  function installFastJson(this: Response, body: any): Response {
    const serialize = pick(state, this, false);
    if (serialize === null) {
      if (state.strict) {
        throw new Error(`express-fast-json-stringify: no schema for ${this.req.method} ${routeOf(this.req)}`);
      }
      return state.stockJson.call(this, body);
    }
    return sendSerialized(this, serialize(body));
  };

// The stock res.json() runs whenever the fast path does not apply: a setting that changes the
// bytes (json replacer, spaces, escape), no schema for this response, or a body the schema refuses
const jsonMethod = (state: State) =>
  function json(this: Response, body: any): Response {
    const app = this.app;
    if (!app.get('json replacer') && !app.get('json spaces') && !app.get('json escape')) {
      const serialize = pick(state, this, true);
      if (serialize !== null) {
        let out: string | undefined;
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
 * `fastJsonSchema` chooses the schema per route, `fastJsonOpenApi` per
 * operation from a document and calls this itself.
 *
 * @param {Application} app The application to extend
 * @param {FastJsonOptions} options The options to use (optional)
 *
 * Examples:
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
export const installFastJson = (app: Application, options: FastJsonOptions = {}): void => {
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

/** Registers where the document based serializers come from, see fastJsonOpenApi. */
export const setResolver = (app: Application, resolver: SerializerResolver): void => {
  (states.get(app.response) as State).resolver = resolver;
};

declare global {
  namespace Express {
    export interface Response {
      /**
       * Send JSON response, serialized with the schema in force for the route.
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
