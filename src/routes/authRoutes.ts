import * as dotenv from 'dotenv';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { prisma } from '../lib/prisma';
import { authenticate } from '../plugins/authenticate';

dotenv.config();

export async function authRoutes(app: FastifyInstance) {
  app.get('/login', (_, reply) => {
    const state = uuidv4();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI as string,
      scope: 'email profile',
      access_type: 'offline',
      include_granted_scopes: 'true',
      state,
    });

    const authorizationUrl = `https://accounts.google.com/o/oauth2/auth?${query}`;

    reply.cookie('oauth-state', state, { maxAge: 60 * 15, httpOnly: true, secure: true });

    return reply.redirect(authorizationUrl);
  });

  app.get('/login/callback', async (req: FastifyRequest<{ Querystring: { code: string; state: string } }>, reply) => {
    const querySchema = z.object({
      code: z.string(),
      state: z.string(),
    });
    const { code, state: stateReceived } = querySchema.parse(req.query);

    const state = req.cookies['oauth-state'];

    reply.clearCookie('oauth-state');

    if (stateReceived !== state) {
      return reply.send('Invalid request');
    }

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID as string,
        client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI as string,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await response.json();
    const jwtToken = app.jwt.sign({ token: tokens.access_token });

    return reply.redirect(`${process.env.CLIENT_BASE_URL}/?access=${jwtToken}`);
  });

  app.get(
    '/me',
    {
      onRequest: [authenticate],
    },
    async (req) => {
      return { user: req.user };
    }
  );

  app.post('/users', async (req) => {
    const createUserBody = z.object({
      access_token: z.string(),
    });
    const { access_token } = createUserBody.parse(req.body);
    const { token } = app.jwt.verify(access_token) as { token: string };
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const userData = await userResponse.json();
    const userInfoSchema = z.object({
      id: z.string(),
      email: z.string().email(),
      name: z.string(),
      picture: z.string().url(),
    });
    const userInfo = userInfoSchema.parse(userData);

    let user = await prisma.user.findUnique({
      where: {
        googleId: userInfo.id,
      },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          googleId: userInfo.id,
          name: userInfo.name,
          email: userInfo.email,
          avatarUrl: userInfo.picture,
        },
      });
    }

    const userToken = app.jwt.sign(
      {
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
      },
      {
        sub: user.id,
        expiresIn: '7 days',
      }
    );

    return { userToken };
  });
}
