import express, { type RequestHandler, type Response } from 'express';
import fulmine from 'fulmine.js';
import { expectAssignable, expectError, expectType } from 'tsd';

import {
  type Application,
  fastJsonOpenApi,
  fastJsonSchema,
  type FastJsonSchemaOptions,
  installFastJson,
  type OpenApiDocument,
  openApiSchema,
  type Schema,
  toOpenApiPath,
} from '../../src/index.js';

const schema: Schema = { type: 'object', properties: { id: { type: 'integer' } } };
const document: OpenApiDocument = { openapi: '3.1.0', paths: {} };

// installFastJson
const app = express();
expectType<void>(installFastJson(app));
expectType<void>(installFastJson(app, { overrideJson: true, strict: false, onError: (error, req) => console.log(error, req.method) }));
expectAssignable<Application>(fulmine());
installFastJson(fulmine());
expectError(installFastJson(express.Router()));
expectError(installFastJson(app, { overrideJson: 'yes' }));

// fastJsonSchema
expectType<RequestHandler>(fastJsonSchema(schema));
expectType<RequestHandler>(fastJsonSchema(schema, { rounding: 'ceil' }));
expectError<FastJsonSchemaOptions>({ mode: 'debug' });
expectError(fastJsonSchema(schema, { rounding: 'up' }));

// the middleware fits every Express registration shape, and res.fastJson is on every response
const middleware = fastJsonSchema(schema);
app.use(middleware);
app.get('/a', middleware, (_req, res) => {
  expectType<Response>(res.fastJson({ id: 1 }));
});
app.post('/b', middleware, (_req, res) => res.status(201).fastJson({ id: 1 }));
express.Router().get('/c', middleware, (_req, res) => res.fastJson({ id: 1 }));

// OpenAPI
expectType<string>(toOpenApiPath('/users/:id'));
expectType<Schema | undefined>(openApiSchema(document, '/users/{id}', 'get'));
expectType<Schema | undefined>(openApiSchema(document, '/users/{id}', 'get', 201, 'application/vnd.api+json'));
expectType<void>(fastJsonOpenApi(app, document));
expectType<void>(fastJsonOpenApi(app, document, { contentType: 'application/json', overrideJson: true, rounding: 'floor' }));
expectError(fastJsonOpenApi(app, { paths: 'nope' }));
