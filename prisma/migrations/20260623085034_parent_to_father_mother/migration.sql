/*
  Warnings:

  - You are about to drop the column `parentMobile` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `parentName` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `parentMobile` on the `Student` table. All the data in the column will be lost.
  - You are about to drop the column `parentName` on the `Student` table. All the data in the column will be lost.
  - Added the required column `fatherName` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fatherPhone` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `motherName` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `motherPhone` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fatherName` to the `Student` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fatherPhone` to the `Student` table without a default value. This is not possible if the table is not empty.
  - Added the required column `motherName` to the `Student` table without a default value. This is not possible if the table is not empty.
  - Added the required column `motherPhone` to the `Student` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Application" DROP COLUMN "parentMobile",
DROP COLUMN "parentName",
ADD COLUMN     "fatherName" TEXT NOT NULL,
ADD COLUMN     "fatherPhone" TEXT NOT NULL,
ADD COLUMN     "motherName" TEXT NOT NULL,
ADD COLUMN     "motherPhone" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Student" DROP COLUMN "parentMobile",
DROP COLUMN "parentName",
ADD COLUMN     "fatherName" TEXT NOT NULL,
ADD COLUMN     "fatherPhone" TEXT NOT NULL,
ADD COLUMN     "motherName" TEXT NOT NULL,
ADD COLUMN     "motherPhone" TEXT NOT NULL;
