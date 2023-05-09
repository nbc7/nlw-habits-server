import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import * as dotenv from 'dotenv';

import { userRoutes } from './routes/userRoutes';
import { habitsRoutes } from './routes/habitsRoutes';
import { authRoutes } from './routes/authRoutes';

import './lib/dayjs';

const app = Fastify();

dotenv.config();

app.register(cookie);

app.register(cors, {
  origin: [`${process.env.CLIENT_BASE_URL}`],
  methods: 'GET,POST,PATCH',
  credentials: true,
});

app.register(jwt, {
  secret: process.env.JWT_SECRET as string,
});

app.register(habitsRoutes);
app.register(authRoutes);
app.register(userRoutes);

app
  .listen({
    port: process.env.PORT ? Number(process.env.PORT) : 8080,
    host: '0.0.0.0',
  })
  .then(() => {
    console.log('HTTP server running!');
  });
