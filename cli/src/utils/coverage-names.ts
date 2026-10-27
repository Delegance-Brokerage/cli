/**
 * Plain names for the coverage codes the API and SDK emit. A person reads
 * "General Liability", never "CGL". Codes come from three vocabularies: the
 * CoverForce policy types on carrier quotes (CGL, WC, BOP, CYBER, BR, MPL,
 * plus CA/PL/IM/ML from the mapper), the quote coverage ids the CLI sends
 * (general_liability, workers_comp, ...), and the server's canonical LOB codes
 * and ACORD product types (app/config/canonical-lob.ts). Unknown codes pass
 * through unchanged. `--json` output never goes through this module.
 */

const NAMES: Record<string, string> = {
  // General liability
  cgl: 'General Liability',
  gl: 'General Liability',
  general_liability: 'General Liability',
  // Workers' comp
  wc: "Workers' Comp",
  workers_comp: "Workers' Comp",
  workers_compensation: "Workers' Comp",
  // Business owner's policy
  bop: "Business Owner's Policy",
  business_owners: "Business Owner's Policy",
  business_owners_policy: "Business Owner's Policy",
  // Cyber
  cyber: 'Cyber',
  cyber_liability: 'Cyber',
  // Professional liability (E&O)
  mpl: 'Professional Liability (E&O)',
  pl: 'Professional Liability (E&O)',
  pro_liab: 'Professional Liability (E&O)',
  professional_liability: 'Professional Liability (E&O)',
  eo: 'Professional Liability (E&O)',
  e_o: 'Professional Liability (E&O)',
  tech_eo: 'Tech E&O',
  errors_omissions: 'Tech E&O',
  // Auto
  ca: 'Commercial Auto',
  auto: 'Commercial Auto',
  commercial_auto: 'Commercial Auto',
  // Property
  cp: 'Commercial Property',
  property: 'Commercial Property',
  commercial_property: 'Commercial Property',
  // Umbrella
  umbrella: 'Umbrella',
  excess: 'Umbrella',
  commercial_umbrella: 'Umbrella',
  // Builders risk
  br: "Builders' Risk",
  builders_risk: "Builders' Risk",
  // Inland marine and marine
  im: 'Inland Marine',
  inland_marine: 'Inland Marine',
  marine: 'Marine',
  // Management liability family
  ml: 'Management Liability',
  management_liability: 'Management Liability',
  do: "Directors and Officers (D&O)",
  d_o: "Directors and Officers (D&O)",
  directors_officers: "Directors and Officers (D&O)",
  epli: 'Employment Practices Liability',
  employment_practices: 'Employment Practices Liability',
  crime: 'Crime',
  fiduciary: 'Fiduciary Liability',
  fiduciary_liability: 'Fiduciary Liability',
  // Everything else on the canonical list
  product_liability: 'Product Liability',
  liquor_liability: 'Liquor Liability',
  contractors_liability: "Contractors' Liability",
  equipment_breakdown: 'Equipment Breakdown',
  environmental_liability: 'Environmental Liability',
  healthcare_medical: 'Healthcare Medical Liability',
  life_sciences: 'Life Sciences',
  hospitality_programs: 'Hospitality Program',
  commercial_flood: 'Commercial Flood',
  home_based_business: 'Home-Based Business',
  foreign_package: 'Foreign Package',
  multinational_package: 'Multinational Package',
  political_risk: 'Political Risk',
  trade_credit: 'Trade Credit',
  kidnap_ransom: 'Kidnap and Ransom',
  product_recall: 'Product Recall',
  railroad_liability: 'Railroad Liability',
};

/** "CGL" -> "General Liability". Case, dashes, spaces and "&" do not matter. Unknown codes return as given. */
export function coverageName(code: string | null | undefined): string {
  if (code === null || code === undefined) return '';
  const key = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return NAMES[key] ?? code;
}

/** Plain names for a list of codes, comma-joined. */
export function coverageNames(codes: readonly (string | null | undefined)[]): string {
  return codes.map(coverageName).filter(Boolean).join(', ');
}
