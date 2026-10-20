/**
 * Spots sheet columns that hold personal data a recruiter usually does not need on a contact (date of birth, pay,
 * home address, government ids, and the like). The import screen leaves these unticked and, while "never store
 * columns marked personal" is on, does not let them be ticked. A guess from the header only: the person can switch
 * the protection off.
 */
const PERSONAL = /date of birth|\bdob\b|birth|salary|\bctc\b|annual|\bpay\b|aadha?a?r|\bpan\b|passport|address|marital|gender|religion|disab|nationality|\bcaste\b|blood/i;

/** True when a column header looks like personal data. */
export function isPersonalColumn(header: string): boolean {
  return PERSONAL.test(header);
}
