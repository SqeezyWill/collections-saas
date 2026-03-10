import { compactCurrency } from '@/lib/utils';

export function KpiCard({ title, value, helper, money = false }: { title: string; value: number | string; helper: string; money?: boolean }) {
  return (
    <div className="kpi-card">
      <p className="text-sm text-slate-500">{title}</p>
      <div className="mt-3 text-3xl font-semibold text-slate-900">{typeof value === 'number' && money ? compactCurrency(value) : value}</div>
      <p className="mt-2 text-sm text-slate-500">{helper}</p>
    </div>
  );
}
