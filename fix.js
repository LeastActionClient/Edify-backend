import mongoose from 'mongoose';

mongoose.connect('mongodb://webshoppingapp_db_user:nm07uUafSohmbY8s@ac-fmhbczn-shard-00-00.rbrwfde.mongodb.net:27017,ac-fmhbczn-shard-00-01.rbrwfde.mongodb.net:27017,ac-fmhbczn-shard-00-02.rbrwfde.mongodb.net:27017/?ssl=true&replicaSet=atlas-3wgdx9-shard-0&authSource=admin&appName=Cluster0')
.then(async () => {
  const StudentFee = mongoose.model('StudentFee', new mongoose.Schema({}, {strict: false}));
  
  await StudentFee.updateOne(
    { _id: '6a897d16047db7037ae7405e' },
    { $set: { totalAmount: 200, remainingAmount: 100 } }
  );
  
  console.log("Updated StudentFee!");
  process.exit(0);
});
