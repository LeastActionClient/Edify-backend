import mongoose from 'mongoose';
import { Invoice, Payment, StudentFee, Student, Application } from './src/models/index.js';

async function clean() {
  await Invoice.deleteMany({});
  await Payment.deleteMany({});
  await StudentFee.deleteMany({});
  await Student.deleteMany({});
  await Application.deleteMany({});
  console.log('Deleted data');
}

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/school_project')
  .then(() => clean())
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => mongoose.disconnect());
