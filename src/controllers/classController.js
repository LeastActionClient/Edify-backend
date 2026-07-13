import { Class, Section, ActivityLog } from '../models/index.js';

export const getClasses = async (req, res) => {
  try {
    const classes = await Class.find().sort({ name: 1 });
    const classIds = classes.map(c => c._id);
    const sections = await Section.find({ classId: { $in: classIds } });
    const sectionsByClass = {};
    sections.forEach(s => {
      const key = s.classId.toString();
      if (!sectionsByClass[key]) sectionsByClass[key] = [];
      sectionsByClass[key].push(s);
    });
    const result = classes.map(c => {
      const obj = c.toObject();
      obj.sections = sectionsByClass[c._id.toString()] || [];
      return obj;
    });
    res.json(result);
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

export const createSection = async (req, res) => {
  try {
    const classId = req.params.classId;
    const { name } = req.body;

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

export const deleteClass = async (req, res) => {
  try {
    const classId = req.params.classId;
    const existingClass = await Class.findById(classId);
    if (!existingClass) {
      return res.status(404).json({ error: 'Class not found' });
    }

    await Section.deleteMany({ classId });
    await Class.findByIdAndDelete(classId);

    await ActivityLog.create({
      userId: req.user.id,
      action: 'DELETED_CLASS',
      details: `Class ${existingClass.name} and its sections deleted`
    });

    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting class' });
  }
};

export const deleteSection = async (req, res) => {
  try {
    const { classId, sectionId } = req.params;
    
    const section = await Section.findOne({ _id: sectionId, classId });
    if (!section) {
      return res.status(404).json({ error: 'Section not found' });
    }

    const existingClass = await Class.findById(classId);

    await Section.findByIdAndDelete(sectionId);

    await ActivityLog.create({
      userId: req.user.id,
      action: 'DELETED_SECTION',
      details: `Section ${section.name} deleted from Class ${existingClass?.name || classId}`
    });

    res.json({ message: 'Section deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Error deleting section' });
  }
};
