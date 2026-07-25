import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { fastJsonSchema, type Schema } from './index';

const data = {
  firstName: 'Simone',
  lastName: 'Nigro',
  age: 40,
};

/** Non ASCII payload, to prove the charset is announced correctly. */
const accented = {
  firstName: 'Simoné',
  lastName: 'Nigrò',
  age: 40,
};

const schema: Schema = {
  title: 'Example Schema',
  type: 'object',
  properties: {
    firstName: {
      type: 'string',
    },
    lastName: {
      type: 'string',
    },
    age: {
      description: 'Age in years',
      type: 'integer',
    },
  },
};

const app = express();

app.use(express.json());

app.post('/with-schema', fastJsonSchema(schema), (req, res, next) => {
  try {
    res.fastJson(req.body.data);
  } catch (error) {
    next(error);
  }
});

app.post('/without-schema', (req, res, next) => {
  try {
    res.fastJson(req.body.data);
  } catch (error) {
    next(error);
  }
});

app.get('/fast', fastJsonSchema(schema), (_req, res) => {
  res.fastJson(accented);
});

app.get('/native', (_req, res) => {
  res.json(accented);
});

app.get('/preset-type', fastJsonSchema(schema), (_req, res) => {
  res.type('application/vnd.api+json');
  res.fastJson(accented);
});

app.get('/preset-etag', fastJsonSchema(schema), (_req, res) => {
  res.setHeader('ETag', 'W/"custom"');
  res.fastJson(accented);
});

app.get('/status/:code', fastJsonSchema(schema), (req, res) => {
  res.status(Number(req.params.code)).fastJson(accented);
});

app.get('/chained-status', fastJsonSchema(schema), (_req, res) => {
  res.status(201).fastJson(accented);
});

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message });
});

/** Same routes, on an app with ETag generation switched off. */
const noEtagApp = express();
noEtagApp.set('etag', false);
noEtagApp.get('/fast', fastJsonSchema(schema), (_req, res) => {
  res.fastJson(accented);
});
noEtagApp.get('/native', (_req, res) => {
  res.json(accented);
});

describe('fastJsonSchema', () => {
  it('serializes the response through the schema', async () => {
    const res = await request(app).post('/with-schema').send({ data });

    expect(res.ok).toBe(true);
    expect(res.body).toMatchObject(data);
    expect(res.type).toBe('application/json');
  });

  it('drops the properties missing from the schema', async () => {
    const res = await request(app)
      .post('/with-schema')
      .send({ data: { ...data, secret: 'nope' } });

    expect(res.body).toEqual(data);
    expect(res.body).not.toHaveProperty('secret');
  });

  it('leaves res.fastJson undefined on routes without the middleware', async () => {
    const res = await request(app).post('/without-schema').send({ data });

    expect(res.ok).toBe(false);
    expect(res.body).toMatchObject({ error: 'res.fastJson is not a function' });
    expect(res.type).toBe('application/json');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['zero', 0],
    ['an empty string', ''],
    ['a string', 'not-a-schema'],
    ['a number', 42],
  ])('rejects %s as a schema', (_label, value) => {
    expect(() => fastJsonSchema(value as never)).toThrow(TypeError);
    expect(() => fastJsonSchema(value as never)).toThrow('express-fast-json-stringify: invalid schema');
  });

  it('forwards the fast-json-stringify options', async () => {
    const strict = express();
    strict.get(
      '/',
      fastJsonSchema(
        {
          type: 'object',
          properties: { firstName: { type: 'string' } },
          additionalProperties: false,
        },
        { rounding: 'ceil' },
      ),
      (_req, res) => res.fastJson(data),
    );

    const res = await request(strict).get('/');

    expect(res.body).toEqual({ firstName: 'Simone' });
  });
});

describe('res.fastJson headers', () => {
  // Regression: the content type was announced without a charset, unlike
  // res.json(), so strict clients mis-decoded non ASCII payloads.
  it('announces the charset', async () => {
    const res = await request(app).get('/fast');

    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.text).toBe(JSON.stringify(accented));
  });

  // Regression: the content type was overwritten unconditionally.
  it('keeps a content type the route already set', async () => {
    const res = await request(app).get('/preset-type');

    expect(res.headers['content-type']).toBe('application/vnd.api+json');
  });

  // Regression: without an explicit Content-Length the response fell back to
  // chunked encoding, and HEAD requests answered with no length at all.
  it('sets Content-Length', async () => {
    const res = await request(app).get('/fast');

    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(accented))));
    expect(res.headers['transfer-encoding']).toBeUndefined();
  });

  it('sets Content-Length on a HEAD request and sends no body', async () => {
    const res = await request(app).head('/fast');

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(accented))));
    expect(res.text).toBeUndefined();
  });

  it('matches every header res.json() produces', async () => {
    const fast = await request(app).get('/fast');
    const native = await request(app).get('/native');

    for (const header of ['content-type', 'content-length', 'etag', 'transfer-encoding']) {
      expect(fast.headers[header], header).toBe(native.headers[header]);
    }
    expect(fast.text).toBe(native.text);
  });

  it('keeps an ETag the route already set', async () => {
    const res = await request(app).get('/preset-etag');

    expect(res.headers['etag']).toBe('W/"custom"');
  });

  it('honours a custom ETag function', async () => {
    const custom = express();
    custom.set('etag', () => '"fixed"');
    custom.get('/', fastJsonSchema(schema), (_req, res) => res.fastJson(accented));

    const res = await request(custom).get('/');

    expect(res.headers['etag']).toBe('"fixed"');
  });

  it('sets no ETag when a custom ETag function returns nothing', async () => {
    const custom = express();
    // Express lets a custom `etag fn` opt out per response by returning undefined.
    custom.set('etag', () => undefined);
    custom.get('/', fastJsonSchema(schema), (_req, res) => res.fastJson(accented));

    const res = await request(custom).get('/');

    expect(res.status).toBe(200);
    expect(res.headers['etag']).toBeUndefined();
    expect(res.text).toBe(JSON.stringify(accented));
  });

  it('generates no ETag when the app disables them', async () => {
    const fast = await request(noEtagApp).get('/fast');
    const native = await request(noEtagApp).get('/native');

    expect(fast.headers['etag']).toBeUndefined();
    expect(native.headers['etag']).toBeUndefined();
    expect(fast.headers['content-length']).toBe(native.headers['content-length']);
  });

  it('preserves the status code set by the route', async () => {
    const res = await request(app).get('/chained-status');

    expect(res.status).toBe(201);
    expect(res.body).toEqual(accented);
  });
});

describe('res.fastJson conditional requests', () => {
  // Regression: no ETag was emitted, so swapping res.json() for res.fastJson()
  // silently disabled HTTP caching.
  it('answers 304 when the client ETag still matches', async () => {
    const first = await request(app).get('/fast');

    expect(first.status).toBe(200);
    expect(first.headers['etag']).toBeDefined();

    const second = await request(app).get('/fast').set('If-None-Match', first.headers['etag']);

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
    expect(second.headers['content-type']).toBeUndefined();
    expect(second.headers['content-length']).toBeUndefined();
  });

  it('answers 200 when the client ETag is stale', async () => {
    const res = await request(app).get('/fast').set('If-None-Match', 'W/"stale"');

    expect(res.status).toBe(200);
    expect(res.text).toBe(JSON.stringify(accented));
  });

  it('behaves like res.json() for a conditional request', async () => {
    const fast = await request(app).get('/fast');
    const native = await request(app).get('/native');

    const fastAgain = await request(app).get('/fast').set('If-None-Match', fast.headers['etag']);
    const nativeAgain = await request(app).get('/native').set('If-None-Match', native.headers['etag']);

    expect(fastAgain.status).toBe(nativeAgain.status);
  });
});

describe('res.fastJson empty responses', () => {
  // Regression: a 204/304 still carried Content-Type and a body.
  it.each([204, 304])('sends no body nor content headers on %i', async (code) => {
    const res = await request(app).get(`/status/${code}`);

    expect(res.status).toBe(code);
    expect(res.text).toBe('');
    expect(res.headers['content-type']).toBeUndefined();
    expect(res.headers['content-length']).toBeUndefined();
    expect(res.headers['transfer-encoding']).toBeUndefined();
  });

  it.each([204, 304])('behaves like res.json() on %i', async (code) => {
    const native = express();
    native.get('/status/:code', (req, res) => {
      res.status(Number(req.params.code)).json(accented);
    });

    const fast = await request(app).get(`/status/${code}`);
    const reference = await request(native).get(`/status/${code}`);

    expect(fast.status).toBe(reference.status);
    expect(fast.text).toBe(reference.text);
    expect(fast.headers['content-type']).toBe(reference.headers['content-type']);
    expect(fast.headers['content-length']).toBe(reference.headers['content-length']);
  });
});

describe('res.fastJson outside of Express', () => {
  // The middleware only relies on the Node response API plus two optional
  // Express extras, so it must not explode when they are missing.
  it('works when the response has no app and no fresh getter', async () => {
    const bare = express();
    bare.get('/', (req, res, next) => {
      Reflect.deleteProperty(req, 'app');
      Object.defineProperty(res, 'app', { value: undefined, configurable: true });
      next();
    });
    bare.get('/', fastJsonSchema(schema), (_req, res) => {
      res.fastJson(accented);
    });

    const res = await request(bare).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toBe(JSON.stringify(accented));
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });
});

describe('typings', () => {
  it('accepts a middleware in every Express registration shape', () => {
    const typed: Express = express();
    const middleware = fastJsonSchema(schema);

    typed.use(middleware);
    typed.get('/a', middleware, (_req, res) => res.fastJson(data));
    typed.post('/b', middleware, (_req, res) => res.status(201).fastJson(data));

    expect(typeof middleware).toBe('function');
    expect(middleware.length).toBe(3);
  });
});
