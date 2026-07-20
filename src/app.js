import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './config/db.js';
import apiRoutes from './routes/index.js';

dotenv.config();

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || process.env.FRONTEND_URL || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean)
  .map((origin) => {
    try {
      return new URL(origin).origin;
    } catch (error) {
      return origin;
    }
  });

const corsOptions = {
  origin: allowedOrigins.length > 0 ? allowedOrigins : true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Kashhuri Billing API is running' });
});
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});
app.use((req, res, next) => {
  if (req.method === 'OPTIONS') {
    return cors(corsOptions)(req, res, next);
  }
  return next();
});
app.use('/api', apiRoutes);

const dbReady = connectDB();

export { dbReady };
export default app;
