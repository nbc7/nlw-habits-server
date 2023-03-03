import Fastify from 'fastify'
import cors from '@fastify/cors'
import { appRoutes } from './routes'

const app = Fastify()

app.register(cors)
app.register(appRoutes)

app.listen({
  port: process.env.PORT ? Number(process.env.PORT) : 8080,
  host: '0.0.0.0'
}).then(()=>{
  console.log('HTTP server running!')
})