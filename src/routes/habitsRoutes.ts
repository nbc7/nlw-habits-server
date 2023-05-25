import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import dayjs from 'dayjs';

import { prisma } from '../lib/prisma';

interface UserHabit {
  created_at: Date;
  id: string;
  title: string;
  userId: string | null;
  weekDays: { week_day: number }[] | number[];
}

export async function habitsRoutes(app: FastifyInstance) {
  app.post('/habits', async (req) => {
    const usernameBody = z.object({ username: z.string() });
    const { username } = usernameBody.parse(req.body);

    let userHabits: UserHabit[] = await prisma.habit.findMany({
      where: {
        user: {
          username: username,
        },
      },
      include: {
        weekDays: {
          select: {
            week_day: true,
          },
        },
      },
    });

    userHabits = userHabits.map((habit) => ({
      ...habit,
      weekDays: habit.weekDays.map((day: any) => day.week_day),
    }));

    return { userHabits };
  });

  app.post('/habits/new', async (request) => {
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
}
