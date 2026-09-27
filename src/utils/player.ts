/**
 * Convert a player's numeric age into the standard age band used by the UI.
 * The upper age is exclusive in chess notation: a seven-year-old is U8,
 * while an eighteen-year-old enters the Open category. Senior begins at 60.
 */
export function categoryForAge(age: number): string {
  if (!Number.isFinite(age) || age < 1) return "—";
  if (age < 8) return "U8";
  if (age < 10) return "U10";
  if (age < 12) return "U12";
  if (age < 14) return "U14";
  if (age < 16) return "U16";
  if (age < 18) return "U18";
  if (age >= 60) return "Senior";
  return "Open";
}
