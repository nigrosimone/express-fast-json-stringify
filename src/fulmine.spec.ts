import express from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { type Application, fastJsonOpenApi, fastJsonSchema, installFastJson, type OpenApiDocument, type Schema } from './index';

// Fulmine is Express on uWebSockets.js. Two things are checked here: that the package answers the
// same bytes on it as on Express, and that it costs the framework nothing it can avoid. Fulmine
// reads the source of every middleware and handler at listen() and skips copying the request
// headers when none of them can read one; a middleware that only writes res.locals passes, one
// that assigns res.fastJson per request did not, and that was 20% of a request on a real header set.

const user = { id: 7, firstName: 'Simoné', lastName: 'Nigrò', secret: 'never serialized' };
const filtered = { id: 7, firstName: 'Simoné', lastName: 'Nigrò' };

const userSchema: Schema = {
  type: 'object',
  properties: { id: { type: 'integer' }, firstName: { type: 'string' }, lastName: { type: 'string' } },
  additionalProperties: false,
};

const document: OpenApiDocument = {
  openapi: '3.1.0',
  paths: {
    '/api/users/{id}': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          '404': { content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } }, additionalProperties: false } } } },
        },
      },
    },
  },
  components: { schemas: { User: userSchema } },
};

type Factory = typeof express;

/** The same application on either framework. */
const build = (create: Factory, options: { overrideJson?: boolean } = {}) => {
  const app = create();
  fastJsonOpenApi(app, document, options);
  // The mount first: fulmine 5.21.2 reads a middleware's next() as a possible fall-through into
  // whatever is registered after the route, and takes the skip back. Later versions know it
  // lands on the handler of the same route.
  const api = create.Router();
  api.get('/users/:id', (req, res) => (req.query.missing ? res.status(404).json({ message: 'gone', secret: 'x' }) : res.json(user)));
  app.use('/api', api);
  app.get('/explicit/:id', fastJsonSchema(userSchema), (_req, res) => res.fastJson(user));
  app.get('/override/:id', fastJsonSchema(userSchema), (_req, res) => res.json(user));
  app.get('/error/:id', fastJsonSchema(userSchema), (_req, res) => res.status(500).json({ error: 'boom', secret: 'kept' }));
  app.get('/plain/:id', (_req, res) => res.json(user));
  app.get('/empty/:code', fastJsonSchema(userSchema), (req, res) => {
    res.status(Number(req.params.code));
    res.fastJson(user);
  });
  return app;
};

const routes = ['/explicit/7', '/override/7', '/error/7', '/plain/7', '/empty/204', '/api/users/7', '/api/users/7?missing=1'];

// what the framework signs, not the package: the date, the connection pair and its own name
const shape = (res: request.Response) => {
  const { date: _date, connection: _connection, 'keep-alive': _keepAlive, 'x-powered-by': _poweredBy, ...headers } = res.headers;
  return { status: res.status, headers, text: res.text };
};

// fulmine wants node 22: its uWebSockets.js binary is not built for older ABIs, so it is only
// loaded where the tests run
const nodeMajor = Number(process.versions.node.split('.')[0]);

describe.skipIf(nodeMajor < 22)('on fulmine', () => {
  let fulmine: typeof import('fulmine.js');

  beforeAll(async () => {
    fulmine = (await import('fulmine.js')).default;
  });

  it.each([false, true])('answers as Express does, overrideJson %s', async (overrideJson) => {
    const onExpress = build(express, { overrideJson });
    const onFulmine = build(fulmine as unknown as Factory, { overrideJson });

    for (const route of routes) {
      for (const method of ['get', 'head'] as const) {
        const expected = await request(onExpress)[method](route);
        const actual = await request(onFulmine)[method](route);
        expect(shape(actual), `${method.toUpperCase()} ${route}`).toEqual(shape(expected));
      }
    }
  });

  it('applies the schema on both entry points', async () => {
    const app = build(fulmine as unknown as Factory, { overrideJson: true });

    expect((await request(app).get('/explicit/7')).body).toEqual(filtered);
    expect((await request(app).get('/override/7')).body).toEqual(filtered);
    expect((await request(app).get('/api/users/7')).body).toEqual(filtered);
    expect((await request(app).get('/api/users/7?missing=1')).body).toEqual({ message: 'gone' });
    expect((await request(app).get('/error/7')).body).toEqual({ error: 'boom', secret: 'kept' });
  });

  it('answers a conditional request with 304', async () => {
    const app = build(fulmine as unknown as Factory, { overrideJson: true });
    const first = await request(app).get('/override/7');
    const second = await request(app).get('/override/7').set('If-None-Match', first.headers['etag']);

    expect(second.status).toBe(304);
    expect(second.text).toBe('');
  });

  it('keeps every route on the native path, with the header copy skipped', () => {
    const app = build(fulmine as unknown as Factory, { overrideJson: true });
    const report = fulmine.testing.routeReport(app as unknown as ReturnType<typeof fulmine>);

    // res.fastJson is not a method fulmine knows, so a handler calling it keeps the copy: the
    // overridden res.json is how the schema costs nothing there
    const skipped = report.filter((entry) => entry.skipHeaders).map((entry) => entry.path);
    expect(report.every((entry) => entry.native)).toBe(true);
    expect(skipped).toEqual(['/api/users/:id', '/override/:id', '/error/:id', '/plain/:id']);
    expect(report.map((entry) => entry.path)).toContain('/explicit/:id');
    expect(report.map((entry) => entry.path)).toContain('/empty/:code');
  });

  it('takes a fulmine application as it is', () => {
    const app = fulmine();
    const typed: Application = app;
    installFastJson(typed);

    expect(typeof app.response.fastJson).toBe('function');
  });
});
