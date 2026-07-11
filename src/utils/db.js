import mongoose from 'mongoose';

let connectionPromise = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (connectionPromise) {
    return connectionPromise;
  }

  try {
    const uri = process.env.MONGODB_URI;

    if (!uri) {
      throw new Error('MONGODB_URI is not set');
    }

    connectionPromise = mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000
    });

    const conn = await connectionPromise;
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    connectionPromise = null;
    throw error;
  }
};

export default connectDB;
