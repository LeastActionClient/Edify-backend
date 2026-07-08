import fs from 'fs';
import path from 'path';

const settingsPath = path.join(process.cwd(), 'settings.json');

export const getSettings = (req, res) => {
  try {
    if (!fs.existsSync(settingsPath)) {
      fs.writeFileSync(settingsPath, JSON.stringify({}));
    }
    const data = fs.readFileSync(settingsPath, 'utf8');
    res.json(JSON.parse(data));
  } catch (error) {
    res.status(500).json({ error: 'Error reading settings' });
  }
};

export const updateSettings = (req, res) => {
  try {
    const newSettings = req.body;
    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
    res.json(newSettings);
  } catch (error) {
    res.status(500).json({ error: 'Error saving settings' });
  }
};
