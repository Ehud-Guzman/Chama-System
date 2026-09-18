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
//
// Callers that have already loaded the constitution (see utils/constitutionData)
// pass the chapters in, so the two clauses come from wherever the text now lives —
// the database row, or the file that seeded it. Passing nothing falls back to the
// bundled file, which is what a first boot has.
const VISION_CLAUSE = { chapter: 2, id: '2.1' };
const MISSION_CLAUSE = { chapter: 2, id: '2.2' };

function bundledChapters() {
  try {
    // eslint-disable-next-line global-require
    return require('../data/constitution').constitutionChapters || [];
  } catch {
    // No bundled file: the text lives in the database now, and any caller that
    // wants these clauses has to have loaded it and passed it in.
    return [];
  }
}

function clauseText({ chapter, id }, chapters) {
  const found = chapters
    .find((c) => c.number === chapter)
    ?.clauses.find((clause) => clause.id === id);
  const paragraph = found?.blocks.find((block) => block.type === 'p');
  return paragraph?.text || '';
}

function visionAndMission(settings, chapters) {
  const source = Array.isArray(chapters) && chapters.length > 0 ? chapters : bundledChapters();
  return {
    vision: String(settings?.vision || '').trim() || clauseText(VISION_CLAUSE, source),
    mission: String(settings?.mission || '').trim() || clauseText(MISSION_CLAUSE, source),
  };
}

module.exports = { visionAndMission };

