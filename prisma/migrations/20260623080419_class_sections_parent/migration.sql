/*
  Warnings:

  - You are about to drop the column `parentDetails` on the `Application` table. All the data in the column will be lost.
  - You are about to drop the column `parentDetails` on the `Student` table. All the data in the column will be lost.
  - Added the required column `parentMobile` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `parentName` to the `Application` table without a default value. This is not possible if the table is not empty.
  - Added the required column `parentMobile` to the `Student` table without a default value. This is not possible if the table is not empty.
  - Added the required column `parentName` to the `Student` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Application" DROP COLUMN "parentDetails",
ADD COLUMN     "parentMobile" TEXT NOT NULL,
ADD COLUMN     "parentName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Student" DROP COLUMN "parentDetails",
ADD COLUMN     "parentMobile" TEXT NOT NULL,
ADD COLUMN     "parentName" TEXT NOT NULL,
ADD COLUMN     "section" TEXT;

-- CreateTable
CREATE TABLE "Class" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Class_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Section" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Class_name_key" ON "Class"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Section_name_classId_key" ON "Section"("name", "classId");

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE CASCADE ON UPDATE CASCADE;
