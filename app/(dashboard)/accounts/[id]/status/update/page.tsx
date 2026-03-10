import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { supabase } from '@/lib/supabase';

type PageProps = {
  params: Promise<{ id: string }>;
};

const CONTACT_TYPE_OPTIONS = [
  'Right Party Contact',
  'Third Party Contact',
  'Wrong Number',
  'No Answer',
  'Switched Off',
  'Voicemail',
  'Office Line',
  'SMS',
  'Email',
  'Walk In',
];

const CONTACT_STATUS_OPTIONS = [
  'Contacted',
  'Not Contacted',
  'Promise To Pay',
  'Paid',
  'Disputing Debt',
  'Requested Callback',
  'Refused to Pay',
  'Unreachable',
  'Wrong Number',
  'Escalated',
];

const NON_PAYMENT_REASON_OPTIONS = [
  '',
  'Financial Constraints',
  'Lost Job',
  'Business Downturn',
  'Salary Delayed',
  'Medical Reason',
  'Disputing Debt',
  'Already Paid',
  'Not Aware of Debt',
  'Wrong Allocation',
  'Awaiting Callback',
  'No Commitment',
  'Other',
];

const CALL_TYPE_OPTIONS = [
  '',
  'Inbound Call',
  'Outbound Call',
  'SMS Follow-up',
  'Email Follow-up',
  'Office Visit',
  'Field Visit',
];

const NEXT_ACTION_OPTIONS = [
  '',
  'Call Back',
  'Send Reminder SMS',
  'Send Demand Notice',
  'Await Payment',
  'Escalate Account',
  'Field Visit',
  'Skip Trace',
  'Close Follow-up',
];

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function deriveInteractionOutcome(values: {
  contactType: string;
  contactStatus: string;
  nonPaymentReason: string;
  nextAction: string;
}) {
  const { contactType, contactStatus, nonPaymentReason, nextAction } = values;

  if (contactStatus === 'Paid' || nonPaymentReason === 'Already Paid') {
    return 'Paid';
  }

  if (contactStatus === 'Promise To Pay') {
    return 'PTP';
  }

  if (contactStatus === 'Escalated' || nextAction === 'Escalate Account') {
    return 'Escalated';
  }

  if (contactStatus === 'Requested Callback' || nextAction === 'Call Back') {
    return 'Callback Requested';
  }

  if (contactType === 'Wrong Number' || contactStatus === 'Wrong Number') {
    return 'Wrong Number';
  }

  if (contactType === 'Switched Off') {
    return 'Phone Switched Off';
  }

  if (contactType === 'No Answer') {
    return 'Ringing No Response';
  }

  if (contactStatus === 'Disputing Debt' || nonPaymentReason === 'Disputing Debt') {
    return 'Disputing Debt';
  }

  if (contactStatus === 'Unreachable') {
    return 'No Contact';
  }

  if (contactStatus === 'Contacted' || contactType === 'Right Party Contact') {
    return 'Open';
  }

  return 'Open';
}

async function reassignAccountStrategy(accountId: string) {
  const adminKey = process.env.ADMIN_API_KEY;

  if (!adminKey || !accountId) {
    return;
  }

  const headerStore = await headers();
  const host =
    headerStore.get('x-forwarded-host') ||
    headerStore.get('host') ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    '';

  const proto =
    headerStore.get('x-forwarded-proto') ||
    (process.env.NODE_ENV === 'development' ? 'http' : 'https');

  if (!host) {
    return;
  }

  const baseUrl = host.startsWith('http://') || host.startsWith('https://')
    ? host
    : `${proto}://${host}`;

  const response = await fetch(`${baseUrl}/api/admin/account-strategy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-admin-key': adminKey,
    },
    body: JSON.stringify({
      accountId,
      source: 'auto',
      notes: 'Auto re-evaluated after disposition/status update.',
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Failed to auto re-evaluate strategy.');
  }
}

export default async function UpdateStatusPage({ params }: PageProps) {
  const { id } = await params;

  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Update Disposition</h1>
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

  const initialInteractionOutcome = deriveInteractionOutcome({
    contactType: account.contact_type || '',
    contactStatus: account.contact_status || '',
    nonPaymentReason: account.non_payment_reason || '',
    nextAction: '',
  });

  async function saveStatus(formData: FormData) {
    'use server';

    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    const contactType = String(formData.get('contact_type') || '').trim();
    const contactStatus = String(formData.get('contact_status') || '').trim();
    const nonPaymentReason = String(formData.get('non_payment_reason') || '').trim();
    const callType = String(formData.get('call_type') || '').trim();
    const nextAction = String(formData.get('next_action') || '').trim();
    const nextActionDate = String(formData.get('next_action_date') || '').trim();
    const notes = String(formData.get('notes') || '').trim();

    const interactionOutcome = deriveInteractionOutcome({
      contactType,
      contactStatus,
      nonPaymentReason,
      nextAction,
    });

    const updatePayload: Record<string, any> = {
      status: interactionOutcome,
      contact_type: contactType || null,
      contact_status: contactStatus || null,
      non_payment_reason: nonPaymentReason || null,
      next_action_date: nextActionDate || null,
      last_action_date: todayDateString(),
    };

    const { error: updateError } = await supabase
      .from('accounts')
      .update(updatePayload)
      .eq('id', id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await reassignAccountStrategy(id);

    const noteLines = [
      `Interaction Outcome: ${interactionOutcome}`,
      contactType ? `Contact Type: ${contactType}` : '',
      contactStatus ? `Contact Status: ${contactStatus}` : '',
      nonPaymentReason ? `Non Payment Reason: ${nonPaymentReason}` : '',
      callType ? `Call Type: ${callType}` : '',
      nextAction ? `Next Action: ${nextAction}` : '',
      nextActionDate ? `Next Action Date: ${nextActionDate}` : '',
      notes ? `Notes: ${notes}` : '',
    ].filter(Boolean);

    const { error: noteError } = await supabase.from('notes').insert({
      company_id: account.company_id,
      account_id: id,
      author_id: '11111111-1111-1111-1111-111111111111',
      created_by_name: 'System User',
      body: noteLines.join('\n'),
    });

    if (noteError) {
      throw new Error(noteError.message);
    }

    redirect(`/accounts/${id}`);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/accounts/${id}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account Workspace
        </Link>

        <h1 className="text-3xl font-semibold text-slate-900">Update Disposition</h1>
        <p className="mt-1 text-slate-500">
          Capture call outcome, follow-up details, and notes for{' '}
          <span className="font-medium">{account.debtor_name}</span>.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <form action={saveStatus} className="space-y-6">
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Interaction Outcome
              </label>
              <input
                type="text"
                value={initialInteractionOutcome}
                disabled
                className="w-full cursor-not-allowed rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm text-slate-500 outline-none"
              />
              <p className="mt-2 text-xs text-slate-500">
                This is filled automatically by the system from the disposition fields below.
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Contact Type
              </label>
              <select
                name="contact_type"
                defaultValue={account.contact_type || ''}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Select contact type</option>
                {CONTACT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Contact Status
              </label>
              <select
                name="contact_status"
                defaultValue={account.contact_status || ''}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Select contact status</option>
                {CONTACT_STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Non Payment Reason
              </label>
              <select
                name="non_payment_reason"
                defaultValue={account.non_payment_reason || ''}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                {NON_PAYMENT_REASON_OPTIONS.map((option) => (
                  <option key={option || 'blank'} value={option}>
                    {option || 'Select reason'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Call Type
              </label>
              <select
                name="call_type"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                {CALL_TYPE_OPTIONS.map((option) => (
                  <option key={option || 'blank'} value={option}>
                    {option || 'Select call type'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Next Action
              </label>
              <select
                name="next_action"
                defaultValue=""
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                {NEXT_ACTION_OPTIONS.map((option) => (
                  <option key={option || 'blank'} value={option}>
                    {option || 'Select next action'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Next Action Date
              </label>
              <input
                type="date"
                name="next_action_date"
                defaultValue={account.next_action_date || ''}
                min={todayDateString()}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              name="notes"
              rows={5}
              placeholder="Add any extra collection notes..."
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
          </div>

          <div className="flex items-center justify-end gap-3">
            <Link
              href={`/accounts/${id}`}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-5 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save Disposition
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}