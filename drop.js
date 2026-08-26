import mongoose from 'mongoose';

mongoose.connect('mongodb://webshoppingapp_db_user:nm07uUafSohmbY8s@ac-fmhbczn-shard-00-00.rbrwfde.mongodb.net:27017,ac-fmhbczn-shard-00-01.rbrwfde.mongodb.net:27017,ac-fmhbczn-shard-00-02.rbrwfde.mongodb.net:27017/?ssl=true&replicaSet=atlas-3wgdx9-shard-0&authSource=admin&appName=Cluster0')
.then(async () => {
  const StudentFee = mongoose.model('StudentFee', new mongoose.Schema({}, {strict: false}));
  
  try {
    await StudentFee.collection.dropIndex('studentId_1_feeCategoryId_1_className_1_academicYear_1');
    console.log("Index dropped successfully!");
  } catch (e) {
    console.error("Error dropping index:", e.message);
  }
  
  try {
    await StudentFee.collection.createIndex({ studentId: 1, feeCategoryId: 1, className: 1, academicYear: 1 }, { unique: false });
    console.log("Index recreated as non-unique!");
  } catch (e) {
    console.error("Error recreating index:", e.message);
  }
  
  process.exit(0);
});
