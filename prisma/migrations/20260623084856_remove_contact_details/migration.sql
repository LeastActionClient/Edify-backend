/*
  Warnings:

  - You are about to drop the column `contactDetails` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `contactDetails` on the `Student` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Application" DROP COLUMN "contactDetails";

-- AlterTable
ALTER TABLE "Student" DROP COLUMN "contactDetails";
