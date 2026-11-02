// The members' controller.
//
// The handlers live in controllers/member/, one file per job, so no single file has to be read
// top to bottom to change one of them:
//
//   common      what several handlers share: field parsing, ID clashes, registration numbers, schedules
//   read        the member list and one member's page
//   write       create, edit, delete and resign
//   register    the CSV import and the paper register exports
//   profile     the member's own record as the members' area and the statements read it
//   statements  the passbook and statement downloads, and emailing one
//   gate        the members' area sign-in: look a member up, unlock his records
//
// This file only gathers them, so every route and test that requires it keeps working.

const { emailMemberStatement, memberStatement, memberStatementExcel, publicLookupStatement, publicLookupStatementExcel } = require('./member/statements');
const { listMembers, getMember } = require('./member/read');
const { createMember, updateMember, deleteMember, resignMember } = require('./member/write');
const { importMembers, importTemplate, exportMembers } = require('./member/register');
const { publicLookup, unlockRecords } = require('./member/gate');

module.exports = {
  emailMemberStatement,
  listMembers,
  getMember,
  createMember,
  updateMember,
  deleteMember,
  resignMember,
  importMembers,
  importTemplate,
  exportMembers,
  memberStatement,
  memberStatementExcel,
  publicLookup,
  unlockRecords,
  publicLookupStatement,
  publicLookupStatementExcel,
};
