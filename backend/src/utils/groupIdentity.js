const { constitutionChapters } = require('../data/constitution');

// The group's vision and mission.
//
// They are Chapter 2 of the group's own constitution — clauses 2.1 and 2.2 — so
// the published edition is the source of truth, and Settings → vision / mission
// exists only as an override for the wording the Assembly revises between
// editions. A blank setting therefore means "print the published clause", never
// "print nothing": a members' page carrying the group's name and a hole where
// its statement should be reads as unfinished.
//
// Resolved here, on the server, so the full constitution stays behind the phone
// gate — the two clauses travel in the public overview because the group's
// vision and mission are meant to be read by anyone; the rest of the document is
// not.
const VISION_CLAUSE = { chapter: 2, id: '2.1' };
const MISSION_CLAUSE = { chapter: 2, id: '2.2' };

function clauseText({ chapter, id }) {
  const found = constitutionChapters
    .find((c) => c.number === chapter)
    ?.clauses.find((clause) => clause.id === id);
  const paragraph = found?.blocks.find((block) => block.type === 'p');
  return paragraph?.text || '';
}

const CONSTITUTION_VISION = clauseText(VISION_CLAUSE);
const CONSTITUTION_MISSION = clauseText(MISSION_CLAUSE);

function visionAndMission(settings) {
  return {
    vision: String(settings?.vision || '').trim() || CONSTITUTION_VISION,
    mission: String(settings?.mission || '').trim() || CONSTITUTION_MISSION,
  };
}

module.exports = { visionAndMission, CONSTITUTION_VISION, CONSTITUTION_MISSION };
