import * as dotenv from 'dotenv';
import dayjs from 'dayjs';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { prisma } from './lib/prisma';
import { authenticate } from './plugins/authenticate';

dotenv.config();

export async function appRoutes(app: FastifyInstance) {
  app.post('/habits', async (request) => {
    const createHabitBody = z.object({
      title: z.string(),
      weekDays: z.array(z.number().min(0).max(6)),
      email: z.string(),
    });
    const { title, weekDays, email } = createHabitBody.parse(request.body);

    const today = dayjs.tz(undefined).startOf('day').toDate();

    const user = await prisma.user.findUnique({
      where: {
        email: email,
      },
    });

    await prisma.habit.create({
      data: {
        title,
        created_at: today,
        weekDays: {
          create: weekDays.map((weekDay) => {
            return {
              week_day: weekDay,
            };
          }),
        },
        userId: user?.id,
      },
    });
  });

  app.post('/day', async (request) => {
    const getUserBody = z.object({
      userEmail: z.string(),
    });
    const { userEmail } = getUserBody.parse(request.body);

    const getDayParams = z.object({
      date: z.coerce.date(),
    });

    const { date } = getDayParams.parse(request.query);

    const parsedDate = dayjs.tz(date).startOf('day');
    const weekDay = parsedDate.get('day');

    const user = await prisma.user.findUnique({
      where: {
        email: userEmail,
      },
    });

    const possibleHabits = await prisma.habit.findMany({
      where: {
        created_at: {
          lte: date,
        },
        weekDays: {
          some: {
            week_day: weekDay,
          },
        },
        userId: user?.id,
      },
    });

    const day = await prisma.day.findUnique({
      where: {
        date: parsedDate.toDate(),
      },
      include: {
        dayHabits: {
          where: {
            habit: {
              userId: user?.id,
            },
          },
        },
      },
    });

    const completedHabits =
      day?.dayHabits.map((dayHabit) => {
        return dayHabit.habit_id;
      }) ?? [];

    return {
      possibleHabits,
      completedHabits,
    };
  });

  app.patch('/habits/:id/toggle', async (request) => {
    const toggleHabitParams = z.object({
      id: z.string().uuid(),
    });

    const { id } = toggleHabitParams.parse(request.params);

    const today = dayjs.tz(undefined).startOf('day').toDate();

    let day = await prisma.day.findUnique({
      where: {
        date: today,
      },
    });

    if (!day) {
      day = await prisma.day.create({
        data: {
          date: today,
        },
      });
    }

    const dayHabit = await prisma.dayHabit.findUnique({
      where: {
        day_id_habit_id: {
          day_id: day.id,
          habit_id: id,
        },
      },
    });

    if (dayHabit) {
      await prisma.dayHabit.delete({
        where: {
          id: dayHabit.id,
        },
      });
    } else {
      await prisma.dayHabit.create({
        data: {
          day_id: day.id,
          habit_id: id,
        },
      });
    }
  });

  app.post('/summary', async (request) => {
    const getUserBody = z.object({
      userEmail: z.string(),
    });
    const { userEmail } = getUserBody.parse(request.body);

    const user = await prisma.user.findUnique({
      where: {
        email: userEmail,
      },
    });

    const summary = await prisma.$queryRaw`
      SELECT
        D.id,
        D.date,
        (
          SELECT
            cast(count(*) as float)
          FROM day_habits DH
          JOIN habits H
            ON H.id = DH.habit_id
          WHERE DH.day_id = D.id
            AND H.userId = ${user?.id}
        ) as completed,
        (
          SELECT
            cast(count(*) as float)
          FROM habit_week_days HWD
          JOIN habits H
            ON H.id = HWD.habit_id
          WHERE
            HWD.week_day = cast(strftime('%w', D.date/1000.0, 'unixepoch') as int)
            AND h.created_at <= D.date
            AND H.userId = ${user?.id}
        ) as amount
      FROM days D
      WHERE EXISTS (
        SELECT 1
        FROM day_habits DH
        JOIN habits H
          ON H.id = DH.habit_id
        WHERE DH.day_id = D.id
          AND H.userId = ${user?.id}
      )
    `;

    return summary;
  });

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

  app.post('/users/:username/profile', async (req) => {
    const getUsernameBody = z.object({
      username: z.string(),
    });
    const { username } = getUsernameBody.parse(req.body);

    const user = await prisma.user.findUnique({
      where: {
        email: `${username}@gmail.com`,
      },
    });

    if (!user) return null;

    return {
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
    };
  });
}
