import dotenv from 'dotenv';
import connectDB from '../src/utils/db.js';
import mongoose from 'mongoose';
import { getStudents } from '../src/controllers/studentController.js';

dotenv.config();

// Mock Express response
const mockRes = {
  json: (data) => {
    console.log('Total students returned by API:', data.length);
    const withFees = data.filter(s => s.studentFees && s.studentFees.length > 0);
    console.log('Students with populated studentFees in API response:', withFees.length);
    
    if (data.length > 0) {
      console.log('\n=== Sample Student structure from API response ===');
      const sample = data[0];
      console.log('Keys:', Object.keys(sample));
      console.log('studentFees type:', typeof sample.studentFees, Array.isArray(sample.studentFees));
      console.log('currentClassFees type:', typeof sample.currentClassFees, Array.isArray(sample.currentClassFees));
      if (sample.studentFees && sample.studentFees.length > 0) {
        console.log('Sample Fee:', JSON.stringify(sample.studentFees[0], null, 2));
      }
    }
    mongoose.connection.close();
  },
  status: (code) => ({
    json: (err) => {
      console.error('Status:', code, err);
      mongoose.connection.close();
    }
  })
};

async function main() {
  await connectDB();
  await getStudents({}, mockRes);
}

main().catch(err => {
  console.error(err);
  mongoose.connection.close();
});
