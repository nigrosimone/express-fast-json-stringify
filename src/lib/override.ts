import type { Request, Response } from 'express';

import { sendJson } from './send';

/** Resolves the serializer to use for a response status, or `null` for none. */
export type SerializerResolver = (status: number) => ((body: any) => string) | null;

/** Notified when an overridden `res.json()` could not use the fast path. */
export type OverrideErrorHandler = (error: unknown, req: Request) => void;

/**
 * Settings that change the bytes `res.json()` writes. A compiled serializer
 * cannot reproduce any of them, so the fast path has to step aside when one is
 * configured rather than silently change the output.
 *
 * Each one is tested on its own, and by truthiness, exactly as `res.json()`
 * tests it: a falsy `json spaces` (`0` is a normal way to spell "compact
 * output") changes nothing, so it must neither cost the fast path nor hide the
 * settings after it, which is what folding the three together with `??` did.
 */
const hasCustomJsonSettings = (res: Response): boolean => {
  const app = res.app;
  if (!app) {
    return false;
  }
  return Boolean(app.get('json replacer')) || Boolean(app.get('json spaces')) || Boolean(app.get('json escape'));
};

/**
 * Route `res.json()` through a compiled serializer when one is available.
 *
 * Only `res.json` is replaced: Express implements `res.send(object)` by calling
 * `res.json(object)`, so both entry points are covered by the single hook.
 *
 * The override is deliberately incapable of breaking a route. Whenever the fast
 * path does not apply — no schema for this response, custom JSON settings, or a
 * serializer that throws on the given body — the original `res.json()` runs and
 * the response is exactly what it was before.
 */
export const overrideResJson = (req: Request, res: Response, resolve: SerializerResolver, onError?: OverrideErrorHandler): void => {
  const original = res.json.bind(res);

  res.json = (body: any): Response => {
    if (!hasCustomJsonSettings(res)) {
      const serialize = resolve(res.statusCode);
      if (serialize) {
        try {
          return sendJson(req, res, serialize(body));
        } catch (error) {
          // A body that does not fit the schema must not turn into a failed
          // request: report it, then fall through to the stock res.json().
          onError?.(error, req);
        }
      }
    }
    return original(body);
  };
};
