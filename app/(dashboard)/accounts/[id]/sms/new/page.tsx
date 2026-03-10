'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { notFound, useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

type AccountRow = {
  id: string;
  debtor_name: string;
  primary_phone: string | null;
  secondary_phone: string | null;
  tertiary_phone: string | null;
};

type MessageType =
  | 'SMS Reminder'
  | 'Demand Notice'
  | 'Payment Reminder'
  | 'Follow Up SMS'
  | 'Custom';

function cleanPhone(value: string | null | undefined) {
  return String(value || '').trim();
}

function buildTemplate(messageType: MessageType, debtorName: string) {
  const name = debtorName || 'Customer';

  switch (messageType) {
    case 'SMS Reminder':
      return `Dear ${name}, this is a reminder regarding your outstanding account. Kindly contact us or make payment as discussed. Thank you.`;

    case 'Demand Notice':
      return `Dear ${name}, this is a formal demand notice regarding your outstanding account. Kindly make payment urgently or contact us for resolution. Thank you.`;

    case 'Payment Reminder':
      return `Dear ${name}, this is a payment reminder for your outstanding account. Please make payment or share your payment plan today. Thank you.`;

    case 'Follow Up SMS':
      return `Dear ${name}, we are following up on our previous engagement regarding your account. Kindly revert with your commitment. Thank you.`;

    case 'Custom':
    default:
      return '';
  }
}

export default function SendSmsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  const [account, setAccount] = useState<AccountRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [messageType, setMessageType] = useState<MessageType>('SMS Reminder');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    async function loadAccount() {
      if (!supabase) {
        setErrorMessage('Supabase is not configured.');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from('accounts')
        .select('id, debtor_name, primary_phone, secondary_phone, tertiary_phone')
        .eq('id', id)
        .single();

      if (error || !data) {
        setLoading(false);
        return;
      }

      const accountData = data as AccountRow;
      const numbers = [
        cleanPhone(accountData.primary_phone),
        cleanPhone(accountData.secondary_phone),
        cleanPhone(accountData.tertiary_phone),
      ].filter(Boolean);

      setAccount(accountData);
      setPhoneNumber(numbers[0] || '');
      setMessage(buildTemplate('SMS Reminder', accountData.debtor_name));
      setLoading(false);
    }

    if (id) {
      loadAccount();
    }
  }, [id]);

  const availableNumbers = useMemo(() => {
    if (!account) return [];
    return [
      cleanPhone(account.primary_phone),
      cleanPhone(account.secondary_phone),
      cleanPhone(account.tertiary_phone),
    ].filter(Boolean);
  }, [account]);

  function handleMessageTypeChange(value: MessageType) {
    setMessageType(value);

    if (!account) return;

    if (value === 'Custom') {
      setMessage('');
      return;
    }

    setMessage(buildTemplate(value, account.debtor_name));
  }

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!supabase) {
      setErrorMessage('Supabase is not configured.');
      return;
    }

    if (!phoneNumber || !message.trim()) {
      setErrorMessage('Phone number and message are required.');
      return;
    }

    if (!availableNumbers.includes(phoneNumber)) {
      setErrorMessage('Please select one of the phone numbers linked to this account.');
      return;
    }

    setSaving(true);
    setErrorMessage('');

    const body = [
      'SMS Activity',
      `Type: ${messageType}`,
      `Phone Number: ${phoneNumber}`,
      `Message: ${message.trim()}`,
      'Status: Queued manually from app',
    ].join('\n\n');

    const { error } = await supabase.from('notes').insert({
      company_id: 'b4f07164-1706-4904-a304-b38efb88ebf3',
      account_id: id,
      author_id: '11111111-1111-1111-1111-111111111111',
      body,
    });

    setSaving(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    router.push(`/accounts/${id}`);
    router.refresh();
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Send SMS / Reminder</h1>
        <p className="text-slate-500">Loading account...</p>
      </div>
    );
  }

  if (!account) {
    notFound();
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
        <h1 className="text-3xl font-semibold text-slate-900">Send SMS / Reminder</h1>
        <p className="mt-1 text-slate-500">
          Select a saved account number, choose a message template, or draft a custom message.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm text-slate-500">Customer</p>
          <p className="mt-1 font-medium text-slate-900">{account.debtor_name}</p>
        </div>

        {availableNumbers.length === 0 ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
            No phone numbers are saved on this account yet. Add at least one phone number before recording SMS activity.
          </div>
        ) : (
          <form onSubmit={handleSave} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Message Type
              </label>
              <select
                value={messageType}
                onChange={(event) => handleMessageTypeChange(event.target.value as MessageType)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                <option value="SMS Reminder">SMS Reminder</option>
                <option value="Demand Notice">Demand Notice</option>
                <option value="Payment Reminder">Payment Reminder</option>
                <option value="Follow Up SMS">Follow Up SMS</option>
                <option value="Custom">Custom</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Account Phone Number
              </label>
              <select
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              >
                {availableNumbers.map((phone, index) => (
                  <option key={phone} value={phone}>
                    {index === 0
                      ? `Primary - ${phone}`
                      : index === 1
                      ? `Secondary - ${phone}`
                      : `Tertiary - ${phone}`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Message
              </label>
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                rows={7}
                placeholder="Type the SMS or reminder message here..."
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                required
              />
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Template messages auto-fill based on the selected message type, but agents can still edit the text before saving.
            </div>

            {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href={`/accounts/${id}`}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Link>
              <button
                type="submit"
                disabled={saving}
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? 'Saving...' : 'Save SMS Activity'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}