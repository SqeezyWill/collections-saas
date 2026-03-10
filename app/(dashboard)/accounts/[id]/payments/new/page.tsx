import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type PageProps = {
  params: Promise<{ id: string }>;
};

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

async function savePayment(formData: FormData) {
  'use server';

  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const accountId = String(formData.get('accountId') || '').trim();
  const companyId = String(formData.get('companyId') || '').trim();
  const collectorName = String(formData.get('collectorName') || '').trim();
  const product = String(formData.get('product') || '').trim();
  const amountRaw = String(formData.get('amount') || '').replace(/,/g, '').trim();
  const paidOn = String(formData.get('paidOn') || '').trim();

  // Captured for future schema/storage wiring
  const paymentChannel = String(formData.get('paymentChannel') || '').trim();
  const transactionCode = String(formData.get('transactionCode') || '').trim();
  const bankSlip = formData.get('bankSlip');

  const amount = Number(amountRaw);
  const postedOn = todayDateString();

  if (!accountId || !companyId || !product || !paidOn || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Please provide a valid amount and payment date.');
  }

  const { data: insertedPayment, error: insertError } = await supabase
    .from('payments')
    .insert({
      account_id: accountId,
      company_id: companyId,
      collector_name: collectorName || null,
      product,
      amount,
      paid_on: paidOn,
    })
    .select('*')
    .single();

  if (insertError || !insertedPayment) {
    throw new Error(insertError?.message || 'Failed to save payment.');
  }

  const { data: account, error: fetchError } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', accountId)
    .single();

  if (fetchError || !account) {
    throw new Error(fetchError?.message || 'Failed to fetch account after payment save.');
  }

  const currentAmountPaid = Number(account.amount_paid || 0);
  const updatedAmountPaid = currentAmountPaid + amount;
  const currentBalance = Number(account.balance || 0);
  const remainingBalance = currentBalance - amount;

  const { data: earliestOpenPtp, error: ptpFetchError } = await supabase
    .from('ptps')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'Promise To Pay')
    .is('resolved_at', null)
    .order('promised_date', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (ptpFetchError) {
    throw new Error(ptpFetchError.message);
  }

  let ptpOutcomeNote = '';
  let resolvedPtpStatus = '';

  if (earliestOpenPtp) {
    const ptpStatus = paidOn <= earliestOpenPtp.promised_date ? 'Kept' : 'Broken';
    const resolutionType = ptpStatus.toLowerCase();
    resolvedPtpStatus = ptpStatus;

    const resolutionNotes =
      ptpStatus === 'Kept'
        ? `Auto-resolved as kept by payment ${insertedPayment.id} made on ${paidOn}.`
        : `Auto-resolved as broken by payment ${insertedPayment.id} made on ${paidOn}, after promised date ${earliestOpenPtp.promised_date}.`;

    const { error: ptpUpdateError } = await supabase
      .from('ptps')
      .update({
        status: ptpStatus,
        resolved_at: new Date().toISOString(),
        resolution_type: resolutionType,
        resolved_by_payment_id: insertedPayment.id,
        resolution_notes: resolutionNotes,
        auto_resolved: true,
      })
      .eq('id', earliestOpenPtp.id);

    if (ptpUpdateError) {
      throw new Error(ptpUpdateError.message);
    }

    ptpOutcomeNote = `PTP ${ptpStatus}: ${earliestOpenPtp.promised_amount} due ${earliestOpenPtp.promised_date}`;
  }

  const { data: remainingOpenPtps, error: remainingOpenPtpsError } = await supabase
    .from('ptps')
    .select('id')
    .eq('account_id', accountId)
    .eq('status', 'Promise To Pay')
    .is('resolved_at', null);

  if (remainingOpenPtpsError) {
    throw new Error(remainingOpenPtpsError.message);
  }

  let derivedStatus = 'Open';

  if (remainingBalance <= 0) {
    derivedStatus = 'Paid';
  } else if ((remainingOpenPtps || []).length > 0) {
    derivedStatus = 'PTP';
  }

  const { error: accountUpdateError } = await supabase
    .from('accounts')
    .update({
      amount_paid: updatedAmountPaid,
      last_pay_amount: amount,
      last_pay_date: paidOn,
      last_action_date: postedOn,
      status: derivedStatus,
    })
    .eq('id', accountId);

  if (accountUpdateError) {
    throw new Error(accountUpdateError.message);
  }

  const noteParts = [
    `Payment logged: ${amount}`,
    `Payment made on: ${paidOn}`,
    `Posted on: ${postedOn}`,
    paymentChannel ? `Channel: ${paymentChannel}` : '',
    transactionCode ? `Transaction Code: ${transactionCode}` : '',
    ptpOutcomeNote,
  ].filter(Boolean);

  const { error: noteError } = await supabase.from('notes').insert({
    company_id: companyId,
    account_id: accountId,
    author_id: '11111111-1111-1111-1111-111111111111',
    created_by_name: 'System User',
    body: noteParts.join(' | '),
  });

  if (noteError) {
    throw new Error(noteError.message);
  }

  redirect(`/accounts/${accountId}`);
}

export default async function NewPaymentPage({ params }: PageProps) {
  const { id } = await params;

  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Log Payment</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const { data: account, error } = await supabase
    .from('accounts')
    .select('id, debtor_name, company_id, collector_name, product')
    .eq('id', id)
    .single();

  if (error || !account) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/accounts/${id}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account Workspace
        </Link>

        <h1 className="text-3xl font-semibold text-slate-900">Log Payment</h1>
        <p className="mt-1 text-slate-500">
          Record customer payments for <span className="font-medium">{account.debtor_name}</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <form action={savePayment} className="space-y-6" encType="multipart/form-data">
          <input type="hidden" name="accountId" value={account.id} />
          <input type="hidden" name="companyId" value={account.company_id} />
          <input type="hidden" name="collectorName" value={account.collector_name || ''} />
          <input type="hidden" name="product" value={account.product || ''} />

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="mb-3 block text-sm font-medium text-slate-700">
                Payment Amount
              </label>
              <input
                type="number"
                name="amount"
                step="0.01"
                min="0"
                required
                placeholder="Enter payment amount"
                className="w-full rounded-xl border border-slate-300 px-4 py-4 text-lg text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div>
              <label className="mb-3 block text-sm font-medium text-slate-700">
                Payment Made On
              </label>
              <input
                type="date"
                name="paidOn"
                required
                className="w-full rounded-xl border border-slate-300 px-4 py-4 text-lg text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
              <p className="mt-2 text-sm text-slate-500">
                Posted on is recorded automatically by the system when you save this payment.
              </p>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <div>
              <label className="mb-3 block text-sm font-medium text-slate-700">
                Payment Channel
              </label>
              <select
                name="paymentChannel"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-4 py-4 text-lg text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Select Payment Channel</option>
                <option value="M-Pesa">M-Pesa</option>
                <option value="Bank">Bank</option>
              </select>
            </div>

            <div>
              <label className="mb-3 block text-sm font-medium text-slate-700">
                M-Pesa / Bank Transaction Code
              </label>
              <input
                type="text"
                name="transactionCode"
                placeholder="Enter transaction code"
                className="w-full rounded-xl border border-slate-300 px-4 py-4 text-lg text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-slate-700">
              Upload Bank Slip (if available)
            </label>
            <input
              type="file"
              name="bankSlip"
              accept=".pdf,.jpg,.jpeg,.png,.webp"
              className="block w-full rounded-xl border border-slate-300 bg-white px-4 py-4 text-sm text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:font-medium file:text-slate-700 hover:file:bg-slate-200"
            />
            <p className="mt-2 text-sm text-slate-500">
              Upload support is ready in the form. Saving the file itself needs the storage path/schema we’ll wire next.
            </p>
          </div>

          <div>
            <label className="mb-3 block text-sm font-medium text-slate-700">Product</label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-4 text-lg font-medium text-slate-900">
              {account.product || '-'}
            </div>
            <p className="mt-2 text-sm text-slate-500">
              Product is picked automatically from the selected account.
            </p>
          </div>

          <div className="flex flex-wrap gap-4 pt-2">
            <Link
              href={`/accounts/${id}`}
              className="rounded-xl border border-slate-300 bg-white px-7 py-4 text-lg font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-7 py-4 text-lg font-medium text-white hover:bg-slate-800"
            >
              Save Payment
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}