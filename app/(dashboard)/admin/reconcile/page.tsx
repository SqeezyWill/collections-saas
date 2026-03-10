import { DataTable } from '@/components/DataTable';
import { supabase } from '@/lib/supabase';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';

export default async function ReconcilePage() {
  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Reconciliation</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const [paymentsResponse, ptpsResponse] = await Promise.all([
    supabase
      .from('payments')
      .select('product, account_id')
      .eq('company_id', COMPANY_ID),
    supabase
      .from('ptps')
      .select('product, account_id')
      .eq('company_id', COMPANY_ID),
  ]);

  if (paymentsResponse.error || ptpsResponse.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Reconciliation</h1>
        <p className="text-red-600">Failed to load reconciliation data.</p>
      </div>
    );
  }

  const payments = paymentsResponse.data ?? [];
  const ptps = ptpsResponse.data ?? [];

  const paymentProducts = Array.from(new Set(payments.map((r) => r.product).filter(Boolean)));
  const ptpProducts = Array.from(new Set(ptps.map((r) => r.product).filter(Boolean)));

  const paymentRows = paymentProducts.map((product) => {
    const rows = payments.filter((r) => r.product === product);
    return {
      product,
      totalRows: rows.length,
      linkedRows: rows.filter((r) => r.account_id).length,
      unlinkedRows: rows.filter((r) => !r.account_id).length,
    };
  });

  const ptpRows = ptpProducts.map((product) => {
    const rows = ptps.filter((r) => r.product === product);
    return {
      product,
      totalRows: rows.length,
      linkedRows: rows.filter((r) => r.account_id).length,
      unlinkedRows: rows.filter((r) => !r.account_id).length,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-semibold">Reconciliation</h1>
        <p className="mt-1 text-slate-500">
          Check how many imported payments and PTPs are linked back to accounts.
        </p>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">Payments Link Status</h2>
        <DataTable headers={['Product', 'Total Rows', 'Linked Rows', 'Unlinked Rows']}>
          {paymentRows.map((row) => (
            <tr key={row.product}>
              <td className="px-4 py-3 font-medium">{row.product}</td>
              <td className="px-4 py-3">{row.totalRows}</td>
              <td className="px-4 py-3">{row.linkedRows}</td>
              <td className="px-4 py-3">{row.unlinkedRows}</td>
            </tr>
          ))}
        </DataTable>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-slate-900">PTPs Link Status</h2>
        <DataTable headers={['Product', 'Total Rows', 'Linked Rows', 'Unlinked Rows']}>
          {ptpRows.map((row) => (
            <tr key={row.product}>
              <td className="px-4 py-3 font-medium">{row.product}</td>
              <td className="px-4 py-3">{row.totalRows}</td>
              <td className="px-4 py-3">{row.linkedRows}</td>
              <td className="px-4 py-3">{row.unlinkedRows}</td>
            </tr>
          ))}
        </DataTable>
      </div>
    </div>
  );
}