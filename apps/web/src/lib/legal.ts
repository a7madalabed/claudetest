/**
 * Who runs this copy of Ledgerly, for the privacy policy and the terms.
 *
 * Read at REQUEST time from the web container's environment (LEGAL_OPERATOR_NAME,
 * LEGAL_CONTACT_EMAIL; see deploy/.env.example), so one image serves every
 * deployment and no placeholder text is baked into the code. The legal pages
 * are `force-dynamic` for exactly this reason.
 */
export function legalOperator(env: Record<string, string | undefined> = process.env) {
  const name = env.LEGAL_OPERATOR_NAME?.trim() || null;
  const email = env.LEGAL_CONTACT_EMAIL?.trim() || null;
  // A mailto: link built from the environment: accept only something shaped like an address.
  return { name, email: email && /^[^@\s<>"']+@[^@\s<>"']+$/.test(email) ? email : null };
}
