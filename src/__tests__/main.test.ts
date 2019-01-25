import { container, DbContext } from './fixture/db' // eslint-disable-line no-unused-vars
import { createPool } from './fixture/client'
import { createServer, Server } from 'http' // eslint-disable-line no-unused-vars
import { freeport } from './fixture/freeport'
import { PgMutationUpsertPlugin } from '../postgraphile-upsert'
import { Pool } from 'pg' // eslint-disable-line no-unused-vars
import { postgraphile } from 'postgraphile'
import ava, { TestInterface } from 'ava' // eslint-disable-line no-unused-vars
import bluebird from 'bluebird'
import nanographql = require('nanographql')

const fetch = require('node-fetch')

const test = ava as TestInterface<
  DbContext & {
    client: Pool
    server: Server
    serverPort: number
  }
>

test.beforeEach(async t => {
  await container.setup(t.context)
  await bluebird.delay(5000)
  t.context.client = await createPool(t.context.dbConfig)
  t.context.client.on('error', err => {}) // eslint-disable-line
  await t.context.client.query(`
create table bikes (
  id serial PRIMARY KEY,
  "serialNumber" varchar UNIQUE NOT NULL,
  weight real,
  make varchar,
  model varchar
)
  `)

  await postgraphile(t.context.client, 'public', {
    appendPlugins: [PgMutationUpsertPlugin],
    exportGqlSchemaPath: './postgraphile.graphql'
  })

  const middleware = postgraphile(t.context.client, 'public', {
    graphiql: true,
    appendPlugins: [PgMutationUpsertPlugin]
  })
  const serverPort = await freeport()
  t.context.serverPort = serverPort
  t.context.server = createServer(middleware).listen(serverPort)
})

test.afterEach(async t => {
  t.context.client.end()
  t.context.server.close()
  await container.teardown(t.context)
})

const exec = async (t, query) => {
  const res = await fetch(`http://localhost:${t.context.serverPort}/graphql`, {
    body: query(),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  })
  return res.json()
}

const all = async t => {
  const query = nanographql`
    query {
      allBikes(orderBy: SERIAL_NUMBER_ASC) {
        edges {
          node {
            id
            serialNumber
            make
            model
          }
        }
      }
    }
  `
  return exec(t, query)
}

const create1 = async t => {
  const query = nanographql`
    mutation {
      upsertBike(where: {
        serialNumber: "abc123"
      }, 
      input: {
        bike: {
          serialNumber: "abc123"
          weight: 25.6
          make: "kona"
          model: "cool-ie deluxe"
        }
      }) {
        clientMutationId
      }
    }
  `
  return exec(t, query)
}

const create2 = async t => {
  const query = nanographql`
    mutation {
      upsertBike(where: {
        serialNumber: "def456"
      }, 
      input: {
        bike: {
          serialNumber: "def456"
          weight: 25.6
          make: "honda"
          model: "unicorn"
        }
      }) {
        clientMutationId
      }
    }
  `
  return exec(t, query)
}

const update = async t => {
  const query = nanographql`
    mutation {
      upsertBike(where: {
        serialNumber: "abc123"
      }, 
      input: {
        bike: {
          serialNumber: "abc123"
          weight: 25.6
          make: "schwinn"
          model: "stingray"
        }
      }) {
        clientMutationId
      }
    }
  `
  return exec(t, query)
}

test('test upsert crud', async t => {
  {
    await create1(t)
    const res = await all(t)
    t.is(res.data.allBikes.edges.length, 1)
    t.is(res.data.allBikes.edges[0].node.make, 'kona')
  }
  {
    await create2(t)
    const res = await all(t)
    t.is(res.data.allBikes.edges.length, 2)
    t.is(res.data.allBikes.edges[0].node.make, 'kona')
    t.is(res.data.allBikes.edges[1].node.make, 'honda')
  }
  {
    await create1(t)
    const res = await all(t)
    t.is(res.data.allBikes.edges.length, 2)
    t.is(res.data.allBikes.edges[0].node.make, 'kona')
    t.is(res.data.allBikes.edges[1].node.make, 'honda')
  }
  {
    await update(t)
    const res = await all(t)
    t.is(res.data.allBikes.edges.length, 2)
    t.is(res.data.allBikes.edges[0].node.make, 'schwinn')
    t.is(res.data.allBikes.edges[1].node.make, 'honda')
  }
})
