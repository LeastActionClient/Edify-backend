import app, { dbReady } from '../src/app.js';

export default async function handler(req, res) {
  await dbReady;
  return app(req, res);
}
