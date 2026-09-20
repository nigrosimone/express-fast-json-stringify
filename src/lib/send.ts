import type { Response } from 'express';

/**
 * Write an already serialized JSON payload the way `res.json()` does once the
 * body is a string: the type when the route set none, then `res.send()`, which
 * owns `Content-Length`, the `ETag`, conditional requests, `204`/`304` and
 * `HEAD` in Express and in the frameworks that stand in for it. Nothing is
 * reimplemented here, so nothing can drift.
 */
export const sendSerialized = (res: Response, json: string): Response => {
  if (!res.get('Content-Type')) {
    res.set('Content-Type', 'application/json; charset=utf-8');
  }
  return res.send(json);
};
