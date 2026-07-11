import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import connectDB from './utils/db.js';
import apiRoutes from './routes/index.js';

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api', apiRoutes);

const dbReady = connectDB();

export { dbReady };
export default app;
