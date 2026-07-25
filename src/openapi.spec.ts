import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { fastJsonOpenApi, type OpenApiDocument, toOpenApiPath } from './index';

const user = { id: 7, firstName: 'Simoné', lastName: 'Nigrò', secret: 'never serialized' };
const serializedUser = { id: 7, firstName: 'Simoné', lastName: 'Nigrò' };

/** OpenAPI 3.1, with a $ref into components and a per status schema. */
const openApi31: OpenApiDocument = {
  openapi: '3.1.0',
  paths: {
    '/users/{id}': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '404': { content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
        },
      },
    },
    '/users': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } },
        },
      },
      post: {
        responses: {
          '201': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          default: { content: { 'application/json': { schema: { type: 'object', properties: { error: { type: 'string' } } } } } },
        },
      },
    },
    '/ranged': {
      get: {
        responses: {
          '2XX': { content: { 'application/json': { schema: { type: 'object', properties: { ranged: { type: 'boolean' } } } } } },
        },
      },
    },
    '/tree': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } },
        },
      },
    },
    '/other-media': {
      get: {
        responses: {
          '200': { content: { 'application/vnd.api+json': { schema: { type: 'object', properties: { wrapped: { type: 'boolean' } } } } } },
        },
      },
    },
    '/undocumented-status': {
      get: {
        responses: {
          '418': { content: { 'application/json': { schema: { type: 'object', properties: { teapot: { type: 'boolean' } } } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: { id: { type: 'integer' }, firstName: { type: 'string' }, lastName: { type: 'string' } },
        additionalProperties: false,
      },
      Node: {
        type: 'object',
        properties: { value: { type: 'integer' }, child: { $ref: '#/components/schemas/Node' } },
      },
    },
  },
};

/** OpenAPI 3.0, which spells nullability with `nullable` instead of a type union. */
const openApi30: OpenApiDocument = {
  openapi: '3.0.3',
  paths: {
    '/profile': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' }, nickname: { type: 'string', nullable: true }, age: { type: 'integer', example: 40 } },
                },
              },
            },
          },
        },
      },
    },
  },
};

/** Swagger 2.0, which puts the schema on the response and shares under `definitions`. */
const swagger20: OpenApiDocument = {
  swagger: '2.0',
  paths: {
    '/legacy/{id}': {
      get: {
        responses: {
          '200': { schema: { $ref: '#/definitions/Legacy' } },
        },
      },
    },
  },
  definitions: {
    Legacy: { type: 'object', properties: { id: { type: 'integer' }, label: { type: 'string' } }, additionalProperties: false },
  },
};

describe('toOpenApiPath', () => {
  it.each([
    ['/users', '/users'],
    ['/users/:id', '/users/{id}'],
    ['/users/:id/posts/:postId', '/users/{id}/posts/{postId}'],
    ['/files/:name?', '/files/{name}'],
    ['/items/:id(\\d+)', '/items/{id}'],
    ['/mixed/:a_1/x/:b2', '/mixed/{a_1}/x/{b2}'],
  ])('turns %s into %s', (expressPath, expected) => {
    expect(toOpenApiPath(expressPath)).toBe(expected);
  });
});

describe('fastJsonOpenApi', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'nope'],
    ['a number', 42],
    ['a document without paths', { openapi: '3.1.0' }],
  ])('rejects %s as a document', (_label, value) => {
    expect(() => fastJsonOpenApi(value as never)).toThrow(TypeError);
    expect(() => fastJsonOpenApi(value as never)).toThrow('express-fast-json-stringify: invalid OpenAPI document');
  });

  it('serializes with the schema of the matched route', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/users/:id', (_req, res) => res.fastJson(user));

    const res = await request(app).get('/users/7');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(serializedUser);
    expect(res.body).not.toHaveProperty('secret');
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('resolves the route under a mounted router', async () => {
    const app = express();
    const router = express.Router();
    app.use(fastJsonOpenApi(openApi31));
    router.get('/:id', (_req, res) => res.fastJson(user));
    app.use('/users', router);

    const res = await request(app).get('/users/7');

    expect(res.body).toEqual(serializedUser);
  });

  it('picks the schema of the response status code', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/users/:id', (_req, res) => res.status(404).fastJson({ message: 'not found', secret: 'x' }));

    const res = await request(app).get('/users/9');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: 'not found' });
  });

  it('distinguishes methods on the same path', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/users', (_req, res) => res.fastJson([user, user]));
    app.post('/users', (_req, res) => res.status(201).fastJson(user));

    expect((await request(app).get('/users')).body).toEqual([serializedUser, serializedUser]);
    expect((await request(app).post('/users')).body).toEqual(serializedUser);
  });

  it('falls back to the default response', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.post('/users', (_req, res) => res.status(500).fastJson({ error: 'boom', secret: 'x' }));

    const res = await request(app).post('/users');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });

  it('matches a wildcard status range', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/ranged', (_req, res) => res.status(202).fastJson({ ranged: true, secret: 'x' }));

    const res = await request(app).get('/ranged');

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ ranged: true });
  });

  it('resolves recursive references', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/tree', (_req, res) => res.fastJson({ value: 1, child: { value: 2, child: { value: 3 } } }));

    const res = await request(app).get('/tree');

    expect(res.body).toEqual({ value: 1, child: { value: 2, child: { value: 3 } } });
  });

  it('answers a HEAD request with the GET schema', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/users/:id', (_req, res) => res.fastJson(user));

    const res = await request(app).head('/users/7');

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(JSON.stringify(serializedUser))));
  });

  it('reads a non default media type', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31, { contentType: 'application/vnd.api+json' }));
    app.get('/other-media', (_req, res) => res.fastJson({ wrapped: true, secret: 'x' }));

    const res = await request(app).get('/other-media');

    expect(res.body).toEqual({ wrapped: true });
  });

  it('falls back to the request path when no route has matched yet', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    // Answering straight from plain middleware leaves `req.route` undefined, so
    // the request path is what identifies the operation.
    app.use((req, res, next) => {
      if (req.path === '/ranged') {
        res.fastJson({ ranged: true, secret: 'x' });
        return;
      }
      next();
    });

    const res = await request(app).get('/ranged');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ranged: true });
  });

  it('honours a pinned path and method', async () => {
    const app = express();
    // The Express route does not match the document, so pin the operation.
    app.get('/v2/people/:id', fastJsonOpenApi(openApi31, { path: '/users/{id}', method: 'get' }), (_req, res) => res.fastJson(user));

    const res = await request(app).get('/v2/people/7');

    expect(res.body).toEqual(serializedUser);
  });

  it('forwards the fast-json-stringify options', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31, { rounding: 'ceil' }));
    app.get('/users/:id', (_req, res) => res.fastJson({ ...user, id: 7.2 }));

    const res = await request(app).get('/users/7');

    expect(res.body.id).toBe(8);
  });

  it('supports OpenAPI 3.0 nullable and ignores annotations', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi30));
    app.get('/profile', (_req, res) => res.fastJson({ name: 'Simone', nickname: null, age: 40 }));

    const res = await request(app).get('/profile');

    expect(res.text).toBe(JSON.stringify({ name: 'Simone', nickname: null, age: 40 }));
  });

  it('supports Swagger 2.0 documents', async () => {
    const app = express();
    app.use(fastJsonOpenApi(swagger20));
    app.get('/legacy/:id', (_req, res) => res.fastJson({ id: 1, label: 'old', secret: 'x' }));

    const res = await request(app).get('/legacy/1');

    expect(res.body).toEqual({ id: 1, label: 'old' });
  });
});

describe('fastJsonOpenApi undocumented responses', () => {
  it('falls back to res.json for a route the document does not describe', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/not-in-the-document', (_req, res) => res.fastJson(user));

    const res = await request(app).get('/not-in-the-document');

    expect(res.status).toBe(200);
    // res.json() keeps every property, since no schema filtered them.
    expect(res.body).toEqual(user);
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
  });

  it('falls back to res.json for a status the operation does not describe', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/undocumented-status', (_req, res) => res.fastJson({ teapot: true, secret: 'x' }));

    const res = await request(app).get('/undocumented-status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ teapot: true, secret: 'x' });
  });

  it('falls back to res.json for an undocumented media type', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31, { contentType: 'application/x-other' }));
    app.get('/users/:id', (_req, res) => res.fastJson(user));

    expect((await request(app).get('/users/7')).body).toEqual(user);
  });

  it('throws in strict mode', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31, { strict: true }));
    app.get('/not-in-the-document', (_req, res, next) => {
      try {
        res.fastJson(user);
      } catch (error) {
        next(error);
      }
    });
    app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.status(500).json({ error: err.message });
    });

    const res = await request(app).get('/not-in-the-document');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('no application/json schema for GET /not-in-the-document');
  });
});

describe('fastJsonOpenApi HTTP semantics', () => {
  const build = () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/users/:id', (_req, res) => res.fastJson(user));
    app.get('/native/:id', (_req, res) => res.json(serializedUser));
    app.get('/empty/:code', fastJsonOpenApi(openApi31, { path: '/users/{id}', method: 'get' }), (req, res) => res.status(Number(req.params.code)).fastJson(user));
    return app;
  };

  it('matches every header res.json() produces', async () => {
    const app = build();
    const fast = await request(app).get('/users/7');
    const native = await request(app).get('/native/7');

    for (const header of ['content-type', 'content-length', 'etag', 'transfer-encoding']) {
      expect(fast.headers[header], header).toBe(native.headers[header]);
    }
    expect(fast.text).toBe(native.text);
  });

  it('answers 304 when the client ETag still matches', async () => {
    const app = build();
    const first = await request(app).get('/users/7');
    const second = await request(app).get('/users/7').set('If-None-Match', first.headers['etag']);

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it.each([204, 304])('sends no body nor content headers on %i', async (code) => {
    const res = await request(build()).get(`/empty/${code}`);

    expect(res.status).toBe(code);
    expect(res.text).toBe('');
    expect(res.headers['content-type']).toBeUndefined();
    expect(res.headers['content-length']).toBeUndefined();
  });
});

describe('fastJsonOpenApi caching', () => {
  it('compiles one serializer per operation and status, and reuses it', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/users/:id', (_req, res) => res.fastJson(user));

    for (let i = 0; i < 5; i++) {
      expect((await request(app).get(`/users/${i}`)).body).toEqual(serializedUser);
    }
  });

  it('caches misses too, so an undocumented route stays cheap', async () => {
    const app = express();
    app.use(fastJsonOpenApi(openApi31));
    app.get('/nope', (_req, res) => res.fastJson({ a: 1 }));

    for (let i = 0; i < 3; i++) {
      expect((await request(app).get('/nope')).body).toEqual({ a: 1 });
    }
  });
});
