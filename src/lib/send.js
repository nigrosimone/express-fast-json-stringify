'use strict';

/** @import { Response } from 'express' */

/**
 * Write an already serialized JSON payload the way `res.json()` does once the
 * body is a string: the type when the route set none, then `res.send()`, which
 * owns `Content-Length`, the `ETag`, conditional requests, `204`/`304` and
 * `HEAD` in Express and in the frameworks that stand in for it. Nothing is
 * reimplemented here, so nothing can drift.
 *
 * @param {Response} res the response to write
 * @param {string} json the payload, already serialized
 * @returns {Response}
 */
const sendSerialized = (res, json) => {
  if (!res.get('Content-Type')) {
    res.set('Content-Type', 'application/json; charset=utf-8');
  }
  return res.send(json);
};

module.exports = { sendSerialized };
