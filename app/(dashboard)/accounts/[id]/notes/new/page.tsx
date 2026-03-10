import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { currency, formatDate } from '@/lib/utils';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ add?: string }>;
};

type HistoryItem = {
  id: string;
  created_at: string;
  user: string;
  text: string;
  type: 'note' | 'ptp' | 'payment';
};

function pickUser(row: any) {
  return (
    row?.created_by_name ||
    row?.user_name ||
    row?.author_name ||
    row?.created_by ||
    'System User'
  );
}

function getVisibleNoteText(body: string | null | undefined) {
  const text = String(body || '').trim();
  if (!text) return '-';

  const notesMatch = text.match(/Notes:\s*([\s\S]+)/i);
  if (notesMatch?.[1]?.trim()) {
    return notesMatch[1].trim();
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const cleanedLines = lines.filter((line) => {
    const lower = line.toLowerCase();
    return !(
      lower.startsWith('disposition:') ||
      lower.startsWith('contact type:') ||
      lower.startsWith('contact status:') ||
      lower.startsWith('non payment reason:') ||
      lower.startsWith('call type:') ||
      lower.startsWith('next action:') ||
      lower.startsWith('next action date:')
    );
  });

  const cleaned = cleanedLines.join(' ').trim();
  return cleaned || text;
}

export default async function NotesHistoryPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const sp = (await searchParams) || {};
  const isAddMode = sp.add === '1';

  if (!supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Notes History</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const { data: account, error: accountError } = await supabase
    .from('accounts')
    .select('*')
    .eq('id', id)
    .single();

  if (accountError || !account) {
    notFound();
  }

  async function saveNote(formData: FormData) {
    'use server';

    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    const noteDetails = String(formData.get('noteDetails') || '').trim();

    if (!noteDetails) {
      throw new Error('Note details are required.');
    }

    const { error } = await supabase.from('notes').insert({
      company_id: account.company_id ?? 'b4f07164-1706-4904-a304-b38efb88ebf3',
      account_id: id,
      author_id: '11111111-1111-1111-1111-111111111111',
      created_by_name: 'System User',
      body: noteDetails,
    });

    if (error) {
      throw new Error(error.message);
    }

    redirect(`/accounts/${id}/notes/new`);
  }

  const [{ data: notes }, { data: ptps }, { data: payments }] = await Promise.all([
    supabase
      .from('notes')
      .select('*')
      .eq('account_id', id)
      .order('created_at', { ascending: false })
      .limit(200),

    supabase
      .from('ptps')
      .select('*')
      .eq('account_id', id)
      .order('created_at', { ascending: false })
      .limit(200),

    supabase
      .from('payments')
      .select('*')
      .eq('account_id', id)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  const history: HistoryItem[] = [
    ...(notes || []).map((n: any) => ({
      id: `note-${n.id}`,
      created_at: n.created_at,
      user: pickUser(n),
      text: getVisibleNoteText(n.body),
      type: 'note' as const,
    })),

    ...(ptps || []).map((p: any) => ({
      id: `ptp-${p.id}`,
      created_at: p.created_at,
      user: pickUser(p),
      text: `PTP booked: ${currency(Number(p.promised_amount || 0))} due ${formatDate(
        p.promised_date
      )}`,
      type: 'ptp' as const,
    })),

    ...(payments || []).map((pay: any) => ({
      id: `payment-${pay.id}`,
      created_at: pay.created_at || pay.paid_on,
      user: pickUser(pay),
      text: `Payment logged: ${currency(Number(pay.amount || 0))} | Payment made on: ${formatDate(
        pay.paid_on
      )} | Posted on: ${formatDate(pay.created_at || pay.paid_on)}`,
      type: 'payment' as const,
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link
          href={`/accounts/${id}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account Workspace
        </Link>

        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Notes History</h1>
            <p className="mt-1 text-slate-500">
              Full account history for <span className="font-medium">{account.debtor_name}</span>
            </p>
          </div>

          {!isAddMode ? (
            <Link
              href={`/accounts/${id}/notes/new?add=1`}
              className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Add Note
            </Link>
          ) : (
            <Link
              href={`/accounts/${id}/notes/new`}
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              View History
            </Link>
          )}
        </div>
      </div>

      {isAddMode ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form action={saveNote} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Note Details
              </label>
              <textarea
                name="noteDetails"
                rows={6}
                placeholder="e.g. customer asked to be called tomorrow"
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                required
              />
              <p className="mt-2 text-xs text-slate-500">
                Tip: Keep this short. Disposition/status is captured separately for reporting.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              <Link
                href={`/accounts/${id}/notes/new`}
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </Link>

              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Save Note
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {history.length > 0 ? (
            <div className="divide-y divide-slate-200">
              {history.map((item) => (
                <div key={item.id} className="px-5 py-4 text-sm text-slate-700">
                  <span className="text-slate-500">{formatDate(item.created_at)}</span>
                  <span className="mx-2 text-slate-300">•</span>
                  <span className="text-slate-500">{item.user}</span>
                  <span className="mx-2 text-slate-300">•</span>
                  <span>{item.text}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-5 text-sm text-slate-500">No history yet.</div>
          )}
        </div>
      )}
    </div>
  );
}