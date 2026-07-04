const Settings = require('../models/Settings');

// There is only ever one Settings document. Create it with defaults on first read.
async function getOrCreateSettings() {
  let settings = await Settings.findOne();
  if (!settings) settings = await Settings.create({});
  return settings;
}

module.exports = { getOrCreateSettings };
