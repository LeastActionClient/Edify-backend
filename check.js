import mongoose from 'mongoose';

mongoose.connect('mongodb://webshoppingapp_db_user:nm07uUafSohmbY8s@ac-fmhbczn-shard-00-00.rbrwfde.mongodb.net:27017,ac-fmhbczn-shard-00-01.rbrwfde.mongodb.net:27017,ac-fmhbczn-shard-00-02.rbrwfde.mongodb.net:27017/?ssl=true&replicaSet=atlas-3wgdx9-shard-0&authSource=admin&appName=Cluster0')
.then(async () => {
  const Payment = mongoose.model('Payment', new mongoose.Schema({}, {strict: false}));
  const StudentFee = mongoose.model('StudentFee', new mongoose.Schema({}, {strict: false}));
  
  const c = await Payment.findById('6a897d19047db7037ae74092');
  console.log("PAYMENT:", JSON.stringify(c, null, 2));
  
  if (c && c.feeAllocations) {
    const f = await StudentFee.find({ _id: { $in: c.feeAllocations.map(a => a.studentFeeId) } });
    console.log("FEES:", JSON.stringify(f, null, 2));
  }
  process.exit(0);
});
