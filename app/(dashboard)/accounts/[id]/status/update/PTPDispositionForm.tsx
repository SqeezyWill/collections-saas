'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

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
  'Debt Cleared',
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

type Props = {
  accountId: string;
  debtorName: string | null;
  defaultContactType: string;
  defaultContactStatus: string;
  defaultNonPaymentReason: string;
  defaultNextActionDate: string;
  today: string;
  initialInteractionOutcome: string;
  action: (formData: FormData) => void;
};

function deriveInteractionOutcome(values: {
  contactType: string;
  contactStatus: string;
  nonPaymentReason: string;
  nextAction: string;
}) {
  const { contactType, contactStatus, nonPaymentReason, nextAction } = values;

  if (contactStatus === 'Debt Cleared') {
    return 'Pending Closure Approval';
  }

  if (contactStatus === 'Paid' || nonPaymentReason === 'Already Paid') {
    return 'Paid';
  }

  if (contactStatus === 'Promise To Pay') {
    return 'Promise To Pay';
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

export default function PTPDispositionForm({
  accountId,
  debtorName,
  defaultContactType,
  defaultContactStatus,
  defaultNonPaymentReason,
  defaultNextActionDate,
  today,
  initialInteractionOutcome,
  action,
}: Props) {
  const [contactType, setContactType] = useState(defaultContactType || '');
  const [contactStatus, setContactStatus] = useState(defaultContactStatus || '');
  const [nonPaymentReason, setNonPaymentReason] = useState(defaultNonPaymentReason || '');
  const [nextAction, setNextAction] = useState('');
  const [ptpAmount, setPtpAmount] = useState('');
  const [ptpDueDate, setPtpDueDate] = useState('');
  const [pushForClosure, setPushForClosure] = useState(false);

  const showPtpFields = contactStatus === 'Promise To Pay';
  const isDebtCleared = contactStatus === 'Debt Cleared';

  const interactionOutcome = useMemo(() => {
    const derived =
      deriveInteractionOutcome({
        contactType,
        contactStatus,
        nonPaymentReason,
        nextAction,
      }) || initialInteractionOutcome;

    if (pushForClosure) {
      return 'Pending Closure Approval';
    }

    return derived;
  }, [
    contactType,
    contactStatus,
    nonPaymentReason,
    nextAction,
    initialInteractionOutcome,
    pushForClosure,
  ]);

  const showClosurePrompt =
    contactStatus === 'Debt Cleared' ||
    interactionOutcome === 'Paid' ||
    nonPaymentReason === 'Already Paid';

  return (
    <div className="space-y-6">
      <form action={action} className="space-y-6">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Interaction Outcome
            </label>
            <input
              type="text"
              value={interactionOutcome}
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
              value={contactType}
              onChange={(e) => setContactType(e.target.value)}
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
              value={contactStatus}
              onChange={(e) => setContactStatus(e.target.value)}
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

          {showClosurePrompt ? (
            <div className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <label className="flex items-start gap-3 text-sm text-amber-800">
                <input
                  type="checkbox"
                  name="push_for_closure"
                  value="yes"
                  checked={pushForClosure}
                  onChange={(e) => setPushForClosure(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-amber-300"
                />
                <span>
                  Balance appears cleared. Push this account for admin closure approval.
                  When selected, the account will move to{' '}
                  <span className="font-medium">Pending Closure Approval</span> and a note
                  will be written that the agent pushed the account for closure because the
                  client balance is 0.
                </span>
              </label>
            </div>
          ) : null}

          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">
              Non Payment Reason
            </label>
            <select
              name="non_payment_reason"
              value={nonPaymentReason}
              onChange={(e) => setNonPaymentReason(e.target.value)}
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
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              {NEXT_ACTION_OPTIONS.map((option) => (
                <option key={option || 'blank'} value={option}>
                  {option || 'Select next action'}
                </option>
              ))}
            </select>
          </div>

          {!showPtpFields ? (
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Next Action Date
              </label>
              <input
                type="date"
                name="next_action_date"
                defaultValue={defaultNextActionDate || ''}
                min={today}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>
          ) : null}
        </div>

        {showPtpFields ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Promise to Pay Details</h2>
              <p className="mt-1 text-sm text-slate-600">
                These fields are required when the disposition is Promise To Pay.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  PTP Amount
                </label>
                <input
                  type="number"
                  name="ptp_amount"
                  min="1"
                  step="0.01"
                  value={ptpAmount}
                  onChange={(e) => setPtpAmount(e.target.value)}
                  required={showPtpFields}
                  placeholder="Enter promised amount"
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  PTP Due Date
                </label>
                <input
                  type="date"
                  name="ptp_due_date"
                  min={today}
                  value={ptpDueDate}
                  onChange={(e) => setPtpDueDate(e.target.value)}
                  required={showPtpFields}
                  className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>
          </div>
        ) : null}

        {isDebtCleared ? (
          <div className="rounded-2xl border border-blue-200 bg-blue-50 p-5">
            <h2 className="text-lg font-semibold text-slate-900">Debt Cleared Review Flow</h2>
            <p className="mt-1 text-sm text-slate-600">
              This disposition does not close the account immediately. It marks the account for
              admin review so an admin can close or reopen it.
            </p>
          </div>
        ) : null}

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
            href={`/accounts/${accountId}`}
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
  );
}