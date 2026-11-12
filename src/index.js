'use strict';

const { installFastJson } = require('./lib/install.js');
const { fastJsonSchema } = require('./lib/middleware.js');
const { fastJsonOpenApi, openApiSchema, toOpenApiPath } = require('./lib/openapi.js');

// one object literal of names: cjs-module-lexer reads it as text, so `import { ... }` works from ESM
module.exports = { installFastJson, fastJsonSchema, fastJsonOpenApi, openApiSchema, toOpenApiPath };
