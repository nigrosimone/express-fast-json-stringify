# express-fast-json-stringify

One of the reasons why [Fastify](https://www.npmjs.com/package/fastify) is faster than Express is its use of [fast-json-stringify](https://www.npmjs.com/package/fast-json-stringify). `fast-json-stringify` is a library developed by the Fastify team that boosts JSON conversion speed by analyzing JSON schema definitions.

See the stackblitz [demo](https://stackblitz.com/edit/express-fast-json-stringify).

By using the `fast-json-stringify` library, Fastify can serialize JSON much faster than Express, contributing to its overall performance advantage.

With `express-fast-json-stringify`, you can leverage `fast-json-stringify` in your Express application as follows:

```ts
import express from 'express';
import { fastJsonSchema, Schema } from 'express-fast-json-stringify';

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

## How to Use

1. Install the package:

```
npm install express-fast-json-stringify
```

2. Create a schema object that defines the structure of your JSON response, eg.:

```ts
import { Schema } from 'express-fast-json-stringify';

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
```

3. UApply the `fastJsonSchema` middleware to your Express route, passing in the schema object, eg.:

```ts
import { fastJsonSchema, Schema } from 'express-fast-json-stringify';

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

app.get('/', fastJsonSchema(schema), (req, res, next) => {});
```

4. Send JSON Response: Use `res.fastJson()` to send your JSON response, leveraging the speed benefits of `fast-json-stringify`, eg.:

```ts
import { fastJsonSchema, Schema } from 'express-fast-json-stringify';

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

By following these steps, you can enhance the performance of your Express applications with faster JSON serialization.
