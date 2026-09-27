export interface Federation {
  code: string;
  iso2: string;
  name: string;
}

/** Common FIDE federation codes. The saved value is the FIDE code, not a flag. */
export const FEDERATIONS: Federation[] = [
  { code: "PHI", iso2: "PH", name: "Philippines" },
  { code: "FID", iso2: "", name: "FIDE / Neutral" },
  { code: "USA", iso2: "US", name: "United States" },
  { code: "IND", iso2: "IN", name: "India" },
  { code: "CHN", iso2: "CN", name: "China" },
  { code: "RUS", iso2: "RU", name: "Russia" },
  { code: "UKR", iso2: "UA", name: "Ukraine" },
  { code: "ENG", iso2: "GB", name: "England" },
  { code: "FRA", iso2: "FR", name: "France" },
  { code: "GER", iso2: "DE", name: "Germany" },
  { code: "ESP", iso2: "ES", name: "Spain" },
  { code: "ITA", iso2: "IT", name: "Italy" },
  { code: "NED", iso2: "NL", name: "Netherlands" },
  { code: "NOR", iso2: "NO", name: "Norway" },
  { code: "SWE", iso2: "SE", name: "Sweden" },
  { code: "DEN", iso2: "DK", name: "Denmark" },
  { code: "POL", iso2: "PL", name: "Poland" },
  { code: "CZE", iso2: "CZ", name: "Czech Republic" },
  { code: "HUN", iso2: "HU", name: "Hungary" },
  { code: "ROU", iso2: "RO", name: "Romania" },
  { code: "BUL", iso2: "BG", name: "Bulgaria" },
  { code: "SRB", iso2: "RS", name: "Serbia" },
  { code: "CRO", iso2: "HR", name: "Croatia" },
  { code: "GRE", iso2: "GR", name: "Greece" },
  { code: "TUR", iso2: "TR", name: "Türkiye" },
  { code: "ARM", iso2: "AM", name: "Armenia" },
  { code: "GEO", iso2: "GE", name: "Georgia" },
  { code: "AZE", iso2: "AZ", name: "Azerbaijan" },
  { code: "KAZ", iso2: "KZ", name: "Kazakhstan" },
  { code: "UZB", iso2: "UZ", name: "Uzbekistan" },
  { code: "MGL", iso2: "MN", name: "Mongolia" },
  { code: "JPN", iso2: "JP", name: "Japan" },
  { code: "KOR", iso2: "KR", name: "South Korea" },
  { code: "TPE", iso2: "TW", name: "Chinese Taipei" },
  { code: "HKG", iso2: "HK", name: "Hong Kong" },
  { code: "VIE", iso2: "VN", name: "Vietnam" },
  { code: "THA", iso2: "TH", name: "Thailand" },
  { code: "MAS", iso2: "MY", name: "Malaysia" },
  { code: "SGP", iso2: "SG", name: "Singapore" },
  { code: "INA", iso2: "ID", name: "Indonesia" },
  { code: "MYA", iso2: "MM", name: "Myanmar" },
  { code: "AUS", iso2: "AU", name: "Australia" },
  { code: "NZL", iso2: "NZ", name: "New Zealand" },
  { code: "CAN", iso2: "CA", name: "Canada" },
  { code: "MEX", iso2: "MX", name: "Mexico" },
  { code: "BRA", iso2: "BR", name: "Brazil" },
  { code: "ARG", iso2: "AR", name: "Argentina" },
  { code: "CUB", iso2: "CU", name: "Cuba" },
  { code: "COL", iso2: "CO", name: "Colombia" },
  { code: "PER", iso2: "PE", name: "Peru" },
  { code: "CHI", iso2: "CL", name: "Chile" },
  { code: "EGY", iso2: "EG", name: "Egypt" },
  { code: "RSA", iso2: "ZA", name: "South Africa" },
  { code: "NGR", iso2: "NG", name: "Nigeria" },
  { code: "ISR", iso2: "IL", name: "Israel" },
  { code: "IRI", iso2: "IR", name: "Iran" },
  { code: "UAE", iso2: "AE", name: "United Arab Emirates" },
  { code: "KSA", iso2: "SA", name: "Saudi Arabia" },
  { code: "QAT", iso2: "QA", name: "Qatar" },
];

export function flagForFederation(code: string): string {
  const federation = FEDERATIONS.find(
    (item) => item.code === code.toUpperCase(),
  );
  if (!federation?.iso2) return "♟";
  return String.fromCodePoint(
    ...[...federation.iso2].map((letter) => 127397 + letter.charCodeAt(0)),
  );
}

export function federationName(code: string): string {
  return (
    FEDERATIONS.find((item) => item.code === code.toUpperCase())?.name || code
  );
}
