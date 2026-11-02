// The members' controller, part: write. controllers/memberController.js is the index the routes use.

const Member = require('../../models/Member');
const Fine = require('../../models/Fine');
const Expense = require('../../models/Expense');
const { normalizePhone } = require('../../utils/phone');
const { cleanEmail, isValidEmail } = require('../../utils/mailer');
const { nextOfKinList, nextOfKinListError } = require('../../utils/nextOfKin');
const { logAudit, snapshot } = require('../../utils/auditLogger');
const { credentialChangeRefused } = require('../../utils/memberCredentials');
const { destroyImage } = require('../../utils/cloudinary');
const { memberLedgerNow } = require('../../utils/memberMoney');
const { readMoney } = require('../../utils/money');
const { activeLoanOwedBy } = require('../loanController');
const { withOptionalTransaction } = require('../../utils/fineAllocation');
const { detailsFromBody, idClashMessage, nationalIdClash, nextRegNumber } = require('./common');

// POST /api/members
async function createMember(req, res, next) {
  try {
    const { name, phone, email, regNumber, notes, joinDate, photoUrl, photoPublicId, nextOfKin, emailNotifications } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Name is required' });
    }
    const normalized = normalizePhone(String(phone || ''));
    if (!normalized) {
      return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
    }
    const trimmedEmail = cleanEmail(email);
    if (!isValidEmail(trimmedEmail)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    const kin = nextOfKinList(nextOfKin);
    const kinError = nextOfKinListError(kin);
    if (kinError) return res.status(400).json({ message: kinError });

    const details = detailsFromBody(req.body || {});
    if (details.error) return res.status(400).json({ message: details.error });

    // No credential guard on creation, deliberately: this is a new record, so the ID, the phone
    // number and the next of kin are being *recorded*, not replaced — and recording them is the
    // office's work whoever is doing it. utils/memberCredentials refuses only a replacement.

    // The ID is the member's key to his own record, so it has to be his alone.
    const clash = await nationalIdClash(details.nationalId);
    if (clash) return res.status(409).json({ message: idClashMessage(clash) });

    const doc = {
      name: String(name).trim(),
      phone: normalized,
      email: trimmedEmail,
      photoUrl: String(photoUrl || '').trim(),
      photoPublicId: String(photoPublicId || '').trim(),
      nextOfKin: kin,
      dateOfBirth: details.dateOfBirth ?? null,
      nationalId: details.nationalId,
      physicalAddress: details.physicalAddress,
      family: details.family,
      commitment: details.commitment,
      approvals: details.approvals,
      emailNotifications: emailNotifications === undefined ? true : Boolean(emailNotifications),
      notes: String(notes || '').trim(),
      createdBy: req.user._id,
    };
    if (joinDate) {
      const d = new Date(joinDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid join date' });
      doc.joinDate = d;
    }
    const providedReg = String(regNumber || '').trim();
    doc.regNumber = providedReg || (await nextRegNumber());

    let member;
    for (let attempt = 0; ; attempt++) {
      try {
        member = await Member.create(doc);
        break;
      } catch (err) {
        // Retry only when the auto-generated regNumber collided
        if (err.code === 11000 && err.keyValue?.regNumber && !providedReg && attempt < 3) {
          doc.regNumber = await nextRegNumber();
          continue;
        }
        throw err;
      }
    }

    await logAudit({
      action: 'create',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      after: snapshot(member),
    });
    res.status(201).json({ member });
  } catch (err) {
    next(err);
  }
}

// PATCH /api/members/:id
async function updateMember(req, res, next) {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    const before = snapshot(member);

    const { name, phone, email, regNumber, notes, active, joinDate, photoUrl, photoPublicId, nextOfKin, emailNotifications } = req.body || {};

    // The admission form's fields, read once here rather than further down: the credential guard
    // below has to see the same values the assignments are about to write, and a second read of
    // the body is a second chance for the two to disagree.
    const details = detailsFromBody(req.body || {});
    if (details.error) return res.status(400).json({ message: details.error });

    // A member's ID, phone number and next of kin are not a description of him — they are the key
    // to his own record, the office's line to him, and somebody else's contact details. Recording
    // what is missing is the office's ordinary work (the register is full of records entered from
    // a name and a phone number, and the office is chasing the members who have no ID); replacing
    // a value that is already there is an admin's decision. The treasurer keeps the rest of the
    // register — this is the one corner of it that is not his. See utils/memberCredentials.
    const credentialRefusal = credentialChangeRefused(req.user.role, [
      {
        field: 'nationalId',
        before: member.nationalId,
        after: req.body.nationalId === undefined ? member.nationalId : details.nationalId,
      },
      {
        field: 'phone',
        before: member.phone,
        after: phone === undefined ? member.phone : normalizePhone(String(phone)),
      },
      {
        field: 'nextOfKin',
        before: nextOfKinList(member.nextOfKin),
        after: nextOfKin === undefined ? nextOfKinList(member.nextOfKin) : nextOfKinList(nextOfKin),
      },
    ]);
    if (credentialRefusal) return res.status(403).json({ message: credentialRefusal });

    if (name !== undefined) {
      if (!String(name).trim()) return res.status(400).json({ message: 'Name cannot be empty' });
      member.name = String(name).trim();
    }
    if (phone !== undefined) {
      const normalized = normalizePhone(String(phone));
      if (!normalized) {
        return res.status(400).json({ message: 'Enter a valid phone number (e.g. 0712 345 678)' });
      }
      member.phone = normalized;
    }
    if (email !== undefined) {
      const trimmedEmail = cleanEmail(email);
      if (!isValidEmail(trimmedEmail)) {
        return res.status(400).json({ message: 'Enter a valid email address' });
      }
      member.email = trimmedEmail;
    }
    if (regNumber !== undefined) member.regNumber = String(regNumber).trim() || undefined;
    if (notes !== undefined) member.notes = String(notes).trim();
    if (joinDate !== undefined && joinDate !== null && joinDate !== '') {
      const d = new Date(joinDate);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ message: 'Invalid join date' });
      member.joinDate = d;
    }
    if (active !== undefined) {
      const wasActive = member.active !== false;
      member.active = Boolean(active);
      // The day he stopped being a member is the day this was switched, and it is only set once: saving a
      // form that still says inactive must not move it.
      if (wasActive && !member.active) member.deactivatedAt = new Date();
      // Reactivating clears the resignation record — they're a current member again.
      if (member.active) {
        member.deactivatedAt = null;
        member.resignedAt = null;
        member.resignationReason = '';
        member.resignationSettlement = '';
      }
    }
    if (emailNotifications !== undefined) {
      member.emailNotifications = Boolean(emailNotifications);
    }
    if (nextOfKin !== undefined) {
      // The whole list is replaced every time it is sent: that is how an admin
      // adds a second child or removes a contact who has died, without any
      // per-entry endpoints to keep in step with the form.
      const kin = nextOfKinList(nextOfKin);
      const kinError = nextOfKinListError(kin);
      if (kinError) return res.status(400).json({ message: kinError });
      member.nextOfKin = kin;
    }

    // The admission form's fields. Each is only touched when the caller sent it, so
    // saving the notes box does not wipe a date of birth nobody repeated.
    if (details.dateOfBirth !== undefined) member.dateOfBirth = details.dateOfBirth;
    if (req.body.nationalId !== undefined) {
      // Editing one member must not hand him a number that already opens another
      // member's record.
      const clash = await nationalIdClash(details.nationalId, member._id);
      if (clash) return res.status(409).json({ message: idClashMessage(clash) });
      member.nationalId = details.nationalId;
    }
    if (req.body.physicalAddress !== undefined) member.physicalAddress = details.physicalAddress;
    if (req.body.family !== undefined) member.family = details.family;
    if (req.body.commitment !== undefined) member.commitment = details.commitment;
    if (req.body.approvals !== undefined) member.approvals = details.approvals;

    // A replaced photo takes its Cloudinary asset with it. The old publicId is
    // only remembered here and destroyed after a successful save, so a failed
    // update can never leave a member with neither their old photo nor the new one.
    const replacedPhotoId =
      photoPublicId !== undefined &&
      member.photoPublicId &&
      member.photoPublicId !== String(photoPublicId).trim()
        ? member.photoPublicId
        : null;

    // URL and publicId travel as a pair — receiving only one of them would mean
    // storing an image nothing can ever delete again.
    if (photoPublicId !== undefined || photoUrl !== undefined) {
      member.photoUrl = String(photoUrl || '').trim();
      member.photoPublicId = String(photoPublicId || '').trim();
    }

    await member.save();
    if (replacedPhotoId) await destroyImage(replacedPhotoId);
    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      before,
      after: snapshot(member),
    });
    res.json({ member });
  } catch (err) {
    next(err);
  }
}

// DELETE /api/members/:id — soft delete only, contributions are kept
async function deleteMember(req, res, next) {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    const before = snapshot(member);

    if (member.active) member.deactivatedAt = new Date();
    member.active = false;
    await member.save();
    await logAudit({
      action: 'delete',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      before,
      after: snapshot(member),
    });
    res.json({ member });
  } catch (err) {
    next(err);
  }
}

// POST /api/members/:id/resign — explicit resignation, distinct from a plain
// deactivation: records when and why, and is what the public resigned list is
// keyed on.
async function resignMember(req, res, next) {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) return res.status(404).json({ message: 'Member not found' });
    if (!member.active) return res.status(400).json({ message: 'Member is already inactive' });

    // Resigning changes nothing about what he holds or what he owes: the money stays in the group's
    // books and the fines stay on his record. So a member leaving with either is not resigned until
    // somebody has written down what became of them — otherwise the figure sits there for ever with
    // nobody able to say whether it was paid out, kept, or forgotten.
    const [ledger, owedRows] = await Promise.all([
      memberLedgerNow(member._id),
      Fine.aggregate([
        { $match: { memberId: member._id, deleted: false, remaining: { $gt: 0 } } },
        { $group: { _id: null, owed: { $sum: '$remaining' }, count: { $sum: 1 } } },
      ]),
    ]);
    const held = Math.max(0, Math.round((Number(ledger?.money) || 0) * 100) / 100);
    const owed = Math.round((owedRows[0]?.owed || 0) * 100) / 100;
    // Money paid out to him as he leaves, if any. Recorded as the group spending from its total money, dated
    // the day he leaves, so the group's balance drops on that day instead of carrying his money for ever.
    const rawPayout = req.body?.payout;
    let payout = 0;
    if (rawPayout !== undefined && rawPayout !== null && String(rawPayout).trim() !== '') {
      const read = readMoney(rawPayout, { min: 0, label: 'The payout' });
      if (read.error) return res.status(400).json({ message: read.error });
      payout = read.value;
    }
    const fmtKsh = (n) => `Ksh ${Number(n).toLocaleString('en-KE')}`;
    let settlement = String(req.body?.settlement || '').trim();
    // A payout is itself the account of what became of his money.
    if (payout > 0 && settlement.length < 3) settlement = `Paid out ${fmtKsh(payout)}`;
    // A loan still out is the third thing that does not go away when he does.
    const loanOwed = (await activeLoanOwedBy(member._id)).outstanding;
    if ((held > 0 || owed > 0 || loanOwed > 0) && settlement.length < 3) {
      const fmt = (n) => `Ksh ${Number(n).toLocaleString('en-KE')}`;
      return res.status(409).json({
        message:
          `He still holds ${fmt(held)} and owes ${fmt(owed)} in fines` +
          (loanOwed > 0 ? ` and ${fmt(loanOwed)} on a loan` : '') +
          '. Write down how that was settled (paid out, kept, taken against his fines or his loan) before resigning him.',
        held,
        owed,
        loanOwed,
        needsSettlement: true,
      });
    }
    const before = snapshot(member);

    member.active = false;
    member.resignedAt = new Date();
    member.deactivatedAt = member.resignedAt;
    member.resignationReason = String(req.body?.reason || '').trim();
    member.resignationSettlement = settlement.slice(0, 500);
    let payoutExpense = null;
    await withOptionalTransaction(async (session) => {
      await member.save({ session });
      if (payout > 0) {
        [payoutExpense] = await Expense.create(
          [
            {
              source: 'group',
              amount: payout,
              date: member.resignedAt,
              description: `Paid out to ${member.name} on leaving`,
              note: settlement,
              loggedBy: req.user._id,
            },
          ],
          { session }
        );
      }
    });
    if (payoutExpense) {
      await logAudit({
        action: 'create',
        entityType: 'Expense',
        entityId: payoutExpense._id,
        performedBy: req.user._id,
        after: snapshot(payoutExpense),
      });
    }

    await logAudit({
      action: 'update',
      entityType: 'Member',
      entityId: member._id,
      performedBy: req.user._id,
      before,
      after: snapshot(member),
    });
    res.json({ member, paidOut: payout });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  createMember,
  deleteMember,
  resignMember,
  updateMember,
};
