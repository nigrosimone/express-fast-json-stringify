import type { Request, Response } from 'express';

/**
 * Write an already serialized JSON payload with the same HTTP semantics as
 * `res.json()`: charset, `Content-Length`, `ETag`, conditional requests and the
 * empty body rules for `204`/`304`.
 *
 * Every middleware in this package goes through here, so they cannot drift
 * apart from each other or from Express.
 */
export const sendJson = (req: Request, res: Response, serialized: string): Response => {
  let payload = serialized;

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
