export const currency = (value: number) =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(value);

export const compactCurrency = (value: number) =>
  new Intl.NumberFormat('en-KE', { notation: 'compact', maximumFractionDigits: 1 }).format(value);

export const formatDate = (value: string) => new Date(value).toLocaleDateString('en-KE');
