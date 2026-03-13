import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type PageProps = {
  params: Promise<{ id: string }>;
};

function todayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default async function NewPtpPage({ params }: PageProps) {
  const { id } = await params;
  const today = todayDateString();

  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Book Promise To Pay</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const { data: account, error } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !account) {
    notFound();
  }

  async function savePtp(formData: FormData) {
    'use server';

    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    const promisedAmount = Number(formData.get('promisedAmount') || 0);
    const promisedDate = String(formData.get('promisedDate') || '').trim();
    const today = todayDateString();

    if (!promisedAmount || !promisedDate) {
      throw new Error('Promised amount and promised date are required.');
    }

    if (promisedDate < today) {
      throw new Error('Promised date cannot be in the past.');
    }

    const { data: lastBrokenPtp } = await supabase
      .from('ptps')
      .select('id,status,created_at')
      .eq('account_id', id)
      .eq('status', 'Broken')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const ptpStatus = 'Promise To Pay';
    const isRebooked = Boolean(lastBrokenPtp?.id);

    const { error: ptpError } = await supabase.from('ptps').insert({
      company_id: account.company_id,
      account_id: id,
      collector_name: account.collector_name || null,
      product: account.product || null,
      promised_amount: promisedAmount,
      promised_date: promisedDate,
      status: ptpStatus,
      parent_ptp_id: lastBrokenPtp?.id || null,
      is_rebooked: isRebooked,
      collector_id: null,
      kept_amount: 0,
      resolved_at: null,
      resolution_source: null,
    });

    if (ptpError) {
      throw new Error(ptpError.message);
    }

    const { error: accountUpdateError } = await supabase
      .from('accounts')
      .update({
        status: 'PTP',
        last_action_date: today,
        next_action_date: promisedDate,
      })
      .eq('id', id);

    if (accountUpdateError) {
      throw new Error(accountUpdateError.message);
    }

    const noteBody = isRebooked
      ? `PTP rebooked: ${promisedAmount} due on ${promisedDate}`
      : `PTP booked: ${promisedAmount} due on ${promisedDate}`;

    const { error: noteError } = await supabase.from('notes').insert({
      company_id: account.company_id,
      account_id: id,
      author_id: '11111111-1111-1111-1111-111111111111',
      created_by_name: 'System User',
      body: noteBody,
    });

    if (noteError) {
      throw new Error(noteError.message);
    }

    redirect(`/accounts/${id}`);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href={`/accounts/${id}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account Workspace
        </Link>
        <h1 className="text-3xl font-semibold text-slate-900">Book Promise To Pay</h1>
        <p className="mt-1 text-slate-500">
          Capture the promised payment amount and due date for{' '}
          <span className="font-medium">{account.debtor_name}</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <form action={savePtp} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Promised Amount
              </label>
              <input
                name="promisedAmount"
                type="number"
                min="1"
                step="0.01"
                placeholder="Enter promised amount"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Promised Date
              </label>
              <input
                name="promisedDate"
                type="date"
                min={today}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                required
              />
              <p className="mt-2 text-sm text-slate-500">
                Promised date can only be today or a future date.
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Each PTP is saved as a separate record for reporting. If a previous PTP on this
            account was broken, the new booking is saved as a rebook linked to that earlier
            broken promise.
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
              Save PTP
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}