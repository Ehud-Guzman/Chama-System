// The group's name.
//
// The live value is the one in Settings → chama name, which every page that can read
// settings already uses. This is for the screens that have to render before that has
// been loaded (the sign-in card, the admin header on a phone) and as the fallback
// wherever `settings.chamaName` comes back empty — so a member never sees a blank
// heading or a developer's placeholder where the group's name belongs.
export const CHAMA_NAME = 'WAZO MOJA SELF-HELP GROUP';

// The same name stacked as the sidebar prints it — the group above, what it is
// below. Kept next to CHAMA_NAME so the wording has one home.
export const CHAMA_NAME_TOP = 'WAZO MOJA';
export const CHAMA_NAME_BOTTOM = 'Self-Help Group';
