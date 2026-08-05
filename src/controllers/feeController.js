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
      .select('name isEnabled mandatory isStockItem currentStock topStock bottomStock createdAt updatedAt')
      .sort({ name: 1 })
      .lean();
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching fee categories' });
  }
};

export const createFeeCategory = async (req, res) => {
  try {
    const { name, isEnabled, mandatory, isStockItem, initialStock, currentStock, topStock, bottomStock } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Category Name is required.' });
    }

    const trimmedName = name.trim();
    const existing = await FeeCategory.findOne({ name: { $regex: new RegExp(`^${trimmedName}$`, 'i') } });
    if (existing) {
      return res.status(400).json({ error: 'A fee category with this name already exists. Please choose a different name.' });
    }

    const isUniform = trimmedName.toLowerCase() === 'uniform';
    let parsedStock = 0;
    let parsedTopStock = 0;
    let parsedBottomStock = 0;

    if (isStockItem) {
      if (isUniform) {
        parsedTopStock = parseFloat(topStock);
        parsedBottomStock = parseFloat(bottomStock);
        if (isNaN(parsedTopStock) || parsedTopStock < 0 || isNaN(parsedBottomStock) || parsedBottomStock < 0) {
          return res.status(400).json({ error: 'Top and Bottom Stock must be positive numbers.' });
        }
      } else {
        const stockInput = currentStock !== undefined ? currentStock : initialStock;
        parsedStock = parseInt(stockInput, 10);
        if (isNaN(parsedStock) || parsedStock < 0) {
          return res.status(400).json({ error: 'Initial Stock must be a positive whole number.' });
        }
      }
    }

    const category = await FeeCategory.create({ 
      name: trimmedName, 
      isEnabled: isEnabled ?? true, 
      mandatory: mandatory ?? false,
      isStockItem: !!isStockItem,
      currentStock: (isStockItem && !isUniform) ? parsedStock : 0,
      topStock: (isStockItem && isUniform) ? parsedTopStock : 0,
      bottomStock: (isStockItem && isUniform) ? parsedBottomStock : 0
    });

    if (isStockItem) {
      if (isUniform) {
        if (parsedTopStock > 0 || parsedBottomStock > 0) {
          await StockHistory.create({
            categoryId: category._id,
            categoryName: category.name,
            previousStock: 0,
            updatedStock: parsedTopStock + parsedBottomStock,
            difference: parsedTopStock + parsedBottomStock,
            action: 'INITIAL_STOCK_CREATION',
            updatedBy: req.user?.id
          });
        }
      } else if (parsedStock > 0) {
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
    const { name, isEnabled, mandatory, isStockItem, currentStock, updatedStock, topStock, bottomStock, updatedTopStock, updatedBottomStock } = req.body;

    const existingCat = await FeeCategory.findById(id);
    if (!existingCat) {
      return res.status(404).json({ error: 'Fee category not found' });
    }

    let finalName = existingCat.name;
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
      finalName = trimmedName;
    }

    const isUniform = finalName.toLowerCase() === 'uniform';
    let targetStock = existingCat.currentStock || 0;
    let targetTopStock = existingCat.topStock || 0;
    let targetBottomStock = existingCat.bottomStock || 0;
    const nextIsStockItem = isStockItem !== undefined ? !!isStockItem : existingCat.isStockItem;

    if (nextIsStockItem) {
      if (isUniform) {
        const topInput = updatedTopStock !== undefined ? updatedTopStock : (topStock !== undefined ? topStock : existingCat.topStock);
        const bottomInput = updatedBottomStock !== undefined ? updatedBottomStock : (bottomStock !== undefined ? bottomStock : existingCat.bottomStock);
        targetTopStock = parseFloat(topInput);
        targetBottomStock = parseFloat(bottomInput);
        if (isNaN(targetTopStock) || targetTopStock < 0 || isNaN(targetBottomStock) || targetBottomStock < 0) {
          return res.status(400).json({ error: 'Top and Bottom Stock must be positive numbers.' });
        }
      } else {
        const stockInput = updatedStock !== undefined ? updatedStock : (currentStock !== undefined ? currentStock : existingCat.currentStock);
        targetStock = parseInt(stockInput, 10);
        if (isNaN(targetStock) || targetStock < 0) {
          return res.status(400).json({ error: 'Stock must be a positive whole number.' });
        }
      }
    } else {
      targetStock = 0;
      targetTopStock = 0;
      targetBottomStock = 0;
    }

    const prevStock = existingCat.currentStock || 0;
    const prevTopStock = existingCat.topStock || 0;
    const prevBottomStock = existingCat.bottomStock || 0;

    let stockChanged = false;

    if (isUniform) {
      stockChanged = nextIsStockItem && (targetTopStock !== prevTopStock || targetBottomStock !== prevBottomStock);
    } else {
      stockChanged = nextIsStockItem && targetStock !== prevStock;
    }

    existingCat.name = finalName;
    existingCat.isEnabled = isEnabled !== undefined ? isEnabled : existingCat.isEnabled;
    existingCat.mandatory = mandatory !== undefined ? mandatory : existingCat.mandatory;
    existingCat.isStockItem = nextIsStockItem;
    existingCat.currentStock = isUniform ? 0 : targetStock;
    existingCat.topStock = isUniform ? targetTopStock : 0;
    existingCat.bottomStock = isUniform ? targetBottomStock : 0;

    await existingCat.save();

    if (stockChanged) {
      if (isUniform) {
        await StockHistory.create({
          categoryId: existingCat._id,
          categoryName: existingCat.name,
          previousStock: prevTopStock + prevBottomStock,
          updatedStock: targetTopStock + targetBottomStock,
          difference: (targetTopStock + targetBottomStock) - (prevTopStock + prevBottomStock),
          action: 'MANUAL_CORRECTION',
          updatedBy: req.user?.id
        });
      } else {
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

    const existingFees = await StudentFee.find({ 
      studentId, 
      feeCategoryId, 
      className: student.currentClass,
      academicYear: student.academicYear 
    });

    if (totalAmount !== undefined && parseFloat(totalAmount) <= 0) {
      if (existingFees.length > 0) {
        for (const f of existingFees) {
          if (f.paidAmount > 0) {
            return res.status(400).json({ error: 'Cannot remove fee that has partial payments.' });
          }
        }
        await StudentFee.deleteMany({ 
          studentId, 
          feeCategoryId, 
          className: student.currentClass,
          academicYear: student.academicYear 
        });
        return res.status(200).json({ message: 'Fee removed successfully' });
      } else {
        return res.status(200).json({ message: 'No fee to remove' });
      }
    }

    if (existingFees.length > 0) {
      let studentFee = existingFees[0];
      if (studentFee.academicYear !== student.academicYear || studentFee.className !== student.currentClass) {
        return res.status(400).json({ error: 'Fee record violation: Cannot mutate historical fee record.' });
      }
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

    const students = await Student.find(whereClause)
      .select('_id currentClass section academicYear includedChargesTotal activitiesTotal isRTE RTE')
      .lean();

    const validCategories = await FeeCategory.find()
      .select('_id name mandatory')
      .lean();
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

    const studentIds = students.map((student) => student._id);
    const existingStudentFees = await StudentFee.find({ studentId: { $in: studentIds } })
      .select('_id studentId feeCategoryId totalAmount paidAmount remainingAmount uniformDetails className academicYear')
      .lean();

    const feesByStudent = new Map();
    for (const fee of existingStudentFees) {
      const studentId = fee.studentId.toString();
      if (!feesByStudent.has(studentId)) {
        feesByStudent.set(studentId, []);
      }
      feesByStudent.get(studentId).push(fee);
    }

    const feeOps = [];
    const studentOps = [];
    const assignedCatIds = new Set(Object.keys(feesJson));

    for (const student of students) {
      const isRTEStudent = student.isRTE || student.RTE === 'RTE' || student.RTE === 'Yes' || student.RTE === 'yes';
      if (isRTEStudent) {
        // RTE students do not receive standard class mandatory tuition fees from class bulk assignment
        continue;
      }

      const studentId = student._id;
      const studentIdStr = studentId.toString();
      const allStudentFees = feesByStudent.get(studentIdStr) || [];
      const currentFees = allStudentFees.filter(f => 
        (!f.className || f.className === student.currentClass) &&
        (!f.academicYear || f.academicYear === student.academicYear)
      );

      const feesByCategory = new Map();
      const finalFeesById = new Map();
      const deletedFeeIds = new Set();

      for (const fee of currentFees) {
        finalFeesById.set(fee._id.toString(), { ...fee });
        const catIdStr = fee.feeCategoryId.toString();
        if (!feesByCategory.has(catIdStr)) {
          feesByCategory.set(catIdStr, []);
        }
        feesByCategory.get(catIdStr).push(fee);
      }

      const queueDeleteFee = (feeId) => {
        const feeIdStr = feeId.toString();
        if (deletedFeeIds.has(feeIdStr)) return;
        deletedFeeIds.add(feeIdStr);
        finalFeesById.delete(feeIdStr);
        feeOps.push({
          deleteOne: {
            filter: { _id: feeId }
          }
        });
      };

      for (const catId of Object.keys(feesJson)) {
        const cat = validCatMap.get(catId);
        if (!cat) continue;

        const catKey = catId.toString();
        const existingList = feesByCategory.get(catKey) || [];
        const existing = existingList[0];
        let amount = 0;

        if (cat.name.toLowerCase() === 'uniform') {
          const pricing = feesJson[catId]?.pricing || {};
          const topPrice = parseFloat(pricing.topPerMetre || 0);
          const bottomPrice = parseFloat(pricing.bottomPerMetre || 0);
          const topLen = parseFloat(existing?.uniformDetails?.topLength || 0);
          const bottomLen = parseFloat(existing?.uniformDetails?.bottomLength || 0);
          amount = (topLen * topPrice) + (bottomLen * bottomPrice);
        } else {
          const feeConfig = feesJson[catId];
          amount = typeof feeConfig === 'number' ? feeConfig : parseFloat(feeConfig?.amount || 0);
        }

        if (existing) {
          const existingId = existing._id.toString();
          if ((existing.paidAmount || 0) === 0) {
            feeOps.push({
              updateOne: {
                filter: { _id: existing._id },
                update: {
                  $set: {
                    totalAmount: amount,
                    remainingAmount: Math.max(0, amount - (existing.paidAmount || 0))
                  }
                }
              }
            });
            const finalFee = finalFeesById.get(existingId);
            if (finalFee) {
              finalFee.totalAmount = amount;
              finalFee.remainingAmount = Math.max(0, amount - (existing.paidAmount || 0));
            }
          }
        } else if (amount > 0 && cat.mandatory) {
          // ONLY create new StudentFee records for MANDATORY fee categories!
          // Optional (non-mandatory) categories must NOT be automatically assigned to students when assigning class default fees.
          const newFee = {
            studentId,
            feeCategoryId: cat._id,
            totalAmount: amount,
            remainingAmount: amount,
            paidAmount: 0,
            className: student.currentClass,
            academicYear: student.academicYear
          };
          feeOps.push({
            insertOne: {
              document: newFee
            }
          });
          finalFeesById.set(`new-${studentIdStr}-${catKey}`, newFee);
        }

        for (const extra of existingList.slice(1)) {
          if ((extra.paidAmount || 0) === 0) {
            queueDeleteFee(extra._id);
          }
        }
      }

      for (const existing of currentFees) {
        const catIdStr = existing.feeCategoryId.toString();
        if (!assignedCatIds.has(catIdStr) && (existing.paidAmount || 0) === 0) {
          queueDeleteFee(existing._id);
        }
      }

      const finalFees = Array.from(finalFeesById.values());
      const baseFeeTotal = finalFees.reduce((sum, fee) => {
        const cat = validCatMap.get(fee.feeCategoryId.toString());
        return cat?.mandatory ? sum + (fee.totalAmount || 0) : sum;
      }, 0);
      const grandTotal = finalFees.reduce((sum, fee) => sum + (fee.totalAmount || 0), 0)
        + (student.includedChargesTotal || 0)
        + (student.activitiesTotal || 0);

      studentOps.push({
        updateOne: {
          filter: { _id: studentId },
          update: {
            $set: {
              baseFee: baseFeeTotal,
              grandTotal
            }
          }
        }
      });
    }

    if (feeOps.length > 0) {
      await StudentFee.bulkWrite(feeOps, { ordered: false });
    }

    if (studentOps.length > 0) {
      await Student.bulkWrite(studentOps, { ordered: false });
    }

    res.status(201).json({ message: `Assigned to class successfully` });
  } catch (error) {
    console.error("Error assigning bulk fees", error);
    res.status(500).json({
      error: 'Error assigning fees to class: ' + (error instanceof Error ? error.message : String(error))
    });
  }
};

export const getCategoryStudentAssignments = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { className, section, academicYear, search } = req.query;

    const category = await FeeCategory.findById(categoryId).lean();
    if (!category) {
      return res.status(404).json({ error: 'Fee Category not found' });
    }

    const whereClause = {};
    if (className) whereClause.currentClass = className;
    if (section) whereClause.section = section;
    if (academicYear) whereClause.academicYear = academicYear;

    if (search && search.trim()) {
      const q = search.trim();
      whereClause.$or = [
        { studentName: { $regex: q, $options: 'i' } },
        { admissionNumber: { $regex: q, $options: 'i' } }
      ];
    }

    const students = await Student.find(whereClause)
      .select('_id admissionNumber studentName currentClass section academicYear')
      .sort({ studentName: 1 })
      .lean();

    const studentIds = students.map(s => s._id);
    const existingFees = await StudentFee.find({
      feeCategoryId: categoryId,
      studentId: { $in: studentIds }
    }).lean();

    const feeMap = new Map();
    existingFees.forEach(f => {
      feeMap.set(f.studentId.toString(), f);
    });

    const result = students.map(student => {
      const fee = feeMap.get(student._id.toString());
      return {
        ...student,
        isAssigned: !!fee,
        studentFeeId: fee ? fee._id : null,
        totalAmount: fee ? fee.totalAmount : 0,
        paidAmount: fee ? fee.paidAmount : 0,
        remainingAmount: fee ? fee.remainingAmount : 0
      };
    });

    res.json({ category, students: result });
  } catch (error) {
    console.error('Error fetching category student assignments:', error);
    res.status(500).json({ error: 'Error loading student assignments' });
  }
};

export const assignCategoryToStudents = async (req, res) => {
  try {
    const { feeCategoryId, studentIds, amount } = req.body;
    const feeAmount = parseFloat(amount || 0);

    if (!feeCategoryId || !studentIds || !Array.isArray(studentIds) || studentIds.length === 0 || feeAmount <= 0) {
      return res.status(400).json({ error: 'Please select at least one student and enter a valid fee amount.' });
    }

    const category = await FeeCategory.findById(feeCategoryId);
    if (!category) {
      return res.status(404).json({ error: 'Fee Category not found' });
    }

    const students = await Student.find({ _id: { $in: studentIds } });
    const existingFees = await StudentFee.find({
      feeCategoryId,
      studentId: { $in: studentIds }
    });

    const feeMap = new Map(existingFees.map(f => [f.studentId.toString(), f]));
    const feeOps = [];
    const updatedStudentIds = new Set();
    let skippedPaidCount = 0;

    for (const student of students) {
      const sIdStr = student._id.toString();
      const existing = feeMap.get(sIdStr);

      if (existing) {
        if ((existing.paidAmount || 0) === 0) {
          feeOps.push({
            updateOne: {
              filter: { _id: existing._id },
              update: {
                $set: {
                  totalAmount: feeAmount,
                  remainingAmount: feeAmount
                }
              }
            }
          });
          updatedStudentIds.add(sIdStr);
        } else {
          skippedPaidCount++;
        }
      } else {
        feeOps.push({
          insertOne: {
            document: {
              studentId: student._id,
              feeCategoryId: category._id,
              totalAmount: feeAmount,
              remainingAmount: feeAmount,
              paidAmount: 0,
              className: student.currentClass,
              academicYear: student.academicYear
            }
          }
        });
        updatedStudentIds.add(sIdStr);
      }
    }

    if (feeOps.length > 0) {
      await StudentFee.bulkWrite(feeOps, { ordered: false });
    }

    for (const sId of updatedStudentIds) {
      await recalculateStudentTotals(sId);
    }

    res.status(200).json({
      message: `Assigned ${category.name} (₹${feeAmount}) to ${updatedStudentIds.size} student(s) successfully.${skippedPaidCount > 0 ? ` (${skippedPaidCount} student(s) skipped due to existing payment history)` : ''}`,
      assignedCount: updatedStudentIds.size,
      skippedCount: skippedPaidCount
    });
  } catch (error) {
    console.error('Error assigning category to students:', error);
    res.status(500).json({ error: 'Error assigning fee to students: ' + (error instanceof Error ? error.message : String(error)) });
  }
};

export const removeCategoryStudentAssignment = async (req, res) => {
  try {
    const { studentFeeId } = req.params;
    const feeRecord = await StudentFee.findById(studentFeeId);
    if (!feeRecord) {
      return res.status(404).json({ error: 'Fee assignment record not found.' });
    }

    if ((feeRecord.paidAmount || 0) > 0) {
      return res.status(400).json({ error: 'This fee has payment history and cannot be removed.' });
    }

    const studentId = feeRecord.studentId;
    await StudentFee.findByIdAndDelete(studentFeeId);

    await recalculateStudentTotals(studentId);

    res.status(200).json({ message: 'Fee assignment removed successfully.' });
  } catch (error) {
    console.error('Error removing student fee assignment:', error);
    res.status(500).json({ error: 'Error removing fee assignment.' });
  }
};

export const getRTEStudents = async (req, res) => {
  try {
    const { className, section, academicYear, search } = req.query;

    const whereClause = {
      $or: [
        { isRTE: true },
        { RTE: 'RTE' },
        { RTE: 'Yes' },
        { RTE: 'yes' }
      ]
    };
    if (className) whereClause.currentClass = className;
    if (section) whereClause.section = section;
    if (academicYear) whereClause.academicYear = academicYear;

    if (search && search.trim()) {
      const q = search.trim();
      const searchOr = [
        { studentName: { $regex: q, $options: 'i' } },
        { admissionNumber: { $regex: q, $options: 'i' } }
      ];
      whereClause.$and = [{ $or: searchOr }];
    }

    const students = await Student.find(whereClause)
      .select('_id admissionNumber studentName currentClass section academicYear isRTE RTE status')
      .sort({ studentName: 1 })
      .lean();

    if (students.length === 0) {
      return res.json([]);
    }

    const studentIds = students.map(s => s._id);
    const existingFees = await StudentFee.find({ studentId: { $in: studentIds } })
      .select('studentId feeCategoryId totalAmount remainingAmount paidAmount className academicYear')
      .lean();

    const feesMap = new Map();
    existingFees.forEach(f => {
      const sId = f.studentId.toString();
      if (!feesMap.has(sId)) feesMap.set(sId, []);
      feesMap.get(sId).push({
        feeCategoryId: f.feeCategoryId.toString(),
        totalAmount: f.totalAmount,
        remainingAmount: f.remainingAmount,
        paidAmount: f.paidAmount
      });
    });

    const result = students.map(s => ({
      ...s,
      studentFees: feesMap.get(s._id.toString()) || []
    }));

    res.json(result);
  } catch (error) {
    console.error('Error fetching RTE students:', error);
    res.status(500).json({ error: 'Error loading RTE students' });
  }
};

export const assignRTEStudentsFees = async (req, res) => {
  try {
    const { studentIds, categoryAmounts } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one RTE student.' });
    }

    if (!categoryAmounts || !Array.isArray(categoryAmounts) || categoryAmounts.length === 0) {
      return res.status(400).json({ error: 'Please select at least one fee category.' });
    }

    const validCategoryAmounts = categoryAmounts.filter(ca => ca.feeCategoryId && parseFloat(ca.amount || 0) > 0);
    if (validCategoryAmounts.length === 0) {
      return res.status(400).json({ error: 'Please enter a valid amount greater than 0 for all selected fee categories.' });
    }

    const students = await Student.find({
      _id: { $in: studentIds },
      $or: [
        { isRTE: true },
        { RTE: 'RTE' },
        { RTE: 'Yes' },
        { RTE: 'yes' }
      ]
    });
    if (students.length === 0) {
      return res.status(404).json({ error: 'No matching RTE students found.' });
    }

    const catIds = validCategoryAmounts.map(ca => ca.feeCategoryId);
    const categories = await FeeCategory.find({ _id: { $in: catIds } });
    const catMap = new Map(categories.map(c => [c._id.toString(), c]));

    const existingFees = await StudentFee.find({
      studentId: { $in: studentIds },
      feeCategoryId: { $in: catIds }
    });

    const feeMap = new Map();
    existingFees.forEach(f => {
      const key = `${f.studentId.toString()}_${f.feeCategoryId.toString()}`;
      feeMap.set(key, f);
    });

    const feeOps = [];
    const updatedStudentIds = new Set();
    let skippedPaidCount = 0;

    for (const student of students) {
      const sIdStr = student._id.toString();
      for (const ca of validCategoryAmounts) {
        const catIdStr = ca.feeCategoryId.toString();
        const category = catMap.get(catIdStr);
        if (!category) continue;

        const feeAmount = parseFloat(ca.amount);
        const key = `${sIdStr}_${catIdStr}`;
        const existing = feeMap.get(key);

        if (existing) {
          if ((existing.paidAmount || 0) === 0) {
            feeOps.push({
              updateOne: {
                filter: { _id: existing._id },
                update: {
                  $set: {
                    totalAmount: feeAmount,
                    remainingAmount: feeAmount
                  }
                }
              }
            });
            updatedStudentIds.add(sIdStr);
          } else {
            skippedPaidCount++;
          }
        } else {
          feeOps.push({
            insertOne: {
              document: {
                studentId: student._id,
                feeCategoryId: category._id,
                totalAmount: feeAmount,
                remainingAmount: feeAmount,
                paidAmount: 0,
                className: student.currentClass,
                academicYear: student.academicYear
              }
            }
          });
          updatedStudentIds.add(sIdStr);
        }
      }
    }

    if (feeOps.length > 0) {
      await StudentFee.bulkWrite(feeOps, { ordered: false });
    }

    // For RTE students, automatically clean up any unpaid class default mandatory fees that were not explicitly assigned via Assign RTE Students
    const assignedCatIds = validCategoryAmounts.map(ca => ca.feeCategoryId);
    await StudentFee.deleteMany({
      studentId: { $in: studentIds },
      feeCategoryId: { $nin: assignedCatIds },
      paidAmount: 0
    });

    for (const sId of studentIds) {
      await recalculateStudentTotals(sId);
    }

    res.status(200).json({
      message: `Assigned selected fee categories to ${updatedStudentIds.size} RTE student(s) successfully.${skippedPaidCount > 0 ? ` (${skippedPaidCount} fee assignment(s) skipped due to existing payment history)` : ''}`,
      assignedStudentsCount: updatedStudentIds.size,
      skippedCount: skippedPaidCount
    });
  } catch (error) {
    console.error('Error assigning fees to RTE students:', error);
    res.status(500).json({ error: 'Error assigning fees to RTE students: ' + (error instanceof Error ? error.message : String(error)) });
  }
};

export const getStudentsForFeeAssignment = async (req, res) => {
  try {
    const { className, section, academicYear, search, studentStatus, rteType } = req.query;

    const whereClause = {};
    if (className) whereClause.currentClass = className;
    if (section) whereClause.section = section;
    if (academicYear) whereClause.academicYear = academicYear;
    if (studentStatus && studentStatus !== 'all') {
      whereClause.studentStatus = { $regex: new RegExp(`^${studentStatus.trim()}$`, 'i') };
    }

    if (rteType === 'RTE') {
      whereClause.$or = [
        { isRTE: true },
        { RTE: 'RTE' },
        { RTE: 'Yes' },
        { RTE: 'yes' }
      ];
    } else if (rteType === 'General') {
      whereClause.$and = [
        { isRTE: { $ne: true } },
        { RTE: { $nin: ['RTE', 'Yes', 'yes'] } }
      ];
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchOr = [
        { studentName: { $regex: q, $options: 'i' } },
        { admissionNumber: { $regex: q, $options: 'i' } }
      ];
      if (whereClause.$or) {
        const existingOr = whereClause.$or;
        delete whereClause.$or;
        whereClause.$and = whereClause.$and || [];
        whereClause.$and.push({ $or: existingOr }, { $or: searchOr });
      } else if (whereClause.$and) {
        whereClause.$and.push({ $or: searchOr });
      } else {
        whereClause.$or = searchOr;
      }
    }

    const students = await Student.find(whereClause)
      .select('_id admissionNumber studentName currentClass section academicYear RTE isRTE studentStatus')
      .sort({ studentName: 1 })
      .lean();

    const result = students.map(s => {
      const isRTE = s.isRTE || s.RTE === 'RTE' || s.RTE === 'Yes' || s.RTE === 'yes';
      return {
        _id: s._id,
        admissionNumber: s.admissionNumber,
        studentName: s.studentName,
        currentClass: s.currentClass,
        section: s.section || 'A',
        academicYear: s.academicYear || '',
        courseType: isRTE ? 'RTE' : 'General',
        studentStatus: s.studentStatus || 'Active'
      };
    });

    res.json(result);
  } catch (error) {
    console.error('Error fetching students for fee assignment:', error);
    res.status(500).json({ error: 'Error fetching students for fee assignment' });
  }
};

export const assignMultipleCategoriesToStudents = async (req, res) => {
  try {
    const { categoryAmounts, studentIds } = req.body;

    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one student.' });
    }

    if (!categoryAmounts || !Array.isArray(categoryAmounts) || categoryAmounts.length === 0) {
      return res.status(400).json({ error: 'Please select at least one fee category.' });
    }

    const validCategoryAmounts = categoryAmounts.filter(ca => ca.feeCategoryId && parseFloat(ca.amount || 0) > 0);
    if (validCategoryAmounts.length === 0) {
      return res.status(400).json({ error: 'Please enter a valid amount greater than 0 for all selected fee categories.' });
    }

    const students = await Student.find({ _id: { $in: studentIds } });
    if (students.length === 0) {
      return res.status(404).json({ error: 'No matching students found.' });
    }

    const catIds = validCategoryAmounts.map(ca => ca.feeCategoryId);
    const categories = await FeeCategory.find({ _id: { $in: catIds } });
    const catMap = new Map(categories.map(c => [c._id.toString(), c]));

    const existingFees = await StudentFee.find({
      studentId: { $in: studentIds },
      feeCategoryId: { $in: catIds }
    });

    const feeMap = new Map();
    existingFees.forEach(f => {
      const key = `${f.studentId.toString()}_${f.feeCategoryId.toString()}_${f.className || ''}`;
      feeMap.set(key, f);
    });

    const feeOps = [];
    const modifiedStudentIds = new Set();
    let duplicatesSkipped = 0;
    let assignmentsCreated = 0;

    for (const student of students) {
      const sIdStr = student._id.toString();
      for (const ca of validCategoryAmounts) {
        const catIdStr = ca.feeCategoryId.toString();
        const category = catMap.get(catIdStr);
        if (!category) continue;

        const feeAmount = parseFloat(ca.amount);
        const currentClassKey = `${sIdStr}_${catIdStr}_${student.currentClass || ''}`;
        const emptyClassKey = `${sIdStr}_${catIdStr}_`;
        const existing = feeMap.get(currentClassKey) || feeMap.get(emptyClassKey);

        if (existing) {
          if ((existing.paidAmount || 0) === 0) {
            feeOps.push({
              updateOne: {
                filter: { _id: existing._id },
                update: {
                  $set: {
                    totalAmount: feeAmount,
                    remainingAmount: feeAmount,
                    className: student.currentClass,
                    academicYear: student.academicYear
                  }
                }
              }
            });
            assignmentsCreated++;
            modifiedStudentIds.add(sIdStr);
          } else {
            duplicatesSkipped++;
          }
        } else {
          feeOps.push({
            insertOne: {
              document: {
                studentId: student._id,
                feeCategoryId: category._id,
                totalAmount: feeAmount,
                remainingAmount: feeAmount,
                paidAmount: 0,
                className: student.currentClass,
                academicYear: student.academicYear
              }
            }
          });
          assignmentsCreated++;
          modifiedStudentIds.add(sIdStr);
        }
      }
    }

    if (feeOps.length > 0) {
      await StudentFee.bulkWrite(feeOps, { ordered: false });
    }

    for (const sId of modifiedStudentIds) {
      await recalculateStudentTotals(sId);
    }

    res.status(200).json({
      studentsProcessed: students.length,
      assignmentsCreated,
      duplicatesSkipped,
      message: `Successfully processed ${students.length} student(s): ${assignmentsCreated} assignment(s) created, ${duplicatesSkipped} duplicate(s) skipped.`
    });
  } catch (error) {
    console.error('Error assigning multiple categories to students:', error);
    res.status(500).json({ error: 'Error assigning categories: ' + (error instanceof Error ? error.message : String(error)) });
  }
};

