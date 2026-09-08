import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import FeeCategory from './src/models/FeeCategory.js';
import IncludedCharge from './src/models/IncludedCharge.js';

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const fees = await FeeCategory.find({}).lean();
  console.log("FeeCategories:", fees.map(f => f.name));
  
  if (IncludedCharge) {
    try {
        const charges = await IncludedCharge.find({}).lean();
        console.log("IncludedCharges:", charges.map(c => c.name));
    } catch(e) {}
  }
  mongoose.disconnect();
}).catch(console.error);
