const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function clean() {
  await prisma.invoice.deleteMany({});
  await prisma.payment.deleteMany({});
  await prisma.studentFee.deleteMany({});
  await prisma.student.deleteMany({});
  await prisma.application.deleteMany({});
  console.log('Deleted data');
}
clean().finally(() => prisma.$disconnect());
