/**
 * Runnable example: the same payload served by res.json() and res.fastJson().
 *
 *     npm install
 *     npm run example
 *
 * It boots a real Express server and prints the raw responses side by side, so
 * you can check that the two agree on every header. Requests go through
 * `node:http` rather than `fetch`, because `fetch` revalidates conditional
 * requests internally and never surfaces the `304`.
 */
import http from 'node:http';

import express from 'express';
import fastJson from 'fast-json-stringify';

import { fastJsonSchema, type Schema } from '../src';

const schema: Schema = {
  title: 'Example Schema',
  type: 'object',
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    age: { description: 'Age in years', type: 'integer' },
  },
};

const payload = {
  firstName: 'Simoné',
  lastName: 'Nigrò',
  age: 40,
};

const app = express();

app.get('/', (_req, res, next) => {
  try {
    res.send(`<html><body><h1>Example</h1><p>Try <a href="/fast-json">/fast-json</a> and <a href="/native-json">/native-json</a>.</p></body></html>`);
  } catch (error) {
    next(error);
  }
});

app.get('/fast-json', fastJsonSchema(schema), (_req, res, next) => {
  try {
    // Properties missing from the schema never reach the wire.
    res.fastJson({ ...payload, internalNote: 'never serialized' });
  } catch (error) {
    next(error);
  }
});

app.get('/native-json', (_req, res) => {
  res.json(payload);
});

type Reply = { status: number; headers: http.IncomingHttpHeaders; body: string };

const send = (port: number, path: string, options: { method?: string; headers?: http.OutgoingHttpHeaders } = {}) =>
  new Promise<Reply>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });

const HEADERS = ['content-type', 'content-length', 'etag', 'transfer-encoding'];

const show = (label: string, reply: Reply) => {
  console.log(`\n${label}  →  ${reply.status}`);
  for (const header of HEADERS) {
    console.log(`    ${header.padEnd(18)} ${reply.headers[header] ?? '—'}`);
  }
  console.log(`    ${'body'.padEnd(18)} ${reply.body || '—'}`);
};

const server = app.listen(0, async () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    console.log('--- res.fastJson() vs res.json() ------------------------------');

    const fast = await send(port, '/fast-json');
    show('res.fastJson()', fast);
    show('res.json()    ', await send(port, '/native-json'));

    console.log('\n--- conditional request --------------------------------------');

    const etag = fast.headers.etag as string;
    show(`If-None-Match: ${etag}`, await send(port, '/fast-json', { headers: { 'If-None-Match': etag } }));
    show('If-None-Match: W/"stale"', await send(port, '/fast-json', { headers: { 'If-None-Match': 'W/"stale"' } }));

    console.log('\n--- HEAD -----------------------------------------------------');

    show('HEAD /fast-json', await send(port, '/fast-json', { method: 'HEAD' }));

    console.log('\n--- serialization timing -------------------------------------');
    console.log('    Where the speedup comes from, and where it does not: the');
    console.log('    schema compiled by fast-json-stringify against the generic');
    console.log('    JSON.stringify.\n');

    const measure = (fn: () => void, rounds: number) => {
      for (let i = 0; i < Math.min(rounds, 2_000); i++) {
        fn();
      }
      const started = performance.now();
      for (let i = 0; i < rounds; i++) {
        fn();
      }
      return performance.now() - started;
    };

    const compare = (name: string, caseSchema: Schema, body: unknown, rounds: number) => {
      const stringify = fastJson(caseSchema);
      const fastMs = measure(() => stringify(body), rounds);
      const nativeMs = measure(() => JSON.stringify(body), rounds);
      console.log(`    ${name.padEnd(30)} ${fastMs.toFixed(0).padStart(9)} ms ${nativeMs.toFixed(0).padStart(9)} ms ${(nativeMs / fastMs).toFixed(2).padStart(7)}x`);
    };

    const record = { id: 0, firstName: 'Simoné', lastName: 'Nigrò', age: 40, active: true };
    const recordSchema: Schema = {
      type: 'object',
      properties: { id: { type: 'integer' }, firstName: { type: 'string' }, lastName: { type: 'string' }, age: { type: 'integer' }, active: { type: 'boolean' } },
    };

    // Same records, but each carries 17 extra fields the schema does not describe.
    const padded = Array.from({ length: 200 }, (_, i) => {
      const wide: Record<string, unknown> = { ...record, id: i };
      for (let k = 0; k < 17; k++) {
        wide[`extra${k}`] = `some padding value ${k}`;
      }
      return wide;
    });

    console.log(`    ${'case'.padEnd(30)} ${'schema'.padStart(12)} ${'native'.padStart(12)} ${'ratio'.padStart(8)}`);

    compare('single small object', recordSchema, record, 200_000);

    compare(
      'schema keeps 3 of 20 fields',
      {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'object', properties: { id: { type: 'integer' }, firstName: { type: 'string' }, lastName: { type: 'string' } }, additionalProperties: false },
          },
        },
      },
      { items: padded },
      2_000,
    );

    compare(
      'every field serialized',
      { type: 'object', properties: { items: { type: 'array', items: recordSchema } } },
      { items: Array.from({ length: 200 }, (_, i) => ({ ...record, id: i })) },
      5_000,
    );

    compare(
      'long strings',
      { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { text: { type: 'string' } } } } } },
      { items: Array.from({ length: 100 }, () => ({ text: 'lorem ipsum dolor sit amet '.repeat(40) })) },
      2_000,
    );

    console.log('\n    A ratio above 1 means fast-json-stringify wins. The gain');
    console.log('    tracks how much the schema lets it skip: filtering unknown');
    console.log('    properties is where it pays off, while V8 stays ahead when');
    console.log('    every field, especially a long string, has to be written.');
    console.log('\n    An end to end HTTP comparison needs a real load generator');
    console.log('    (autocannon, wrk, ...): a sequential request loop measures');
    console.log('    the event loop, not the serializer.\n');
  } finally {
    server.close();
  }
});
