import mongoose from 'mongoose';
import { FeeCategory, StudentFee, Student, Class, Section, StockHistory } from '../models/index.js';

const recalculateStudentTotals = async (studentId) => {
  const student = await Student.findById(studentId);
  if (!student) return;

  const updatedStudentFees = await StudentFee.find({ studentId }).populate('feeCategoryId');
  let baseFeeTotal = 0;
  let grandTotal = 0;

  for (const f of updatedStudentFees) {
    const isMandatory = f.feeCategoryId?.mandatory || false;
    const amt = f.totalAmount || 0;
    if (isMandatory) baseFeeTotal += amt;
    grandTotal += amt;
  }

  grandTotal += (student.includedChargesTotal || 0) + (student.activitiesTotal || 0);

  await Student.findByIdAndUpdate(studentId, {
    baseFee: baseFeeTotal,
    grandTotal: grandTotal
  });
};

export const getFeeCategories = async (req, res) => {
  try {
    const categories = await FeeCategory.find()
      .select('name isEnabled mandatory isStockItem currentStock createdAt updatedAt')
      .sort({ name: 1 })
      .lean();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching fee categories' });
  }
};

export const createFeeCategory = async (req, res) => {
  try {
    const { name, isEnabled, mandatory, isStockItem, initialStock, currentStock } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category Name is required.' });
    }

    const trimmedName = name.trim();
    const existing = await FeeCategory.findOne({ name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } });
    if (existing) {
      return res.status(400).json({ error: 'A fee category with this name already exists. Please choose a different name.' });
    }

    let parsedStock = 0;
    if (isStockItem) {
      const stockInput = currentStock !== undefined ? currentStock : initialStock;
      parsedStock = parseInt(stockInput, 10);
      if (isNaN(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ error: 'Initial Stock must be a positive whole number.' });
      }
    }

    const category = await FeeCategory.create({ 
      name: trimmedName, 
      isEnabled: isEnabled ?? true, 
      mandatory: mandatory ?? false,
      isStockItem: !!isStockItem,
      currentStock: isStockItem ? parsedStock : 0
    });

    if (isStockItem && parsedStock > 0) {
      await StockHistory.create({
        categoryId: category._id,
        categoryName: category.name,
        previousStock: 0,
        updatedStock: parsedStock,
        difference: parsedStock,
        action: 'INITIAL_STOCK_CREATION',
        updatedBy: req.user?.id
      });
    }

    res.status(201).json(category);
  } catch (error) {
    console.error("Error creating fee category", error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'A fee category with this name already exists. Please choose a different name.' });
    }
    res.status(500).json({ error: error.message || 'Error creating fee category' });
  }
};

export const updateFeeCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, isEnabled, mandatory, isStockItem, currentStock, updatedStock } = req.body;

    const existingCat = await FeeCategory.findById(id);
    if (!existingCat) {
      return res.status(404).json({ error: 'Fee category not found' });
    }

    if (name && name.trim()) {
      const trimmedName = name.trim();
      if (trimmedName.toLowerCase() !== existingCat.name.toLowerCase()) {
        const duplicate = await FeeCategory.findOne({
          _id: { $ne: new mongoose.Types.ObjectId(id) },
          name: { $regex: new RegExp(`^${trimmedName.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') }
        });
        if (duplicate) {
          return res.status(400).json({ error: 'A fee category with this name already exists. Please choose a different name.' });
        }
      }
    }

    let targetStock = existingCat.currentStock || 0;
    const nextIsStockItem = isStockItem !== undefined ? !!isStockItem : existingCat.isStockItem;

    if (nextIsStockItem) {
      const stockInput = updatedStock !== undefined ? updatedStock : (currentStock !== undefined ? currentStock : existingCat.currentStock);
      targetStock = parseInt(stockInput, 10);
      if (isNaN(targetStock) || targetStock < 0) {
        return res.status(400).json({ error: 'Stock must be a positive whole number.' });
      }
    } else {
      targetStock = 0;
    }

    const prevStock = existingCat.currentStock || 0;
    const stockChanged = nextIsStockItem && targetStock !== prevStock;

    existingCat.name = name !== undefined ? name.trim() : existingCat.name;
    existingCat.isEnabled = isEnabled !== undefined ? isEnabled : existingCat.isEnabled;
    existingCat.mandatory = mandatory !== undefined ? mandatory : existingCat.mandatory;
    existingCat.isStockItem = nextIsStockItem;
    existingCat.currentStock = targetStock;

    await existingCat.save();

    if (stockChanged) {
      const diff = targetStock - prevStock;
      await StockHistory.create({
        categoryId: existingCat._id,
        categoryName: existingCat.name,
        previousStock: prevStock,
        updatedStock: targetStock,
        difference: diff,
        action: 'MANUAL_CORRECTION',
        updatedBy: req.user?.id
      });
    }

    res.json(existingCat);
  } catch (error) {
    console.error("Error updating fee category", error);
    if (error.code === 11000) {
      return res.status(400).json({ error: 'A fee category with this name already exists. Please choose a different name.' });
    }
    res.status(500).json({ error: error.message || 'Error updating fee category' });
  }
};

export const deleteFeeCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const linkedActiveFees = await StudentFee.findOne({ 
      feeCategoryId: id, 
      $or: [ { paidAmount: { $gt: 0 } }, { remainingAmount: { $gt: 0 } } ]
    });

    if (linkedActiveFees) {
      return res.status(400).json({ error: 'Cannot delete this category because there are payments or pending dues associated with it. Please mark it as Inactive instead.' });
    }

    await StudentFee.deleteMany({ feeCategoryId: id });
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

    const catDoc = await FeeCategory.findById(feeCategoryId);

    const existingFees = await StudentFee.find({ studentId, feeCategoryId, className: student.currentClass });

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
      if (studentFee.paidAmount > 0 && Math.abs(studentFee.totalAmount - parseFloat(totalAmount)) > 0.01) {
        return res.status(400).json({ error: 'Cannot modify fee amount because payments have already been recorded for this fee.' });
      }
      studentFee = await StudentFee.findByIdAndUpdate(
        studentFee._id,
        {
          totalAmount: parseFloat(totalAmount),
          remainingAmount: Math.max(0, parseFloat(totalAmount) - studentFee.paidAmount)
        },
        { new: true }
      ).populate('feeCategoryId');
      
      if (existingFees.length > 1) {
        const idsToDelete = existingFees.slice(1).filter(f => f.paidAmount === 0).map(f => f._id);
        if (idsToDelete.length > 0) {
          await StudentFee.deleteMany({ _id: { $in: idsToDelete } });
        }
      }
      
      // Recalculate totals
      await recalculateStudentTotals(studentId);
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
      
      // Recalculate totals
      await recalculateStudentTotals(studentId);
      return res.status(201).json(studentFee);
    }
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

    if (students.length === 0) {
      res.status(201).json({ message: 'Saved as default fees (no students in class currently)' });
      return;
    }

    for (const student of students) {
      const studentId = student._id;
      const existingStudentFees = await StudentFee.find({ studentId });
      const existingFeeMap = new Map(existingStudentFees.map(f => [f.feeCategoryId.toString(), f]));
      const assignedCatIds = new Set(Object.keys(feesJson));

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

        if (isMandatory) {
          if (existing) {
            if ((existing.paidAmount || 0) === 0) {
              existing.totalAmount = amount;
              existing.remainingAmount = amount;
              await existing.save();
            }
          } else if (amount > 0) {
            await StudentFee.create({
              studentId,
              feeCategoryId: catId,
              totalAmount: amount,
              remainingAmount: amount,
              paidAmount: 0,
              className: student.currentClass,
              academicYear: student.academicYear
            });
          }
        }
      }

      for (const existing of existingStudentFees) {
        const catIdStr = existing.feeCategoryId.toString();
        if (!assignedCatIds.has(catIdStr)) {
          if (existing.paidAmount === 0) {
            await StudentFee.findByIdAndDelete(existing._id);
          }
        }
      }

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

      grandTotal += (student.includedChargesTotal || 0) + (student.activitiesTotal || 0);

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
