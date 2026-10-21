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

    // Safety check: ensure legacy email_1 index is dropped from users collection
    try {
      const usersCollection = conn.connection.collection('users');
      const indexes = await usersCollection.indexes();
      if (indexes.some((i) => i.name === 'email_1')) {
        await usersCollection.dropIndex('email_1');
        console.log('Dropped legacy email_1 index from users collection');
      }
    } catch (indexErr) {
      // Non-blocking if already dropped or during initialization
    }

    return conn;
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    connectionPromise = null;
    throw error;
  }
};

export default connectDB;
