import Link from 'next/link';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase-admin';

type PageProps = {
  params: Promise<{ id: string }>;
};

type StrategyRow = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  sort_order: number | null;
};

type AccountStrategyResponse = {
  assignment: null | {
    id: string;
    account_id: string;
    strategy_id: string;
    assigned_at: string | null;
    assigned_by: string | null;
    source: string | null;
    notes: string | null;
    is_active: boolean;
  };
  strategy: null | {
    id: string;
    name: string;
    description?: string | null;
    is_active: boolean;
    sort_order?: number | null;
  };
};

async function getBaseUrl() {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000';
  const proto = h.get('x-forwarded-proto') || 'http';
  return `${proto}://${host}`;
}

async function getBearerToken() {
  const h = await headers();
  const authHeader = h.get('authorization') || h.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return '';
}

async function resolveCurrentUserRole() {
  if (!supabaseAdmin) return null;

  const token = await getBearerToken();
  if (!token) return null;

  const {
    data: { user },
    error: userError,
  } = await supabaseAdmin.auth.getUser(token);

  if (userError || !user) return null;

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile) return null;

  return String(profile.role || '').trim().toLowerCase();
}

async function fetchAccountStrategy(
  accountId: string,
  token: string
): Promise<AccountStrategyResponse> {
  if (!token) return { assignment: null, strategy: null };

  const baseUrl = await getBaseUrl();
  const res = await fetch(
    `${baseUrl}/api/admin/account-strategy?accountId=${encodeURIComponent(accountId)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    }
  );

  if (!res.ok) return { assignment: null, strategy: null };

  const json = (await res.json().catch(() => null)) as AccountStrategyResponse | null;
  return json || { assignment: null, strategy: null };
}

async function fetchStrategies(token: string): Promise<StrategyRow[]> {
  if (!token) return [];

  const baseUrl = await getBaseUrl();
  const res = await fetch(`${baseUrl}/api/admin/strategies`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!res.ok) return [];

  const json = (await res.json().catch(() => null)) as { strategies?: any[] } | null;
  const list = (json?.strategies ?? []) as any[];

  return list.map((s) => ({
    id: String(s.id),
    name: String(s.name || ''),
    description: s.description ?? null,
    is_active: Boolean(s.is_active),
    sort_order: typeof s.sort_order === 'number' ? s.sort_order : null,
  }));
}

export default async function AccountStrategyPage({ params }: PageProps) {
  const { id: accountId } = await params;

  const token = await getBearerToken();
  const role = await resolveCurrentUserRole();

  if (role !== 'admin' && role !== 'super_admin') {
    redirect(`/accounts/${accountId}`);
  }

  const current = await fetchAccountStrategy(accountId, token);
  const strategies = await fetchStrategies(token);

  async function assignStrategy(formData: FormData) {
    'use server';

    const token = await getBearerToken();
    const role = await resolveCurrentUserRole();

    if (!token || (role !== 'admin' && role !== 'super_admin')) {
      redirect(`/accounts/${accountId}`);
    }

    const strategyId = String(formData.get('strategyId') || '').trim();
    if (!strategyId) {
      redirect(`/accounts/${accountId}/strategy?error=missing_strategy`);
    }

    const baseUrl = await getBaseUrl();

    const res = await fetch(`${baseUrl}/api/admin/account-strategy`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        accountId,
        strategyId,
        source: 'manual',
      }),
    });

    if (!res.ok) {
      redirect(`/accounts/${accountId}/strategy?error=save_failed`);
    }

    redirect(`/accounts/${accountId}`);
  }

  const currentName = current.strategy?.name || 'No strategy assigned';
  const currentDesc = current.strategy?.description || null;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/accounts/${accountId}`}
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Account
        </Link>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">Change Strategy</h1>
            <p className="mt-1 text-slate-500">
              Assign a collection strategy to this account.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Current Strategy</h2>

        <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-900">{currentName}</span>

            {current.strategy ? (
              <span
                className={[
                  'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                  current.strategy.is_active
                    ? 'bg-emerald-100 text-emerald-700'
                    : 'bg-slate-100 text-slate-700',
                ].join(' ')}
              >
                {current.strategy.is_active ? 'Active' : 'Inactive'}
              </span>
            ) : null}

            {current.strategy?.id ? (
              <span className="text-xs text-slate-400">{current.strategy.id}</span>
            ) : null}
          </div>

          {currentDesc ? <p className="mt-2 text-sm text-slate-600">{currentDesc}</p> : null}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Assign New Strategy</h2>
        <p className="mt-1 text-sm text-slate-500">
          Select a strategy and click Save. This will overwrite the active assignment for this
          account.
        </p>

        <form action={assignStrategy} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Strategy</label>
            <select
              name="strategyId"
              defaultValue={current.assignment?.strategy_id || ''}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            >
              <option value="">— Select a strategy —</option>

              {strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.is_active ? '' : '(Inactive)'}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap gap-3 border-t border-slate-200 pt-4">
            <Link
              href={`/accounts/${accountId}`}
              className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </Link>

            <button
              type="submit"
              className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
            >
              Save Strategy
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}