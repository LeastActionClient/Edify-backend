import prisma from '../utils/prisma.js';

export const getFeeCategories = async (req, res) => {
  try {
    const categories = await prisma.feeCategory.findMany({
      orderBy: { name: 'asc' }
    });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching fee categories' });
  }
};

export const createFeeCategory = async (req, res) => {
  try {
    const { name, isEnabled } = req.body;
    const category = await prisma.feeCategory.create({
      data: { name, isEnabled: isEnabled ?? true }
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: 'Error creating fee category' });
  }
};

export const updateFeeCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isEnabled } = req.body;
    const category = await prisma.feeCategory.update({
      where: { id: id  },
      data: { name, isEnabled }
    });
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: 'Error updating fee category' });
  }
};

export const deleteFeeCategory = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if category is already linked to any students
    const linkedFees = await prisma.studentFee.findFirst({
      where: { feeCategoryId: id }
    });

    if (linkedFees) {
      return res.status(400).json({ error: 'Cannot delete this category because it is assigned to students.' });
    }

    await prisma.feeCategory.delete({ where: { id: id  } });
    res.json({ message: 'Fee category deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting fee category.' });
  }
};

export const assignFeeToStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { feeCategoryId, totalAmount } = req.body;

    let studentFee = await prisma.studentFee.findFirst({
      where: { studentId, feeCategoryId }
    });

    if (studentFee) {
      studentFee = await prisma.studentFee.update({
        where: { id: studentFee.id },
        data: {
          totalAmount: parseFloat(totalAmount),
          remainingAmount: parseFloat(totalAmount) - studentFee.paidAmount
        },
        include: { feeCategory: true }
      });
    } else {
      studentFee = await prisma.studentFee.create({
        data: {
          studentId,
          feeCategoryId,
          totalAmount: parseFloat(totalAmount),
          remainingAmount: parseFloat(totalAmount)
        },
        include: { feeCategory: true }
      });
    }

    res.status(201).json(studentFee);
  } catch (error) {
    res.status(500).json({ error: 'Error assigning fee to student' });
  }
};

export const assignBulkFee = async (req, res) => {
  try {
    const { className, sectionName, fees } = req.body;

    if (!className || !fees || !Array.isArray(fees) || fees.length === 0) {
      res.status(400).json({ error: 'Missing required fields or empty fees' });
      return;
    }

    const whereClause = { currentClass: className };
    if (sectionName) {
      whereClause.section = sectionName;
    }

    const students = await prisma.student.findMany({
      where: whereClause
    });

    const validCategories = await prisma.feeCategory.findMany();
    const validCatIds = new Set(validCategories.map(c => c.id));

    // Save default fees to Class or Section
    const defaultFeesToSave = fees.filter(f => f.amount && parseFloat(f.amount) > 0 && validCatIds.has(f.feeCategoryId));
    if (defaultFeesToSave.length > 0) {
      const feesJson = defaultFeesToSave.reduce((acc, curr) => {
        acc[curr.feeCategoryId] = parseFloat(curr.amount);
        return acc;
      }, {});

      if (sectionName) {
        await prisma.section.updateMany({
          where: { name: sectionName, class: { name: className } },
          data: { defaultFees: feesJson }
        });
      } else {
        await prisma.class.updateMany({
          where: { name: className },
          data: { defaultFees: feesJson }
        });
      }
    }

    if (students.length === 0) {
      res.status(201).json({ message: 'Saved as default fees (no students in class currently)' });
      return;
    }

    const studentFeesData = [];
    
    students.forEach(student => {
      fees.forEach(fee => {
        if (fee.amount && parseFloat(fee.amount) > 0) {
          if (!validCatIds.has(fee.feeCategoryId)) {
            return; // Skip invalid categories
          }
          studentFeesData.push({
            studentId: student.id,
            feeCategoryId: fee.feeCategoryId,
            totalAmount: parseFloat(fee.amount),
            remainingAmount: parseFloat(fee.amount)
          });
        }
      });
    });

    if (studentFeesData.length === 0) {
      res.status(400).json({ error: 'No valid fee amounts provided or invalid categories' });
      return;
    }

    await prisma.$transaction(
      studentFeesData.map(data => 
        prisma.studentFee.create({ data })
      )
    );

    res.status(201).json({ message: `Assigned to class successfully` });
  } catch (error) {
    console.error("Error assigning bulk fees", error);
    res.status(500).json({ 
      error: 'Error assigning fees to class: ' + (error instanceof Error ? error.message : String(error))
    });
  }
};
