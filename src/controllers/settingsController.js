import { getSettingsSnapshot, updateSettingsSnapshot } from '../services/settingsService.js';

export const getSettings = async (req, res) => {
  try {
    const settings = await getSettingsSnapshot();
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Error reading settings' });
  }
};

export const updateSettings = async (req, res) => {
  try {
    const savedSettings = await updateSettingsSnapshot(req.body);
    res.json(savedSettings);
  } catch (error) {
    res.status(500).json({ error: 'Error saving settings' });
  }
};
