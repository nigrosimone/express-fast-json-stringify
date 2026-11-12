'use strict';

// Warms an Express app on a mix of requests, then turns on --trace-deopt and serves the same mix
// again: what V8 prints from then on is a deopt in steady state. Run with --allow-natives-syntax.

const http = require('node:http');
const path = require('node:path');
const v8 = require('node:v8');

const express = require('express');

const source = path.resolve(__dirname, '../../src');
const { fastJsonOpenApi, fastJsonSchema } = require(source);

// as syntax this file would not parse without the flag, so lint and require see a call
const status = new Function('f', 'return %GetOptimizationStatus(f)');
const prepare = new Function('f', '%PrepareFunctionForOptimization(f)');
const optimize = new Function('f', '%OptimizeFunctionOnNextCall(f)');

// the TurboFan bit moves between V8 versions, so it is read off a function optimized here, with
// the bits an interpreted and a Maglev function also carry taken out
const probe = (x) => x + 1;
prepare(probe);
probe(1);
probe(2);
optimize(probe);
probe(3);
const interpreted = (x) => x + 2;
interpreted(1);
const maglev = (x) => x + 3;
prepare(maglev);
maglev(1);
maglev(2);
new Function('f', '%OptimizeMaglevOnNextCall(f)')(maglev);
maglev(3);
const turbofanBit = status(probe) & ~status(interpreted) & ~status(maglev);

const userSchema = {
  type: 'object',
  properties: { id: { type: 'integer' }, firstName: { type: 'string' }, lastName: { type: 'string' } },
  additionalProperties: false,
};
const document = {
  openapi: '3.1.0',
  paths: {
    '/users/{id}': {
      get: {
        responses: {
          200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
          404: { content: { 'application/json': { schema: { type: 'object', properties: { message: { type: 'string' } } } } } },
        },
      },
    },
  },
  components: { schemas: { User: userSchema } },
};
const user = { id: 7, firstName: 'Simoné', lastName: 'Nigrò', secret: 'never serialized' };

const app = express();
app.set('etag', false);
fastJsonOpenApi(app, document, { overrideJson: true });
const withSchema = fastJsonSchema(userSchema);
app.get('/schema/:id', withSchema, (req, res) => res.fastJson(user));
app.get('/override/:id', withSchema, (req, res) => res.json(user));
app.get('/error/:id', withSchema, (req, res) => res.status(500).json({ error: 'boom' }));
app.get('/users/:id', (req, res) => (req.query.missing ? res.status(404).json({ message: 'gone' }) : res.json(user)));
app.get('/plain', (req, res) => res.json(user));

const PATHS = ['/schema/1', '/override/2', '/error/3', '/users/4', '/users/5?missing=1', '/plain'];

const load = (port, count) =>
  new Promise((resolve) => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 8 });
    let sent = 0;
    let done = 0;
    const one = () => {
      if (sent >= count) {
        return;
      }
      http.get({ host: '127.0.0.1', port, agent, path: PATHS[sent++ % PATHS.length] }, (res) => {
        res.resume();
        res.on('end', () => {
          if (++done === count) {
            agent.destroy();
            resolve(undefined);
          } else {
            one();
          }
        });
      });
    };
    for (let i = 0; i < 8; i++) {
      one();
    }
  });

const server = app.listen(0, '127.0.0.1', async () => {
  const { port } = server.address();
  await load(port, 60000);
  v8.setFlagsFromString('--trace-file-names');
  v8.setFlagsFromString('--trace-deopt');
  await load(port, 60000);
  v8.setFlagsFromString('--no-trace-deopt');
  // the hot functions this package owns that stay functions of their own after inlining
  const hot = {
    'res.fastJson': app.response.fastJson,
    'res.json (override)': app.response.json,
    'fastJsonSchema middleware': withSchema,
  };
  const optimized = {};
  for (const [name, fn] of Object.entries(hot)) {
    optimized[name] = (status(fn) & turbofanBit) !== 0;
  }
  server.close();
  process.stdout.write(`\n${JSON.stringify({ type: 'report', turbofanBit, optimized })}\n`);
});
