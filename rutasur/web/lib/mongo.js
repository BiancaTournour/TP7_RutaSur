// El frontend SOLO lee de MongoDB. Nunca consume Kafka.
import { MongoClient } from 'mongodb';

const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/rutasur?directConnection=true';

export async function getDb() {
  if (!globalThis.__mongoPromise) {
    globalThis.__mongoPromise = new MongoClient(uri, { serverSelectionTimeoutMS: 10000 })
      .connect()
      .catch((error) => {
        globalThis.__mongoPromise = null; // permite reintentar en el proximo request
        throw error;
      });
  }
  const client = await globalThis.__mongoPromise;
  return client.db(process.env.MONGO_DB || 'rutasur');
}
