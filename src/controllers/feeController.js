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
    const { name, isEnabled, mandatory } = req.body;
    const category = await FeeCategory.create({ 
      name, 
      isEnabled: isEnabled ?? true, 
      mandatory: mandatory ?? false 
    });
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: 'Error creating fee category' });
  }
};

export const updateFeeCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isEnabled, mandatory } = req.body;
    const category = await FeeCategory.findByIdAndUpdate(
      id, 
      { name, isEnabled, mandatory: mandatory ?? false }, 
      { new: true }
    );
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

    let studentFee = await StudentFee.findOne({ studentId, feeCategoryId });

    if (studentFee) {
      studentFee = await StudentFee.findByIdAndUpdate(
        studentFee._id,
        {
          totalAmount: parseFloat(totalAmount),
          remainingAmount: parseFloat(totalAmount) - studentFee.paidAmount
        },
        { new: true }
      ).populate('feeCategoryId');
    } else {
      studentFee = await StudentFee.create({
        studentId,
        feeCategoryId,
        totalAmount: parseFloat(totalAmount),
        remainingAmount: parseFloat(totalAmount)
      });
      studentFee = await StudentFee.findById(studentFee._id).populate('feeCategoryId');
    }

    res.status(201).json(studentFee);
  } catch (error) {
    res.status(500).json({ error: 'Error assigning fee to student' });
  }
};

export const assignBulkFee = async (req, res) => {
  try {
    const { className, sectionName, fees } = req.body;

    if (!className || !fees || !Array.isArray(fees)) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    const whereClause = { currentClass: className };
    if (sectionName) {
      whereClause.section = sectionName;
    }

    const students = await Student.find(whereClause);

    const validCategories = await FeeCategory.find();
    const validCatMap = new Map(validCategories.map(c => [c._id.toString(), c]));

    const defaultFeesToSave = fees.filter(f => {
      const cat = validCatMap.get(f.feeCategoryId);
      if (!cat) return false;
      if (cat.name.toLowerCase() === 'uniform') {
        return true;
      }
      return f.amount && parseFloat(f.amount) > 0;
    });

    const feesJson = defaultFeesToSave.reduce((acc, curr) => {
      const cat = validCatMap.get(curr.feeCategoryId);
      if (cat && cat.name.toLowerCase() === 'uniform') {
        acc[curr.feeCategoryId] = {
          categoryId: curr.feeCategoryId,
          categoryName: cat.name,
          assigned: true,
          pricing: {
            topPerMetre: parseFloat(curr.topPerMetre || 0),
            bottomPerMetre: parseFloat(curr.bottomPerMetre || 0)
          }
        };
      } else {
        acc[curr.feeCategoryId] = {
          amount: parseFloat(curr.amount)
        };
      }
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

    // Update students fees dynamically
    for (const student of students) {
      const studentId = student._id;
      const existingStudentFees = await StudentFee.find({ studentId });
      const existingFeeMap = new Map(existingStudentFees.map(f => [f.feeCategoryId.toString(), f]));

      const assignedCatIds = new Set(Object.keys(feesJson));

      // 1. Process categories assigned to the class
      for (const catId of Object.keys(feesJson)) {
        const cat = validCatMap.get(catId);
        if (!cat) continue;

        const isMandatory = cat.mandatory;
        const existing = existingFeeMap.get(catId);
        let amount = 0;
        let uniformDetailsToSave = undefined;

        if (cat.name.toLowerCase() === 'uniform') {
          const pricing = feesJson[catId]?.pricing || {};
          const topPrice = parseFloat(pricing.topPerMetre || 0);
          const bottomPrice = parseFloat(pricing.bottomPerMetre || 0);
          const topLen = parseFloat(existing?.uniformDetails?.topLength || 0);
          const bottomLen = parseFloat(existing?.uniformDetails?.bottomLength || 0);
          amount = (topLen * topPrice) + (bottomLen * bottomPrice);
          uniformDetailsToSave = {
            topLength: topLen,
            bottomLength: bottomLen
          };
        } else {
          const feeConfig = feesJson[catId];
          amount = typeof feeConfig === 'number' ? feeConfig : parseFloat(feeConfig?.amount || 0);
        }

        if (existing) {
          // Update the amount
          existing.totalAmount = amount;
          existing.remainingAmount = Math.max(0, amount - existing.paidAmount);
          if (uniformDetailsToSave) {
            existing.uniformDetails = uniformDetailsToSave;
          }
          await existing.save();
        } else if (isMandatory || cat.name.toLowerCase() === 'uniform') {
          // Create new record only if it is mandatory or uniform
          await StudentFee.create({
            studentId,
            feeCategoryId: catId,
            totalAmount: amount,
            remainingAmount: amount,
            paidAmount: 0,
            uniformDetails: uniformDetailsToSave
          });
        }
      }

      // 2. Remove/Delete categories that are NOT assigned to the class anymore (if they have 0 paidAmount)
      for (const existing of existingStudentFees) {
        const catIdStr = existing.feeCategoryId.toString();
        if (!assignedCatIds.has(catIdStr)) {
          if (existing.paidAmount === 0) {
            await StudentFee.findByIdAndDelete(existing._id);
          }
        }
      }

      // 3. Recalculate baseFee and grandTotal for the student
      const updatedStudentFees = await StudentFee.find({ studentId });
      let baseFeeTotal = 0;
      let grandTotal = 0;

      for (const f of updatedStudentFees) {
        const cat = validCatMap.get(f.feeCategoryId.toString());
        const isMandatory = cat ? cat.mandatory : false;
        const amt = f.totalAmount || 0;

        if (isMandatory) {
          baseFeeTotal += amt;
        }
        grandTotal += amt;
      }

      await Student.findByIdAndUpdate(studentId, {
        baseFee: baseFeeTotal,
        grandTotal: grandTotal
      });
    }

    res.status(201).json({ message: `Assigned to class successfully` });
  } catch (error) {
    console.error("Error assigning bulk fees", error);
    res.status(500).json({
      error: 'Error assigning fees to class: ' + (error instanceof Error ? error.message : String(error))
    });
  }
};
