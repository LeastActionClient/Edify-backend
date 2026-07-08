import prisma from '../utils/prisma.js';

export const getClasses = async (req, res) => {
  try {
    const classes = await prisma.class.findMany({
      include: {
        sections: true
      },
      orderBy: { name: 'asc' }
    });
    res.json(classes);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching classes' });
  }
};

export const createClass = async (req, res) => {
  try {
    const { name } = req.body;
    
    const existing = await prisma.class.findUnique({ where: { name } });
    if (existing) {
      res.status(400).json({ error: 'Class already exists' });
      return;
    }

    const newClass = await prisma.class.create({
      data: { name }
    });
    
    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATED_CLASS',
        details: `Class ${name} created`
      }
    });

    res.status(201).json(newClass);
  } catch (error) {
    res.status(500).json({ error: 'Error creating class' });
  }
};

export const createSection = async (req, res) => {
  try {
    const classId = req.params.classId ;
    const { name } = req.body;

    const existingClass = await prisma.class.findUnique({ where: { id: classId } });
    if (!existingClass) {
      res.status(404).json({ error: 'Class not found' });
      return;
    }

    const existingSection = await prisma.section.findUnique({
      where: {
        name_classId: { name, classId }
      }
    });

    if (existingSection) {
      res.status(400).json({ error: 'Section already exists in this class' });
      return;
    }

    const section = await prisma.section.create({
      data: { name, classId }
    });

    await prisma.activityLog.create({
      data: {
        userId: req.user.id,
        action: 'CREATED_SECTION',
        details: `Section ${name} created in Class ${existingClass.name}`
      }
    });

    res.status(201).json(section);
  } catch (error) {
    res.status(500).json({ error: 'Error creating section' });
  }
};
