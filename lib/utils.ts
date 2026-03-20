export const currency = (value: number) =>
  new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency: 'KES',
    maximumFractionDigits: 0,
  }).format(value);

export const compactCurrency = (value: number) =>
  new Intl.NumberFormat('en-KE', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);

function parseDateSafely(value: unknown): Date | null {
  if (value == null) return null;

  const raw = String(value).trim();
  if (!raw) return null;
  if (raw === '0') return null;

  const isoOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoOnly) {
    const year = Number(isoOnly[1]);
    const month = Number(isoOnly[2]);
    const day = Number(isoOnly[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  const ddmmyyyy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  return parsed;
}

export const formatDate = (value?: string | null) => {
  const parsed = parseDateSafely(value);
  if (!parsed) return '-';
  return parsed.toLocaleDateString('en-KE');
};