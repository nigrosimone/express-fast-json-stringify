JSON serialization is a critical task in web development, particularly for applications built with Node.js and Express.js. While the native JSON serialization in Node.js (`JSON.stringify()`) is straightforward and convenient, it can become a performance bottleneck, especially under heavy load. This documentation introduces [express-fast-json-stringify](https://www.npmjs.com/package/express-fast-json-stringify), a custom middleware package that leverages [fast-json-stringify](https://www.npmjs.com/package/fast-json-stringify) to significantly boost JSON serialization performance in Express applications.

## What is fast-json-stringify?

`fast-json-stringify` is a JSON serialization library developed by the Fastify team. It analyzes JSON schema definitions and compiles them into serialization functions specialized for the exact shape of your payload, so it can skip everything the schema does not describe instead of walking the object generically like `JSON.stringify()` has to.

## Introducing express-fast-json-stringify

`express-fast-json-stringify` is an npm package that brings the performance benefits of `fast-json-stringify` to Express.js applications. By integrating this package, you can achieve faster JSON serialization, thus improving the overall performance of your application.

## Installation

First, install the `express-fast-json-stringify` package:

```
npm install express-fast-json-stringify
```

It requires Express 4.16 or newer (Express 5 included) and Node.js 20 or newer.

## Creating a JSON Schema

Define a schema object that specifies the structure of your JSON responses. This schema will be used by `fast-json-stringify` to optimize the serialization process.

```ts
import { Schema } from 'express-fast-json-stringify';

const schema: Schema = {
  title: 'Example Schema',
  type: 'object',
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    age: {
      description: 'Age in years',
      type: 'integer',
    },
  },
};
```

## Applying the Middleware

Use the `fastJsonSchema` middleware in your Express routes, passing the schema object as an argument. This will set up the optimized JSON serialization for that route.

```ts
import express from 'express';
import { fastJsonSchema, Schema } from 'express-fast-json-stringify';

const app = express();

const exampleSchema: Schema = {
  title: 'Example Schema',
  type: 'object',
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    age: { type: 'integer' },
  },
};

app.get('/', fastJsonSchema(exampleSchema), (req, res, next) => {});
```

## Sending JSON Responses

Instead of using the default `res.json()` method, use the `res.fastJson()` method provided by the middleware to send JSON responses. This leverages the speed benefits of fast-json-stringify.

```ts
import express from 'express';
import { fastJsonSchema, Schema } from 'express-fast-json-stringify';

const app = express();

const schema: Schema = {
  title: 'Example Schema',
  type: 'object',
  properties: {
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    age: {
      description: 'Age in years',
      type: 'integer',
    },
  },
};

app.get('/', fastJsonSchema(schema), (req, res, next) => {
  try {
    const data = {
      firstName: 'Simone',
      lastName: 'Nigro',
      age: 40,
    };
    res.fastJson(data);
  } catch (error) {
    next(error);
  }
});
```

## Response semantics

`res.fastJson()` is a drop-in replacement for `res.json()`: only the
serialization changes, every HTTP detail stays the same.

| Behavior             | What `res.fastJson()` does                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| `Content-Type`       | `application/json; charset=utf-8`, unless the route already set one with `res.type()`.              |
| `Content-Length`     | Always set, from the byte length of the payload, so the response is never chunked.                  |
| `ETag`               | Follows the app `etag` setting, exactly like `res.send()`. Set `app.set('etag', false)` to skip it. |
| Conditional requests | A matching `If-None-Match` answers `304` with no body.                                              |
| `204` and `304`      | No body and no `Content-Type`/`Content-Length`/`Transfer-Encoding`.                                 |
| `HEAD`               | Headers only, `Content-Length` included.                                                            |

The payload is serialized before the status code is inspected, so a body that
does not match the schema still throws on a `204` — just like `res.json()`.

## Performance Benefits

Using `express-fast-json-stringify` offers several benefits:

1. **Increased Speed**: a compiled serializer only writes the properties the schema describes, so the more your objects carry that the response does not need, the more time it saves.
2. **Reduced CPU Usage**: faster serialization means less CPU time spent on processing, allowing your server to handle more concurrent requests.
3. **Consistency and Validation**: by defining JSON schemas, you ensure that the serialized data adheres to a predefined structure, improving data consistency and reducing the likelihood of errors — and properties missing from the schema never leak into a response.

How much you gain depends on the payload, and on a current V8 it is not a win across the board. Measured on Node.js 26 by `npm run example`:

| Case                                       | `fast-json-stringify` vs `JSON.stringify`   |
| ------------------------------------------ | ------------------------------------------- |
| objects carrying fields outside the schema | much faster (≈9x when 17 of 20 are dropped) |
| a single small object                      | comparable                                  |
| every field serialized                     | comparable                                  |
| long strings                               | slower                                      |

Run `npm run example` to get the numbers for your own Node.js version and payload shape before adopting it in a hot path.

## Conclusion

Integrating `express-fast-json-stringify` into your Express.js application can provide substantial performance improvements when JSON serialization is a bottleneck and your schemas let the serializer skip work. It also guarantees that responses carry exactly the properties the schema describes, which is worth having on its own.

To start using `express-fast-json-stringify`, follow the steps outlined in this documentation, and enjoy the benefits of faster JSON serialization in your Express applications. For a runnable demo, see [example/](./example): `npm install && npm run example`.

## Support

This is an open-source project. Star this [repository](https://github.com/nigrosimone/express-fast-json-stringify), if you like it, or even [donate](https://www.paypal.com/paypalme/snwp). Thank you so much!
