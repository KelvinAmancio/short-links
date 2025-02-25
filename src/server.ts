import fastify from 'fastify'
import { z } from 'zod'
import { sql } from './lib/postgres'
import postgres from 'postgres'
import { redis } from './lib/redis'

const app = fastify()

app.get('/:code', async (request, reply) => {
    const getLinkSchema = z.object({
        code: z.string().min(3)
    })

    const { code } = getLinkSchema.parse(request.params)

    try {
        const result = await sql/* sql */ `
            SELECT id, original_url FROM short_links WHERE code = ${code}
        `

        if (result.length === 0) {
            return reply.status(400).send({ message: 'Link not found.' })
        }

        const link = result[0]

        await redis.zIncrBy('metrics', 1, String(link.id))

        return reply.redirect(301, link.original_url)
    } catch (error) {
        console.error(error)
        return reply.status(500).send({ message: 'Internal Error.' })
    }
})

app.get('/api/links', async (_, reply) => {
    try {
        const result = await sql/* sql */ `
            SELECT * FROM short_links ORDER BY id DESC
        `
        return result
    } catch (error) {
        console.error(error)
        return reply.status(500).send({ message: 'Internal Error.' })
    }
})

app.post('/api/links', async (request, reply) => {
    const createLinkSchema = z.object({
        code: z.string().min(3),
        url: z.string().url()
    })

    const { code, url } = createLinkSchema.parse(request.body)

    try {
        const result = await sql/* sql */ `
            INSERT INTO short_links (code, original_url)
            VALUES(${code}, ${url})
            RETURNING id
        `

        const link = result[0]

        return reply.status(201).send({ shortLinkId: link.id })
    } catch (error) {
        if (error instanceof postgres.PostgresError) {
            if (error.code === '23505') {
                return reply.status(400).send({ message: 'Duplicated code.' })
            }
        }

        console.error(error)

        return reply.status(500).send({ message: 'Internal Error.' })
    }
})

app.get('/api/metrics', async (request, reply) => {
    try {
        const result = await redis.zRangeByScoreWithScores('metrics', 0, 50)

        const metrics = result
            .sort((a, b) => b.score - a.score)
            .map(item => {
                return {
                    shortLinkId: Number(item.value),
                    clicks: item.score
                }
            })

        return metrics
    } catch (error) {
        console.error(error)
        return reply.status(500).send({ message: 'Internal Error.' })
    }
})

app.listen({ port: 3333 }).then(() => {
    console.log('server running!')
})
