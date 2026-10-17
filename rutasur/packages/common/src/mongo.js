import { MongoClient } from 'mongodb';

const URI = process.env.MONGO_URI || 'mongodb://localhost:27017/?directConnection=true';
const NOMBRE_DB = process.env.MONGO_DB || 'rutasur';

export async function conectarMongo() {
  const cliente = new MongoClient(URI);
  await cliente.connect();
  return { cliente, db: cliente.db(NOMBRE_DB) };
}