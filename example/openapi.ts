/**
 * Runnable example: serializing straight from the OpenAPI document you already
 * publish, instead of repeating the schema in the route.
 *
 *     npm install
 *     npm run example:openapi
 *
 * The document below is a plain object, which is exactly what `swagger-jsdoc`,
 * `tsoa` and friends hand you — swap it for `swaggerJsdoc({ ... })` and nothing
 * else changes.
 */
import http from 'node:http';

import express from 'express';

import { fastJsonOpenApi, type OpenApiDocument } from '../src';

const document: OpenApiDocument = {
  openapi: '3.1.0',
  paths: {
    '/users/{id}': {
      get: {
        responses: {
          200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          404: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/users': {
      post: {
        responses: {
          201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          default: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
        },
        additionalProperties: false,
      },
      Error: {
        type: 'object',
        properties: { message: { type: 'string' } },
        additionalProperties: false,
      },
    },
  },
};

const app = express();

// One middleware for the whole app: every route documented above gets a
// compiled serializer, chosen per route and per status code.
app.use(fastJsonOpenApi(document));

const record = {
  id: 7,
  firstName: 'Simoné',
  lastName: 'Nigrò',
  // Not in the User schema, so it can never reach a client.
  passwordHash: 'never serialized',
};

app.get('/users/:id', (req, res, next) => {
  try {
    if (req.params.id !== '7') {
      res.status(404).fastJson({ message: `no user ${req.params.id}`, passwordHash: 'never serialized' });
      return;
    }
    res.fastJson(record);
  } catch (error) {
    next(error);
  }
});

app.post('/users', (_req, res, next) => {
  try {
    res.status(201).fastJson(record);
  } catch (error) {
    next(error);
  }
});

// Not described by the document: `res.fastJson` falls back to `res.json`, so the
// route keeps working (pass `{ strict: true }` to make this an error instead).
app.get('/health', (_req, res) => {
  res.fastJson({ status: 'ok', uptime: 1 });
});

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

const send = (port: number, path: string, method = 'GET') =>
  new Promise<Reply>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

const show = (label: string, reply: Reply) => {
  console.log(`\n${label}`);
  console.log(`    status         ${reply.status}`);
  console.log(`    content-type   ${reply.headers['content-type'] ?? '—'}`);
  console.log(`    body           ${reply.body || '—'}`);
};

const server = app.listen(0, async () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    console.log('--- schema picked from the document, per route and per status --');

    show('GET /users/7        (200, User schema)', await send(port, '/users/7'));
    show('GET /users/9        (404, Error schema)', await send(port, '/users/9'));
    show('POST /users         (201, User schema)', await send(port, '/users', 'POST'));
    show('GET /health         (undocumented, falls back to res.json)', await send(port, '/health'));

    console.log('\n    Note how passwordHash never appears in a documented');
    console.log('    response: the schema decides what is serialized, so the');
    console.log('    contract you publish is the one the wire sees.\n');
  } finally {
    server.close();
  }
});
