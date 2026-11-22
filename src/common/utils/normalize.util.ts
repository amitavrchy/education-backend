/** Emails are unique case-insensitively: always store and query them lowercased. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalize Bangladeshi mobile numbers to +8801XXXXXXXXX. Returns null when invalid. */
export function normalizeBdPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('880') ? digits.slice(2) : digits;
  return /^01[3-9]\d{8}$/.test(local) ? `+88${local}` : null;
}
