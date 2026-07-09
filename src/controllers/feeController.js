import { FeeCategory, StudentFee, Student, Class, Section } from '../models/index.js';

export const getFeeCategories = async (req, res) => {
  try {
    const categories = await FeeCategory.find().sort({ name: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching fee categories' });
  }
};

export const createFeeCategory = async (req, res) => {
  try {
    const { name, isEnabled } = req.body;
    const category = await FeeCategory.create({ name, isEnabled: isEnabled ?? true });
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: 'Error creating fee category' });
  }
};

export const updateFeeCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isEnabled } = req.body;
    const category = await FeeCategory.findByIdAndUpdate(id, { name, isEnabled }, { new: true });
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: 'Error updating fee category' });
  }
};

export const deleteFeeCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const linkedFees = await StudentFee.findOne({ feeCategoryId: id });

    if (linkedFees) {
      return res.status(400).json({ error: 'Cannot delete this category because it is assigned to students.' });
    }

    await FeeCategory.findByIdAndDelete(id);
    res.json({ message: 'Fee category deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting fee category.' });
  }
};

export const assignFeeToStudent = async (req, res) => {
  try {
    const { studentId } = req.params;
    const { feeCategoryId, totalAmount } = req.body;

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const existingFees = await StudentFee.find({ studentId, feeCategoryId });

    if (parseFloat(totalAmount) <= 0) {
      if (existingFees.length > 0) {
        for (const f of existingFees) {
          if (f.paidAmount > 0) {
            return res.status(400).json({ error: 'Cannot remove fee that has partial payments.' });
          }
        }
        await StudentFee.deleteMany({ studentId, feeCategoryId });
        return res.status(200).json({ message: 'Fee removed successfully' });
      } else {
        return res.status(200).json({ message: 'No fee to remove' });
      }
    }

    if (existingFees.length > 0) {
      let studentFee = existingFees[0];
      studentFee = await StudentFee.findByIdAndUpdate(
        studentFee._id,
        {
          totalAmount: parseFloat(totalAmount),
          remainingAmount: parseFloat(totalAmount) - studentFee.paidAmount
        },
        { new: true }
      ).populate('feeCategoryId');
      
      if (existingFees.length > 1) {
        const idsToDelete = existingFees.slice(1).map(f => f._id);
        await StudentFee.deleteMany({ _id: { $in: idsToDelete } });
      }
      return res.status(201).json(studentFee);
    } else {
      let studentFee = await StudentFee.create({
        studentId,
        feeCategoryId,
        totalAmount: parseFloat(totalAmount),
        remainingAmount: parseFloat(totalAmount),
        className: student.currentClass,
        academicYear: student.academicYear
      });
      studentFee = await StudentFee.findById(studentFee._id).populate('feeCategoryId');
      return res.status(201).json(studentFee);
    }
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

    const students = await Student.find(whereClause);

    const validCategories = await FeeCategory.find();
    const validCatIds = new Set(validCategories.map(c => c._id.toString()));

    const defaultFeesToSave = fees.filter(f => f.amount && parseFloat(f.amount) > 0 && validCatIds.has(f.feeCategoryId));
    if (defaultFeesToSave.length > 0) {
      const feesJson = defaultFeesToSave.reduce((acc, curr) => {
        acc[curr.feeCategoryId] = parseFloat(curr.amount);
        return acc;
      }, {});

      if (sectionName) {
        const classDoc = await Class.findOne({ name: className });
        if (classDoc) {
          await Section.updateMany(
            { name: sectionName, classId: classDoc._id },
            { defaultFees: feesJson }
          );
        }
      } else {
        await Class.updateOne({ name: className }, { defaultFees: feesJson });
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
            return;
          }
          studentFeesData.push({
            studentId: student._id,
            feeCategoryId: fee.feeCategoryId,
            totalAmount: parseFloat(fee.amount),
            remainingAmount: parseFloat(fee.amount),
            className: className,
            academicYear: student.academicYear || null
          });
        }
      });
    });

    if (studentFeesData.length === 0) {
      res.status(400).json({ error: 'No valid fee amounts provided or invalid categories' });
      return;
    }

    const bulkOperations = studentFeesData.map(data => ({
      updateOne: {
        filter: { studentId: data.studentId, feeCategoryId: data.feeCategoryId },
        update: {
          $set: {
            totalAmount: data.totalAmount,
            remainingAmount: data.remainingAmount
          }
        },
        upsert: true
      }
    }));

    await StudentFee.bulkWrite(bulkOperations);

    res.status(201).json({ message: `Assigned to class successfully` });
  } catch (error) {
    console.error("Error assigning bulk fees", error);
    res.status(500).json({
      error: 'Error assigning fees to class: ' + (error instanceof Error ? error.message : String(error))
    });
  }
};
