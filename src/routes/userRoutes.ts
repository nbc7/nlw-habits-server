import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { prisma } from '../lib/prisma';

export async function userRoutes(app: FastifyInstance) {
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
