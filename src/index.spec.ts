import test from 'ava';
import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';

import { fastJsonSchema, Schema } from './';

const data = {
  firstName: 'Simone',
  lastName: 'Nigro',
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

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ error: err.message });
});

test('with schema', async (t) => {
  t.plan(3);

  const res = await request(app).post('/with-schema').send({ data });

  t.like(res.body, data);
  t.is(res.ok, true);
  t.is(res.type, 'application/json');
});

test('without schema', async (t) => {
  t.plan(3);

  const res = await request(app).post('/without-schema').send({ data });

  t.like(res.body, { error: `res.fastJson is not a function` });
  t.is(res.ok, false);
  t.is(res.type, 'application/json');
});
