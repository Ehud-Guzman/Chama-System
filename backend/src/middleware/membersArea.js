const { getOrCreateSettings } = require('../utils/settings');

// The members' area on/off switch (Control Room → Switches).
//
// Closes the passbook, the documents, the minutes and the constitution for members — without
// touching the office's side of the app. For the afternoon the register is being corrected, or
// the weeks before an annual meeting when the figures are not final. The group's totals on the
// front page are not behind it: the page still loads and says why.
async function membersAreaOpen(req, res, next) {
  try {
    const settings = await getOrCreateSettings();
    if (settings.membersAreaEnabled === false) {
      return res.status(503).json({
        message:
          'The members’ area is closed for a short while while the books are being checked. Please try again later.',
        code: 'members_area_closed',
      });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { membersAreaOpen };
