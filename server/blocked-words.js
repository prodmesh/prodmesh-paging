// Codes that never go on the screens. This is a basic guard against a bored
// volunteer, not a moderation system: there are no leetspeak or spelling
// variants, on purpose.
//
// Add words here (any case). Tech can also add more at /admin → Blocked
// codes, which are stored in the data folder and survive updates.
//
// How a word matches (see isBlocked in paging.js):
//   - 3 letters or fewer: only the whole code. Short words hide inside
//     innocent random codes ("ASS" in "PASS1"), and a real child's code must
//     never be refused.
//   - 4 letters or more: anywhere in the code.

export const BLOCKED_WORDS = [
  'ASS',
  'CUM',
  'FAG',
  'KKK',
  'NIG',
  'SEX',
  'TIT',
  'WTF',
  'BITCH',
  'COCK',
  'CUNT',
  'DAMN',
  'DICK',
  'DYKE',
  'FUCK',
  'HELL',
  'JIZZ',
  'NIGGA',
  'PISS',
  'PORN',
  'PUSSY',
  'SHIT',
  'SLUT',
  'STFU',
  'TITS',
  'TWAT',
  'WHORE',
];
