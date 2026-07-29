import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { fastJsonOpenApi, fastJsonSchema, type OpenApiDocument, type Schema } from './index';

const record = { id: 7, firstName: 'Simoné', lastName: 'Nigrò', secret: 'never serialized' };
const filtered = { id: 7, firstName: 'Simoné', lastName: 'Nigrò' };
/** Payload whose bytes differ depending on the `json escape` app setting. */
const unsafe = { id: 7, firstName: '<script>alert(1)</script>', lastName: 'Nigrò & Co' };

const userSchema: Schema = {
  type: 'object',
  properties: { id: { type: 'integer' }, firstName: { type: 'string' }, lastName: { type: 'string' } },
  additionalProperties: false,
};

const document: OpenApiDocument = {
  openapi: '3.1.0',
  paths: {
    '/users/{id}': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '404': { content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } }, additionalProperties: false } } } },
        },
      },
    },
    '/strict-number': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false } } } },
        },
      },
    },
  },
  components: { schemas: { User: userSchema } },
};

describe('overrideJson with an OpenAPI document', () => {
  it('is off by default, so res.json keeps the stock behavior', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document));
    app.get('/users/:id', (_req, res) => res.json(record));

    expect((await request(app).get('/users/7')).body).toEqual(record);
  });

  it('serializes res.json through the schema when enabled', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.json(record));

    const res = await request(app).get('/users/7');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(filtered);
    expect(res.body).not.toHaveProperty('secret');
  });

  // Express implements res.send(object) by calling res.json(object), so the
  // single hook covers both entry points.
  it('also covers res.send(object)', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.send(record));

    expect((await request(app).get('/users/7')).body).toEqual(filtered);
  });

  it('leaves res.send of a string, buffer or null alone', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/text', (_req, res) => res.send('plain'));
    app.get('/buffer', (_req, res) => res.send(Buffer.from('bytes')));
    app.get('/null', (_req, res) => res.send(null));

    expect((await request(app).get('/text')).text).toBe('plain');
    expect((await request(app).get('/buffer')).body.toString()).toBe('bytes');
    expect((await request(app).get('/null')).text).toBe('');
  });

  it('picks the schema of the response status code', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.status(404).json({ message: 'gone', secret: 'x' }));

    const res = await request(app).get('/users/9');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'gone' });
  });

  it('leaves undocumented routes untouched', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/health', (_req, res) => res.json({ status: 'ok', extra: true }));

    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', extra: true });
  });

  it('leaves undocumented status codes untouched', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.status(503).json(record));

    expect((await request(app).get('/users/7')).body).toEqual(record);
  });

  it('still matches the headers res.json produces', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.json(record));
    app.get('/native', (_req, res) => res.json(filtered));

    const fast = await request(app).get('/users/7');
    const native = await request(app).get('/native');

    for (const header of ['content-type', 'content-length', 'etag', 'transfer-encoding']) {
      expect(fast.headers[header], header).toBe(native.headers[header]);
    }
    expect(fast.text).toBe(native.text);
  });

  it('answers 304 for a conditional request', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.json(record));

    const first = await request(app).get('/users/7');
    const second = await request(app).get('/users/7').set('If-None-Match', first.headers['etag']);

    expect(second.status).toBe(304);
  });

  it('coexists with res.fastJson', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (httpRequest, res) => {
      if (httpRequest.query.explicit) {
        res.fastJson(record);
        return;
      }
      res.json(record);
    });

    // Both entry points reach the same compiled serializer.
    expect((await request(app).get('/users/7')).body).toEqual(filtered);
    expect((await request(app).get('/users/7?explicit=1')).body).toEqual(filtered);
  });
});

describe('overrideJson steps aside when it cannot match res.json', () => {
  // `json spaces`, `json replacer` and `json escape` all change the bytes
  // res.json() writes, and a compiled serializer cannot reproduce them.
  it.each([
    ['json spaces', 2],
    ['json escape', true],
    ['json replacer', (_key: string, value: unknown) => value],
  ])('respects the %s app setting', async (setting, value) => {
    const app = express();
    app.set(setting, value);
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.json(record));

    const native = express();
    native.set(setting, value);
    native.get('/users/:id', (_req, res) => res.json(record));

    const fast = await request(app).get('/users/7');
    const reference = await request(native).get('/users/7');

    expect(fast.text).toBe(reference.text);
    // The stock res.json() ran, so nothing was filtered out.
    expect(fast.body).toHaveProperty('secret');
  });

  // Regression: the three settings were folded together with `??`, which stops
  // at the first non nullish value. A `json spaces` of 0, a normal way to spell
  // "compact output in production", is non nullish but falsy, so it both failed
  // the check itself and hid `json escape` behind it. The fast path then ran and
  // wrote `<`, `>` and `&` unescaped, which is exactly what `json escape` exists
  // to prevent when the payload is embedded in HTML.
  it.each([
    [
      'a single schema',
      (app: express.Express) => {
        app.get('/users/:id', fastJsonSchema(userSchema, { overrideJson: true }), (_req, res) => res.json(unsafe));
      },
    ],
    [
      'an OpenAPI document',
      (app: express.Express) => {
        app.use(fastJsonOpenApi(document, { overrideJson: true }));
        app.get('/users/:id', (_req, res) => res.json(unsafe));
      },
    ],
  ])('still respects json escape with %s when json spaces is 0', async (_label, mount) => {
    const app = express();
    app.set('json spaces', 0);
    app.set('json escape', true);
    mount(app);

    const native = express();
    native.set('json spaces', 0);
    native.set('json escape', true);
    native.get('/users/:id', (_req, res) => res.json(unsafe));

    const fast = await request(app).get('/users/7');
    const reference = await request(native).get('/users/7');

    expect(fast.text).toBe(reference.text);
    expect(fast.text).not.toContain('<script>');
    expect(fast.text).toContain('\\u003cscript\\u003e');
  });

  // A falsy `json spaces` on its own changes nothing about the bytes res.json()
  // writes, so it must not cost the fast path.
  it.each([0, ''])('keeps the fast path when json spaces is %j and nothing else is set', async (spaces) => {
    const app = express();
    app.set('json spaces', spaces);
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.json(record));

    expect((await request(app).get('/users/7')).body).toEqual(filtered);
  });

  it('takes the fast path when the response has no app to read settings from', async () => {
    const app = express();
    app.use((_req, res, next) => {
      Object.defineProperty(res, 'app', { value: undefined, configurable: true });
      next();
    });
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/users/:id', (_req, res) => res.json(record));

    const res = await request(app).get('/users/7');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(filtered);
    // No app means no `etag fn` to consult.
    expect(res.headers['etag']).toBeUndefined();
  });

  it('falls back to res.json when the serializer throws, and reports it', async () => {
    const onError = vi.fn();
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true, onError }));
    // `n` is required by the schema, so the compiled serializer rejects this body.
    app.get('/strict-number', (_req, res) => res.json({ wrong: 'shape' }));

    const res = await request(app).get('/strict-number');

    // The route still answered, with what the stock res.json() would have written.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wrong: 'shape' });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it('falls back silently when no onError is given', async () => {
    const app = express();
    app.use(fastJsonOpenApi(document, { overrideJson: true }));
    app.get('/strict-number', (_req, res) => res.json({ wrong: 'shape' }));

    const res = await request(app).get('/strict-number');

    // No handler, no crash: the opt in can never turn a working route into a
    // failing one.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ wrong: 'shape' });
  });
});

describe('overrideJson with a single schema', () => {
  const schema: Schema = userSchema;

  it('serializes a 2xx response through the schema', async () => {
    const app = express();
    app.get('/users/:id', fastJsonSchema(schema, { overrideJson: true }), (_req, res) => res.json(record));

    expect((await request(app).get('/users/7')).body).toEqual(filtered);
  });

  it('is off by default', async () => {
    const app = express();
    app.get('/users/:id', fastJsonSchema(schema), (_req, res) => res.json(record));

    expect((await request(app).get('/users/7')).body).toEqual(record);
  });

  // The schema describes the success payload, so an error body must not be
  // rewritten into its shape.
  it.each([400, 404, 500, 503])('leaves a %i response to the stock res.json', async (status) => {
    const app = express();
    app.get('/users/:id', fastJsonSchema(schema, { overrideJson: true }), (_req, res) => res.status(status).json({ error: 'boom', detail: 'kept' }));

    const res = await request(app).get('/users/7');

    expect(res.status).toBe(status);
    expect(res.body).toEqual({ error: 'boom', detail: 'kept' });
  });

  it('covers res.send(object) too', async () => {
    const app = express();
    app.get('/users/:id', fastJsonSchema(schema, { overrideJson: true }), (_req, res) => res.send(record));

    expect((await request(app).get('/users/7')).body).toEqual(filtered);
  });

  it('still forwards the fast-json-stringify options', async () => {
    const app = express();
    app.get('/users/:id', fastJsonSchema(schema, { overrideJson: true, rounding: 'ceil' }), (_req, res) => res.json({ ...record, id: 7.2 }));

    expect((await request(app).get('/users/7')).body.id).toBe(8);
  });

  it('reports a serializer failure and falls back', async () => {
    const onError = vi.fn();
    const app = express();
    const strict: Schema = { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'], additionalProperties: false };
    app.get('/x', fastJsonSchema(strict, { overrideJson: true, onError }), (_req, res) => res.json({ wrong: 'shape' }));

    await request(app).get('/x');

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
