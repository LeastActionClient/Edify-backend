import app, { dbReady } from '../src/app.js';

export default async function handler(req, res) {
  try {
    await dbReady;
    return app(req, res);
  } catch (error) {
    console.error('API handler error:', error.message);

    if (!res.headersSent) {
      res.status(500).json({
        error: 'Server initialization failed'
      });
    }
  }
}
