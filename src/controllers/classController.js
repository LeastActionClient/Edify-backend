import { Class, Section, Student, ActivityLog } from '../models/index.js';
import { compareClassNames } from '../utils/classOrder.js';

export const getClasses = async (req, res) => {
  try {
    const classes = await Class.find()
      .select('name defaultFees createdAt updatedAt')
      .lean();

    const classIds = classes.map((c) => c._id);
    const sections = classIds.length > 0
      ? await Section.find({ classId: { $in: classIds } })
        .select('name classId defaultFees createdAt updatedAt')
        .sort({ name: 1 })
        .lean()
      : [];

    const sectionsByClass = {};
    sections.forEach(s => {
      const key = s.classId.toString();
      if (!sectionsByClass[key]) sectionsByClass[key] = [];
      sectionsByClass[key].push(s);
    });

    const sortedClasses = classes.map((c) => ({
      ...c,
      sections: sectionsByClass[c._id.toString()] || []
    })).sort((x, y) => compareClassNames(x.name, y.name));

    res.json(sortedClasses);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching classes' });
  }
};

export const createClass = async (req, res) => {
  try {
    const { name } = req.body;
    
    const existing = await Class.findOne({ name });
    if (existing) {
      res.status(400).json({ error: 'Class already exists' });
      return;
    }

    const newClass = await Class.create({ name });
    
    await ActivityLog.create({
      userId: req.user.id,
      action: 'CREATED_CLASS',
      details: `Class ${name} created`
    });

    res.status(201).json(newClass);
  } catch (error) {
    res.status(500).json({ error: 'Error creating class' });
  }
};

export const updateClass = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    const existingClass = await Class.findById(id);
    if (!existingClass) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    if (name !== existingClass.name) {
      const duplicate = await Class.findOne({ name, _id: { $ne: id } });
      if (duplicate) {
        res.status(400).json({ error: 'Class with this name already exists' });
        return;
      }

      const oldName = existingClass.name;
      existingClass.name = name;
      await existingClass.save();

      await Student.updateMany({ currentClass: oldName }, { currentClass: name });
    }

    await ActivityLog.create({
      userId: req.user.id,
      action: 'UPDATED_CLASS',
      details: `Class ${existingClass.name} updated to ${name}`
    });

    res.json(existingClass);
  } catch (error) {
    res.status(500).json({ error: 'Error updating class' });
  }
};

export const deleteClass = async (req, res) => {
  try {
    const { id } = req.params;

    const existingClass = await Class.findById(id);
    if (!existingClass) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const studentCount = await Student.countDocuments({ currentClass: existingClass.name });
    if (studentCount > 0) {
      res.status(400).json({ error: `Cannot delete class. ${studentCount} student(s) are assigned to this class.` });
      return;
    }

    await Section.deleteMany({ classId: id });
    await Class.findByIdAndDelete(id);

    await ActivityLog.create({
      userId: req.user.id,
      action: 'DELETED_CLASS',
      details: `Class ${existingClass.name} deleted`
    });

    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting class' });
  }
};

export const createSection = async (req, res) => {
  try {
    const classId = req.params.classId;
    const { name } = req.body;

    if (name && !/^[a-zA-Z]+$/.test(name)) {
      res.status(400).json({ error: 'Section can contain only alphabetic characters.' });
      return;
    }

    const existingClass = await Class.findById(classId);
    if (!existingClass) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const existingSection = await Section.findOne({ name, classId });

    if (existingSection) {
      res.status(400).json({ error: 'Section already exists in this class' });
      return;
    }

    const section = await Section.create({ name, classId });

    await ActivityLog.create({
      userId: req.user.id,
      action: 'CREATED_SECTION',
      details: `Section ${name} created in Class ${existingClass.name}`
    });

    res.status(201).json(section);
  } catch (error) {
    res.status(500).json({ error: 'Error creating section' });
  }
};

export const updateSection = async (req, res) => {
  try {
    const { classId, sectionId } = req.params;
    const { name } = req.body;

    if (name && !/^[a-zA-Z]+$/.test(name)) {
      res.status(400).json({ error: 'Section can contain only alphabetic characters.' });
      return;
    }

    const existingClass = await Class.findById(classId);
    if (!existingClass) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const section = await Section.findOne({ _id: sectionId, classId });
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    if (name !== section.name) {
      const duplicate = await Section.findOne({ name, classId, _id: { $ne: sectionId } });
      if (duplicate) {
        res.status(400).json({ error: 'Section with this name already exists in this class' });
        return;
      }

      const oldName = section.name;
      section.name = name;
      await section.save();

      await Student.updateMany(
        { currentClass: existingClass.name, section: oldName },
        { section: name }
      );
    }

    await ActivityLog.create({
      userId: req.user.id,
      action: 'UPDATED_SECTION',
      details: `Section ${section.name} updated to ${name} in Class ${existingClass.name}`
    });

    res.json(section);
  } catch (error) {
    res.status(500).json({ error: 'Error updating section' });
  }
};

export const deleteSection = async (req, res) => {
  try {
    const { classId, sectionId } = req.params;
    const existingClass = await Class.findById(classId);
    if (!existingClass) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const section = await Section.findOne({ _id: sectionId, classId });
    if (!section) {
      res.status(404).json({ error: 'Section not found' });
      return;
    }

    const studentCount = await Student.countDocuments({ currentClass: existingClass.name, section: section.name });
    if (studentCount > 0) {
      res.status(400).json({ error: `Cannot delete section. ${studentCount} student(s) are assigned to this section.` });
      return;
    }

    await Section.findByIdAndDelete(sectionId);

    await ActivityLog.create({
      userId: req.user.id,
      action: 'DELETED_SECTION',
      details: `Section ${section.name} deleted from Class ${existingClass.name}`
    });

    res.json({ message: 'Section deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting section' });
  }
};
