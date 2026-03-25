import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

type PageProps = {
  params: Promise<{ id: string }>;
};

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeStatus(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

function isClosedStatus(value: unknown) {
  return normalizeStatus(value) === 'closed';
}

function toMoney(value: unknown) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num : 0;
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

  const paymentChannel = String(formData.get('paymentChannel') || '').trim();
  const transactionCode = String(formData.get('transactionCode') || '').trim();
  const bankSlip = formData.get('bankSlip');

  const amount = Number(amountRaw);
  const postedOn = todayDateString();

  if (!accountId || !companyId || !product || !paidOn || !Number.isFinite(amount) || amount <= 0) {
    throw new Error('Please provide a valid amount and payment date.');
  }

  const { data: account, error: fetchError } = await supabase
    .from('accounts')
    .select(
      'id, debtor_name, company_id, collector_name, product, balance, total_due, amount_paid, status'
    )
    .eq('id', accountId)
    .single();

  if (fetchError || !account) {
    throw new Error(fetchError?.message || 'Failed to fetch account before payment save.');
  }

  if (isClosedStatus(account.status)) {
    throw new Error('This account is closed. Reopen it before logging a payment.');
  }

  const currentAmountPaid = toMoney(account.amount_paid);
  const currentBalance = Math.max(0, toMoney(account.balance));
  const currentTotalDue = Math.max(0, toMoney((account as any).total_due));

  const payableAmount = currentBalance > 0 ? currentBalance : currentTotalDue;

  if (payableAmount <= 0) {
    throw new Error(
      'This account has no payable amount remaining. Payment cannot be logged unless an admin corrects the balances.'
    );
  }

  if (amount > payableAmount) {
    throw new Error(
      `Payment cannot exceed the remaining payable amount of ${currency(payableAmount)}.`
    );
  }

  let appliedToBalance = 0;
  let appliedToTotalDue = 0;
  let newBalance = currentBalance;
  let newTotalDue = currentTotalDue;

  if (currentBalance > 0) {
    appliedToBalance = Math.min(amount, currentBalance);
    newBalance = Math.max(0, currentBalance - appliedToBalance);

    const remainingAfterBalance = amount - appliedToBalance;
    if (remainingAfterBalance > 0) {
      appliedToTotalDue = Math.min(remainingAfterBalance, currentTotalDue);
      newTotalDue = Math.max(0, currentTotalDue - appliedToTotalDue);
    }
  } else {
    appliedToTotalDue = Math.min(amount, currentTotalDue);
    newTotalDue = Math.max(0, currentTotalDue - appliedToTotalDue);
  }

  const updatedAmountPaid = currentAmountPaid + amount;

  const { data: insertedPayment, error: insertError } = await supabase
    .from('payments')
    .insert({
      account_id: accountId,
      company_id: companyId,
      collector_name: collectorName || null,
      product,
      amount,
      paid_on: paidOn,
      payment_channel: paymentChannel || null,
      transaction_code: transactionCode || null,
      bank_slip: bankSlip && typeof bankSlip !== 'string' ? null : null,
    })
    .select('*')
    .single();

  if (insertError || !insertedPayment) {
    throw new Error(insertError?.message || 'Failed to save payment.');
  }

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

  if (earliestOpenPtp) {
    const ptpStatus = paidOn <= earliestOpenPtp.promised_date ? 'Kept' : 'Broken';
    const resolutionType = ptpStatus.toLowerCase();

    const resolutionNotes =
      ptpStatus === 'Kept'
        ? `Auto-resolved by payment of ${amount} posted on ${postedOn}.`
        : `Auto-resolved late by payment of ${amount} posted on ${postedOn}.`;

    const { error: ptpUpdateError } = await supabase
      .from('ptps')
      .update({
        status: ptpStatus,
        resolved_at: new Date().toISOString(),
        resolution_type: resolutionType,
        resolved_by_payment_id: insertedPayment.id,
        resolution_notes: resolutionNotes,
        auto_resolved: true,
        kept_amount: ptpStatus === 'Kept' ? amount : 0,
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

  let derivedStatus = String(account.status || 'Open').trim() || 'Open';

  if ((remainingOpenPtps || []).length > 0) {
    derivedStatus = 'PTP';
  } else if (normalizeStatus(account.status) === 'ptp' || normalizeStatus(account.status) === 'promise to pay') {
    derivedStatus = 'Open';
  } else if ((newBalance > 0 || newTotalDue > 0) && normalizeStatus(account.status) === 'paid') {
    derivedStatus = 'Open';
  }

  const { error: accountUpdateError } = await supabase
    .from('accounts')
    .update({
      amount_paid: updatedAmountPaid,
      balance: newBalance,
      total_due: newTotalDue,
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
    `Payment logged: ${currency(amount)}`,
    `Payment made on: ${paidOn}`,
    `Posted on: ${postedOn}`,
    appliedToBalance > 0 ? `Applied to Balance: ${currency(appliedToBalance)}` : '',
    appliedToTotalDue > 0 ? `Applied to Total Due: ${currency(appliedToTotalDue)}` : '',
    `New Balance: ${currency(newBalance)}`,
    `New Total Due: ${currency(newTotalDue)}`,
    paymentChannel ? `Channel: ${paymentChannel}` : '',
    transactionCode ? `Transaction Code: ${transactionCode}` : '',
    ptpOutcomeNote,
  ].filter(Boolean);

  const { error: noteError } = await supabase.from('notes').insert({
    company_id: companyId,
    account_id: accountId,
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
    .select(
      'id, debtor_name, company_id, collector_name, product, balance, total_due, amount_paid, status, last_pay_date, last_pay_amount'
    )
    .eq('id', id)
    .single();

  if (error || !account) {
    notFound();
  }

  const balance = Math.max(0, toMoney(account.balance));
  const totalDue = Math.max(0, toMoney((account as any).total_due));
  const payableAmount = balance > 0 ? balance : totalDue;
  const isClosed = isClosedStatus(account.status);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/accounts/${id}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account Workspace
        </Link>

        <h1 className="text-3xl font-semibold text-slate-900">Log Payment</h1>
        <p className="mt-1 text-slate-500">
          Record a payment for <span className="font-medium">{account.debtor_name}</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Current Balance</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{currency(balance)}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Current Total Due</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">{currency(totalDue)}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Amount Paid To Date</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {currency(toMoney(account.amount_paid))}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm text-slate-500">Maximum Payable Right Now</p>
            <p className="mt-1 text-xl font-semibold text-slate-900">
              {currency(payableAmount)}
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-700">
          Payment will reduce <span className="font-medium">Balance</span> first. If Balance is already zero,
          it will reduce <span className="font-medium">Total Due</span>. The system will reject any payment
          above the remaining payable amount.
        </div>

        {isClosed ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            This account is closed. Reopen it before logging a payment.
          </div>
        ) : null}

        {payableAmount <= 0 && !isClosed ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
            This account currently has no payable amount remaining. An admin must correct balances before a payment can be logged.
          </div>
        ) : null}

        {!isClosed && payableAmount > 0 ? (
          <form action={savePayment} className="mt-6 space-y-5">
            <input type="hidden" name="accountId" value={account.id} />
            <input type="hidden" name="companyId" value={account.company_id || ''} />
            <input type="hidden" name="collectorName" value={account.collector_name || ''} />
            <input type="hidden" name="product" value={account.product || ''} />

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Payment Amount
                </label>
                <input
                  type="number"
                  name="amount"
                  min="0.01"
                  max={payableAmount}
                  step="0.01"
                  required
                  placeholder="Enter payment amount"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Maximum allowed: {currency(payableAmount)}
                </p>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Payment Made On
                </label>
                <input
                  type="date"
                  name="paidOn"
                  defaultValue={todayDateString()}
                  max={todayDateString()}
                  required
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Payment Channel
                </label>
                <input
                  type="text"
                  name="paymentChannel"
                  placeholder="e.g. M-Pesa, Bank, Cash"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Transaction Code
                </label>
                <input
                  type="text"
                  name="transactionCode"
                  placeholder="e.g. QWERTY123"
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href={`/accounts/${id}`}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Link>

              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Save Payment
              </button>
            </div>
          </form>
        ) : null}

        <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Recent payment context</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Last Pay Date</p>
              <p className="mt-1 text-sm text-slate-700">{formatDate(account.last_pay_date)}</p>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Last Pay Amount</p>
              <p className="mt-1 text-sm text-slate-700">
                {currency(toMoney(account.last_pay_amount))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}