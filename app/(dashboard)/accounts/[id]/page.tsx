import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { currency, formatDate } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { AccountStrategyActions } from '@/components/AccountStrategyActions';
import { getRequestUserProfile } from '@/lib/server-auth';

type PageProps = {
  params: Promise<{ id: string }>;
};

type UserProfile = {
  id: string;
  name?: string | null;
  role: string | null;
  company_id: string | null;
};

const ASSIGN_TABLE = 'account_strategies';
const ACCOUNTS_TABLE = 'accounts';
const STRATEGIES_TABLE = 'strategies';
const MAP_TABLE = 'strategy_products';
const PRODUCTS_TABLE = 'products';

function compactPhones(values: Array<string | null | undefined>) {
  return values.map((v) => String(v || '').trim()).filter(Boolean);
}

function detailValue(value: unknown) {
  if (value === null || value === undefined) return '-';
  const text = String(value).trim();
  return text.length > 0 ? text : '-';
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeRole(role: string | null | undefined) {
  return String(role || '').trim().toLowerCase();
}

function isClosedStatus(value: unknown) {
  return normalize(value) === 'closed';
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseDateLike(value: unknown): Date | null {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw || raw === '0') return null;

  const isoOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoOnly) {
    const year = Number(isoOnly[1]);
    const month = Number(isoOnly[2]);
    const day = Number(isoOnly[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  const ddmmyyyy = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (ddmmyyyy) {
    const day = Number(ddmmyyyy[1]);
    const month = Number(ddmmyyyy[2]);
    const year = Number(ddmmyyyy[3]);
    const parsed = new Date(year, month - 1, day);

    if (
      parsed.getFullYear() !== year ||
      parsed.getMonth() !== month - 1 ||
      parsed.getDate() !== day
    ) {
      return null;
    }

    return parsed;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function diffInDays(from: Date, to: Date) {
  const start = startOfLocalDay(from).getTime();
  const end = startOfLocalDay(to).getTime();
  return Math.floor((end - start) / 86400000);
}

function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

function getDpdAnchorDate(account: any): Date | null {
  return (
    parseDateLike(account?.created_at) ||
    parseDateLike(account?.uploaded_at) ||
    parseDateLike(account?.outsource_date) ||
    null
  );
}

function getEffectiveDpd(account: any): number | null {
  const baseDpd = parseNumber(account?.dpd);
  if (baseDpd == null) return null;

  const anchor = getDpdAnchorDate(account);
  if (!anchor) return baseDpd;

  const today = new Date();
  const daysElapsed = Math.max(0, diffInDays(anchor, today));

  return baseDpd + daysElapsed;
}

function getBucketLabel(account: any, dpd: number | null) {
  if (isClosedStatus(account?.status)) return 'Closed';
  if (dpd == null) return 'Unknown';
  if (dpd <= 0) return 'Current';
  if (dpd >= 1 && dpd <= 30) return '1-30';
  if (dpd >= 31 && dpd <= 60) return '31-60';
  if (dpd >= 61 && dpd <= 90) return '61-90';
  if (dpd >= 91 && dpd <= 120) return '91-120';
  return '121+';
}

function getBucketMeta(dpd: number | null) {
  if (dpd == null) {
    return {
      key: 'unknown',
      label: 'Unknown',
      aliases: [] as string[],
    };
  }

  if (dpd <= 0) {
    return {
      key: 'current',
      label: 'Current',
      aliases: ['current', '0', '0+', 'dpd 0', '0-0'],
    };
  }

  if (dpd >= 1 && dpd <= 30) {
    return {
      key: '1_30',
      label: '1-30',
      aliases: ['1-30', '01-30', '1 to 30', 'dpd 1-30', '1_30', '1–30'],
    };
  }

  if (dpd >= 31 && dpd <= 60) {
    return {
      key: '31_60',
      label: '31-60',
      aliases: ['31-60', '31 to 60', 'dpd 31-60', '31_60', '31–60'],
    };
  }

  if (dpd >= 61 && dpd <= 90) {
    return {
      key: '61_90',
      label: '61-90',
      aliases: ['61-90', '61 to 90', 'dpd 61-90', '61_90', '61–90'],
    };
  }

  if (dpd >= 91 && dpd <= 120) {
    return {
      key: '91_120',
      label: '91-120',
      aliases: ['91-120', '91 to 120', 'dpd 91-120', '91_120', '91–120'],
    };
  }

  return {
    key: '121_plus',
    label: '121+',
    aliases: [
      '121+',
      '121 plus',
      '120+',
      '120 plus',
      '121_and_above',
      '121 and above',
      'over 120',
    ],
  };
}

function matchesBucket(strategy: any, bucketAliases: string[]) {
  const haystack = `${normalize(strategy?.name)} ${normalize(strategy?.description)}`;
  return bucketAliases.some((alias) => haystack.includes(normalize(alias)));
}

function getDueState(dateValue: unknown) {
  const parsed = parseDateLike(dateValue);
  if (!parsed) {
    return {
      label: 'No due date set',
      tone: 'bg-slate-100 text-slate-700',
      delta: null as number | null,
    };
  }

  const today = new Date();
  const delta = diffInDays(today, parsed);

  if (delta < 0) {
    return {
      label: `${Math.abs(delta)} day(s) overdue`,
      tone: 'bg-rose-100 text-rose-700',
      delta,
    };
  }

  if (delta === 0) {
    return {
      label: 'Due today',
      tone: 'bg-amber-100 text-amber-700',
      delta,
    };
  }

  return {
    label: `Due in ${delta} day(s)`,
    tone: 'bg-emerald-100 text-emerald-700',
    delta,
  };
}

function getPriorityMeta(account: any, effectiveDpd: number | null) {
  const nextAction = getDueState(account?.next_action_date);
  const balance = Number(account?.balance || 0);
  const status = String(account?.status || '').trim();

  if (nextAction.delta !== null && nextAction.delta < 0) {
    return {
      label: 'Urgent follow-up',
      tone: 'bg-rose-100 text-rose-700',
      reason: 'Next action date has passed.',
    };
  }

  if (status === 'Broken' || status === 'Escalated') {
    return {
      label: 'High priority',
      tone: 'bg-rose-100 text-rose-700',
      reason: 'Account is broken or escalated.',
    };
  }

  if (status === 'PTP' || status === 'Promise To Pay') {
    return {
      label: 'Priority monitoring',
      tone: 'bg-amber-100 text-amber-700',
      reason: 'Promise to pay needs monitoring.',
    };
  }

  if ((effectiveDpd ?? 0) >= 90 || balance >= 50000) {
    return {
      label: 'Management attention',
      tone: 'bg-orange-100 text-orange-700',
      reason: 'High delinquency or high balance.',
    };
  }

  return {
    label: 'Normal follow-up',
    tone: 'bg-slate-100 text-slate-700',
    reason: 'Routine account handling.',
  };
}

function getComputedDueDate(account: any): Date | null {
  const storedDueDate =
    parseDateLike(account?.due_date) || parseDateLike(account?.loan_due_date);

  if (storedDueDate) return storedDueDate;

  const fundedDate =
    parseDateLike(account?.funded_date) || parseDateLike(account?.loan_taken_date);

  const duration = parseNumber(account?.duration);

  if (!fundedDate || duration == null) return null;

  return addDays(fundedDate, Math.trunc(duration));
}

function getDaysSinceFunded(account: any): number | null {
  const fundedDate =
    parseDateLike(account?.funded_date) || parseDateLike(account?.loan_taken_date);

  if (!fundedDate) return null;

  return Math.max(0, diffInDays(fundedDate, new Date()));
}

function getLoanTimelineMeta(account: any) {
  const fundedDate =
    parseDateLike(account?.funded_date) || parseDateLike(account?.loan_taken_date);
  const computedDueDate = getComputedDueDate(account);
  const duration = parseNumber(account?.duration);
  const daysSinceFunded = getDaysSinceFunded(account);

  let maturityLabel = 'Timeline unavailable';
  let maturityTone = 'bg-slate-100 text-slate-700';

  if (computedDueDate) {
    const delta = diffInDays(new Date(), computedDueDate);
    if (delta < 0) {
      maturityLabel = `${Math.abs(delta)} day(s) past expected maturity`;
      maturityTone = 'bg-rose-100 text-rose-700';
    } else if (delta === 0) {
      maturityLabel = 'Expected to mature today';
      maturityTone = 'bg-amber-100 text-amber-700';
    } else {
      maturityLabel = `${delta} day(s) to expected maturity`;
      maturityTone = 'bg-emerald-100 text-emerald-700';
    }
  }

  return {
    fundedDate,
    computedDueDate,
    duration,
    daysSinceFunded,
    maturityLabel,
    maturityTone,
  };
}

function DetailTable({
  rows,
}: {
  rows: Array<{ label: string; value: React.ReactNode }>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full text-sm">
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={row.label}
              className={index === rows.length - 1 ? '' : 'border-b border-slate-200'}
            >
              <td className="w-[42%] bg-slate-50 px-4 py-4 font-semibold text-slate-700">
                {row.label}
              </td>
              <td className="px-4 py-4 text-slate-900">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

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
    steps?: any[];
    created_at?: string | null;
    updated_at?: string | null;
  };
};

async function fetchAccountStrategy(accountId: string): Promise<AccountStrategyResponse | null> {
  if (!supabaseAdmin) return null;

  const { data: assignment, error: aErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .select('id,account_id,strategy_id,assigned_at,assigned_by,source,notes,is_active')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (aErr || !assignment) {
    return { assignment: null, strategy: null };
  }

  const { data: strategy } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .select('id,name,description,is_active,sort_order,steps,created_at,updated_at')
    .eq('id', assignment.strategy_id)
    .maybeSingle();

  return {
    assignment,
    strategy: strategy ?? null,
  };
}

async function resolveAutoStrategy(accountId: string) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin not configured.');
  }

  const { data: acct, error: acctErr } = await supabaseAdmin
    .from(ACCOUNTS_TABLE)
    .select('id,product_code,dpd')
    .eq('id', accountId)
    .maybeSingle();

  if (acctErr) throw new Error(acctErr.message);
  if (!acct) throw new Error('Account not found.');

  const productCode = normalize(acct.product_code);
  if (!productCode) {
    throw new Error('Account has no product_code. Set accounts.product_code first, then auto-assign.');
  }

  const dpd = getEffectiveDpd(acct);
  const bucket = getBucketMeta(dpd);

  const { data: product, error: pErr } = await supabaseAdmin
    .from(PRODUCTS_TABLE)
    .select('id,code,is_active')
    .eq('code', productCode)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);
  if (!product || product.is_active === false) {
    throw new Error(`Unknown or inactive product_code: ${productCode}`);
  }

  const { data: mapped, error: mErr } = await supabaseAdmin
    .from(MAP_TABLE)
    .select('strategy_id,is_active')
    .eq('product_id', product.id);

  if (mErr) throw new Error(mErr.message);

  const mappedStrategyIds = (mapped ?? [])
    .filter((r: any) => r && r.is_active !== false)
    .map((r: any) => String(r.strategy_id));

  if (mappedStrategyIds.length === 0) {
    throw new Error(`No strategies mapped to product_code=${productCode} yet.`);
  }

  const { data: strategies, error: sErr } = await supabaseAdmin
    .from(STRATEGIES_TABLE)
    .select('id,name,description,is_active,sort_order,created_at')
    .in('id', mappedStrategyIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false });

  if (sErr) throw new Error(sErr.message);

  const activeStrategies = strategies ?? [];
  if (activeStrategies.length === 0) {
    throw new Error('No active strategy found for this product.');
  }

  const bucketSpecific = activeStrategies.find((strategy: any) =>
    matchesBucket(strategy, bucket.aliases)
  );

  const chosen = bucketSpecific ?? activeStrategies[0];

  return {
    strategyId: String(chosen.id),
    notes: [
      'Manual re-evaluation from account page.',
      `product=${productCode}`,
      `dpd=${dpd ?? 'unknown'}`,
      `bucket=${bucket.label}`,
      `match=${bucketSpecific ? 'product_and_bucket' : 'product_fallback'}`,
    ].join(' '),
  };
}

function actionLinkClasses(disabled: boolean) {
  return disabled
    ? 'inline-flex min-w-[150px] cursor-not-allowed items-center justify-center rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 text-sm font-medium text-slate-400'
    : 'inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50';
}

export default async function AccountDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!supabaseAdmin || !supabase) {
    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Account Workspace</h1>
        <p className="text-red-600">Supabase is not configured.</p>
      </div>
    );
  }

  const authResult = await getRequestUserProfile();

  if ('error' in authResult) {
    if (authResult.status === 401) {
      redirect('/login');
    }

    return (
      <div className="space-y-4">
        <h1 className="text-3xl font-semibold">Account Workspace</h1>
        <p className="text-red-600">{authResult.error}</p>
      </div>
    );
  }

  const { data: accountOnly, error: accountOnlyError } = await supabaseAdmin
    .from('accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (accountOnlyError || !accountOnly) {
    notFound();
  }

  let resolvedCompanyId = String(authResult.company_id || '').trim();

  if (!resolvedCompanyId) {
    resolvedCompanyId = String(accountOnly.company_id || '').trim();

    if (!resolvedCompanyId) {
      const { data: fixedCompany, error: fixedCompanyError } = await supabaseAdmin
        .from('companies')
        .select('id,name,code')
        .or('name.eq.Pezesha,code.eq.Pezesha')
        .limit(1)
        .maybeSingle();

      if (fixedCompanyError || !fixedCompany?.id) {
        return (
          <div className="space-y-4">
            <h1 className="text-3xl font-semibold">Account Workspace</h1>
            <p className="text-red-600">Unable to resolve Pezesha company.</p>
          </div>
        );
      }

      resolvedCompanyId = String(fixedCompany.id);
    }
  }

  const profile: UserProfile = {
    id: String(authResult.id),
    name: authResult.name ?? null,
    role: authResult.role ?? null,
    company_id: resolvedCompanyId,
  };

  const normalizedRole = normalizeRole(profile.role);
  const isAgent = normalizedRole === 'agent';
  const canManageAssignments =
    normalizedRole === 'super_admin' || normalizedRole === 'admin';
  const canCloseOrReopen =
    normalizedRole === 'super_admin' || normalizedRole === 'admin';
  const canEditBalances =
    normalizedRole === 'super_admin' || normalizedRole === 'admin';
  const collectorScope = String(profile.name || '').trim();

  async function reEvaluateStrategy() {
    'use server';

    if (!supabaseAdmin) {
      throw new Error('Supabase admin is not configured.');
    }

    if (!canManageAssignments) {
      throw new Error('You do not have permission to re-evaluate strategy.');
    }

    const currentAccount = await supabaseAdmin
      .from('accounts')
      .select('status')
      .eq('id', id)
      .maybeSingle();

    if (isClosedStatus(currentAccount.data?.status)) {
      throw new Error('Closed accounts cannot be updated. Reopen the account first.');
    }

    const resolved = await resolveAutoStrategy(id);

    const { data: currentActive, error: currentErr } = await supabaseAdmin
      .from(ASSIGN_TABLE)
      .select('id,strategy_id,is_active')
      .eq('account_id', id)
      .eq('is_active', true)
      .order('assigned_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (currentErr) {
      throw new Error(currentErr.message);
    }

    if (currentActive && String(currentActive.strategy_id) === resolved.strategyId) {
      redirect(`/accounts/${id}`);
    }

    const { error: offErr } = await supabaseAdmin
      .from(ASSIGN_TABLE)
      .update({ is_active: false })
      .eq('account_id', id)
      .eq('is_active', true);

    if (offErr) {
      throw new Error(offErr.message);
    }

    const { error: insErr } = await supabaseAdmin.from(ASSIGN_TABLE).insert({
      account_id: id,
      strategy_id: resolved.strategyId,
      source: 'auto',
      notes: resolved.notes,
      is_active: true,
    });

    if (insErr) {
      throw new Error(insErr.message);
    }

    redirect(`/accounts/${id}`);
  }

  async function closeAccount() {
    'use server';

    if (!supabaseAdmin) {
      throw new Error('Supabase admin is not configured.');
    }

    if (!canCloseOrReopen) {
      throw new Error('You do not have permission to close accounts.');
    }

    const { data: currentAccount, error: readError } = await supabaseAdmin
      .from('accounts')
      .select('id,status,company_id')
      .eq('id', id)
      .maybeSingle();

    if (readError || !currentAccount) {
      throw new Error(readError?.message || 'Account not found.');
    }

    if (isClosedStatus(currentAccount.status)) {
      redirect(`/accounts/${id}`);
    }

    const today = new Date().toISOString().slice(0, 10);

    const { error: updateError } = await supabaseAdmin
      .from('accounts')
      .update({
        status: 'Closed',
        last_action_date: today,
      })
      .eq('id', id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin.from('notes').insert({
      company_id: currentAccount.company_id,
      account_id: id,
      author_id: '11111111-1111-1111-1111-111111111111',
      created_by_name: 'System User',
      body: 'Admin action: Account closed. Notes and account changes are now locked until reopened.',
    });

    redirect(`/accounts/${id}`);
  }

  async function reopenAccount() {
    'use server';

    if (!supabaseAdmin) {
      throw new Error('Supabase admin is not configured.');
    }

    if (!canCloseOrReopen) {
      throw new Error('You do not have permission to reopen accounts.');
    }

    const { data: currentAccount, error: readError } = await supabaseAdmin
      .from('accounts')
      .select('id,status,company_id')
      .eq('id', id)
      .maybeSingle();

    if (readError || !currentAccount) {
      throw new Error(readError?.message || 'Account not found.');
    }

    if (!isClosedStatus(currentAccount.status)) {
      redirect(`/accounts/${id}`);
    }

    const today = new Date().toISOString().slice(0, 10);

    const { error: updateError } = await supabaseAdmin
      .from('accounts')
      .update({
        status: 'Open',
        last_action_date: today,
      })
      .eq('id', id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin.from('notes').insert({
      company_id: currentAccount.company_id,
      account_id: id,
      author_id: '11111111-1111-1111-1111-111111111111',
      created_by_name: 'System User',
      body: 'Admin action: Account reopened. Notes and account updates are enabled again.',
    });

    redirect(`/accounts/${id}`);
  }

  async function saveBalanceCorrection(formData: FormData) {
    'use server';

    if (!supabaseAdmin) {
      throw new Error('Supabase admin is not configured.');
    }

    if (!canEditBalances) {
      throw new Error('You do not have permission to edit balances.');
    }

    const targetAccountId = String(formData.get('accountId') || '').trim();
    const newBalanceRaw = String(formData.get('balance') || '').replace(/,/g, '').trim();
    const newTotalDueRaw = String(formData.get('totalDue') || '').replace(/,/g, '').trim();
    const newAmountPaidRaw = String(formData.get('amountPaid') || '').replace(/,/g, '').trim();
    const reason = String(formData.get('reason') || '').trim();

    const newBalance = Number(newBalanceRaw);
    const newTotalDue = Number(newTotalDueRaw);
    const newAmountPaid = Number(newAmountPaidRaw);

    if (!targetAccountId) {
      throw new Error('Missing account id.');
    }

    if (!Number.isFinite(newBalance) || newBalance < 0) {
      throw new Error('Balance must be a valid number greater than or equal to 0.');
    }

    if (!Number.isFinite(newTotalDue) || newTotalDue < 0) {
      throw new Error('Total due must be a valid number greater than or equal to 0.');
    }

    if (!Number.isFinite(newAmountPaid) || newAmountPaid < 0) {
      throw new Error('Amount paid must be a valid number greater than or equal to 0.');
    }

    if (!reason) {
      throw new Error('Please provide a reason for the account correction.');
    }

    const { data: currentAccount, error: readError } = await supabaseAdmin
      .from('accounts')
      .select('id,company_id,balance,total_due,amount_paid')
      .eq('id', targetAccountId)
      .maybeSingle();

    if (readError || !currentAccount) {
      throw new Error(readError?.message || 'Account not found.');
    }

    const today = new Date().toISOString().slice(0, 10);

    const { error: updateError } = await supabaseAdmin
      .from('accounts')
      .update({
        balance: newBalance,
        total_due: newTotalDue,
        amount_paid: newAmountPaid,
        last_action_date: today,
      })
      .eq('id', targetAccountId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin.from('notes').insert({
      company_id: currentAccount.company_id,
      account_id: targetAccountId,
      created_by_name: 'System User',
      body: [
        'Admin account totals correction applied.',
        `Previous Balance: ${currency(Number(currentAccount.balance || 0))}`,
        `New Balance: ${currency(newBalance)}`,
        `Previous Total Due: ${currency(Number(currentAccount.total_due || 0))}`,
        `New Total Due: ${currency(newTotalDue)}`,
        `Previous Amount Paid: ${currency(Number(currentAccount.amount_paid || 0))}`,
        `New Amount Paid: ${currency(newAmountPaid)}`,
        `Reason: ${reason}`,
      ].join(' | '),
    });

    redirect(`/accounts/${targetAccountId}`);
  }

  async function reversePayment(formData: FormData) {
    'use server';

    if (!supabaseAdmin) {
      throw new Error('Supabase admin is not configured.');
    }

    if (!canEditBalances) {
      throw new Error('You do not have permission to reverse payments.');
    }

    const targetAccountId = String(formData.get('accountId') || '').trim();
    const paymentId = String(formData.get('paymentId') || '').trim();
    const reason = String(formData.get('reason') || '').trim();

    if (!targetAccountId || !paymentId) {
      throw new Error('Missing account or payment id.');
    }

    if (!reason) {
      throw new Error('Please provide a reason for unlogging the payment.');
    }

    const { data: payment, error: paymentError } = await supabaseAdmin
      .from('payments')
      .select('id, account_id, amount, paid_on, product')
      .eq('id', paymentId)
      .eq('account_id', targetAccountId)
      .maybeSingle();

    if (paymentError || !payment) {
      throw new Error(paymentError?.message || 'Payment not found.');
    }

    const { data: currentAccount, error: accountError } = await supabaseAdmin
      .from('accounts')
      .select('id, company_id, balance, total_due, amount_paid, last_action_date')
      .eq('id', targetAccountId)
      .maybeSingle();

    if (accountError || !currentAccount) {
      throw new Error(accountError?.message || 'Account not found.');
    }

    const paymentAmount = Number(payment.amount || 0);
    const currentBalance = Number(currentAccount.balance || 0);
    const currentTotalDue = Number(currentAccount.total_due || 0);
    const currentAmountPaid = Number(currentAccount.amount_paid || 0);

    const updatedAmountPaid = Math.max(0, currentAmountPaid - paymentAmount);

    let newBalance = currentBalance;
    let newTotalDue = currentTotalDue;

    if (currentBalance > 0) {
      newBalance = currentBalance + paymentAmount;
    } else {
      newTotalDue = currentTotalDue + paymentAmount;
    }

    const { error: deleteError } = await supabaseAdmin
      .from('payments')
      .delete()
      .eq('id', paymentId);

    if (deleteError) {
      throw new Error(deleteError.message);
    }

    const today = new Date().toISOString().slice(0, 10);

    const { error: updateError } = await supabaseAdmin
      .from('accounts')
      .update({
        amount_paid: updatedAmountPaid,
        balance: newBalance,
        total_due: newTotalDue,
        last_action_date: today,
      })
      .eq('id', targetAccountId);

    if (updateError) {
      throw new Error(updateError.message);
    }

    await supabaseAdmin.from('notes').insert({
      company_id: currentAccount.company_id,
      account_id: targetAccountId,
      created_by_name: 'System User',
      body: [
        'Admin payment reversal applied.',
        `Removed Payment: ${currency(paymentAmount)}`,
        `Payment Date: ${payment.paid_on || '-'}`,
        `Product: ${payment.product || '-'}`,
        `New Amount Paid: ${currency(updatedAmountPaid)}`,
        `New Balance: ${currency(newBalance)}`,
        `New Total Due: ${currency(newTotalDue)}`,
        `Reason: ${reason}`,
      ].join(' | '),
    });

    redirect(`/accounts/${targetAccountId}`);
  }

  let accountQuery = supabaseAdmin
    .from('accounts')
    .select('*')
    .eq('id', id)
    .eq('company_id', String(profile.company_id || resolvedCompanyId));

  if (isAgent && collectorScope) {
    accountQuery = accountQuery.eq('collector_name', collectorScope);
  }

  let { data: account, error } = await accountQuery.maybeSingle();

  if ((!account || error) && isAgent) {
    const fallback = await supabaseAdmin
      .from('accounts')
      .select('*')
      .eq('id', id)
      .eq('company_id', String(profile.company_id || resolvedCompanyId))
      .maybeSingle();

    account = fallback.data;
    error = fallback.error;
  }

  if (error || !account) {
    notFound();
  }

  const isClosed = isClosedStatus(account.status);

  const phones = compactPhones([
    account.primary_phone,
    account.secondary_phone,
    account.tertiary_phone,
  ]);

  const { data: ptps } = await supabaseAdmin
    .from('ptps')
    .select('*')
    .eq('account_id', id)
    .order('created_at', { ascending: false })
    .limit(10);

  const { data: payments } = await supabaseAdmin
    .from('payments')
    .select('*')
    .eq('account_id', id)
    .order('paid_on', { ascending: false })
    .limit(10);

  const { data: notes } = await supabaseAdmin
    .from('notes')
    .select('*')
    .eq('account_id', id)
    .order('created_at', { ascending: false })
    .limit(10);

  let relatedFacilitiesQuery = account.customer_id
    ? supabaseAdmin
        .from('accounts')
        .select('id,debtor_name,account_no,product,portfolio_category,balance,status,dpd,collector_name')
        .eq('customer_id', account.customer_id)
        .eq('company_id', String(profile.company_id || resolvedCompanyId))
        .neq('id', id)
        .order('created_at', { ascending: false })
        .limit(10)
    : null;

  if (relatedFacilitiesQuery && isAgent && collectorScope) {
    relatedFacilitiesQuery = relatedFacilitiesQuery.eq('collector_name', collectorScope);
  }

  const relatedFacilitiesResult = relatedFacilitiesQuery
    ? await relatedFacilitiesQuery
    : { data: [] as any[] };

  const relatedFacilities = relatedFacilitiesResult.data ?? [];

  const strategyResp = await fetchAccountStrategy(id);
  const assignedStrategy = strategyResp?.strategy ?? null;
  const strategyAssignment = strategyResp?.assignment ?? null;

  const effectiveDpd = getEffectiveDpd(account);
  const bucketLabel = getBucketLabel(account, effectiveDpd);
  const storedDpd = parseNumber(account.dpd);
  const stepsCount = Array.isArray(assignedStrategy?.steps) ? assignedStrategy.steps.length : 0;
  const dueMeta = getDueState(account.next_action_date);
  const priorityMeta = getPriorityMeta(account, effectiveDpd);
  const loanTimeline = getLoanTimelineMeta(account);

  const statusClasses =
    account.status === 'PTP'
      ? 'bg-amber-100 text-amber-700'
      : account.status === 'Paid'
      ? 'bg-emerald-100 text-emerald-700'
      : account.status === 'Escalated'
      ? 'bg-rose-100 text-rose-700'
      : account.status === 'Broken'
      ? 'bg-rose-100 text-rose-700'
      : account.status === 'Closed'
      ? 'bg-slate-900 text-white'
      : account.status === 'Pending Closure Approval'
      ? 'bg-blue-100 text-blue-700'
      : 'bg-slate-100 text-slate-700';

  const basicDetails = [
    { label: 'Debtor Name', value: detailValue(account.debtor_name) },
    { label: 'Identification', value: detailValue(account.identification) },
    { label: 'Account Number', value: detailValue(account.account_no) },
    { label: 'Customer ID', value: detailValue(account.customer_id) },
    { label: 'CFID', value: detailValue(account.cfid) },
    { label: 'Collector', value: detailValue(account.collector_name) },
    {
      label: 'Phone Number(s)',
      value:
        phones.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {phones.map((phone) => (
              <span
                key={phone}
                className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
              >
                {phone}
              </span>
            ))}
          </div>
        ) : (
          '-'
        ),
    },
    { label: 'Primary Phone', value: detailValue(account.primary_phone) },
    { label: 'Other Contacts', value: detailValue(account.contacts) },
    { label: 'Employment Status', value: detailValue(account.employment_status) },
    { label: 'Employer Name', value: detailValue(account.employer_name) },
    {
      label: 'Employer Details',
      value: <span className="whitespace-pre-line">{detailValue(account.employer_details)}</span>,
    },
  ];

  const debtDetails = [
    { label: 'Product Name', value: detailValue(account.product) },
    { label: 'Strategy Product Code', value: detailValue(account.product_code) },
    { label: 'Portfolio Category', value: detailValue(account.portfolio_category) },
    { label: 'Region', value: detailValue(account.region) },
    { label: 'Score', value: detailValue(account.score) },
    { label: 'Risk Segment', value: detailValue(account.risk_segment) },
    { label: 'Installment Type', value: detailValue(account.installment_type) },
    { label: 'Funded Date', value: formatDate(account.funded_date || account.loan_taken_date) },
    { label: 'Stored Due Date', value: formatDate(account.due_date || account.loan_due_date) },
    {
      label: 'Computed Due Date',
      value: loanTimeline.computedDueDate
        ? formatDate(loanTimeline.computedDueDate.toISOString())
        : '-',
    },
    { label: 'Last Installment Date', value: formatDate(account.last_installment_date) },
    { label: 'Loan Tenure (Days)', value: detailValue(account.duration) },
    { label: 'Days Since Funded', value: detailValue(loanTimeline.daysSinceFunded) },
    {
      label: 'Loan Age / Maturity',
      value: (
        <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${loanTimeline.maturityTone}`}>
          {loanTimeline.maturityLabel}
        </span>
      ),
    },
    {
      label: 'Days Late Last Installment',
      value: detailValue(account.days_late_lastinstallment),
    },
    { label: 'Total Due', value: currency(Number(account.total_due || 0)) },
    { label: 'Balance', value: currency(Number(account.balance || 0)) },
    { label: 'Amount Paid', value: currency(Number(account.amount_paid || 0)) },
    { label: 'Status', value: detailValue(account.status) },
    {
      label: 'Current / Effective DPD',
      value: isClosed ? 'Closed' : detailValue(effectiveDpd),
    },
    { label: 'Current Bucket', value: bucketLabel },
    { label: 'Last Pay Date', value: formatDate(account.last_pay_date) },
    { label: 'Last Payment Amount', value: currency(Number(account.last_pay_amount || 0)) },
    { label: 'Last Action Date', value: formatDate(account.last_action_date) },
    { label: 'Next Action Date', value: formatDate(account.next_action_date) },
  ];

  const timeline = [
    ...(ptps ?? []).map((ptp) => ({
      id: `ptp-${ptp.id}`,
      type: 'PTP',
      date: ptp.created_at || ptp.promised_date || '',
      title: `Promise to Pay booked`,
      subtitle: `${currency(Number(ptp.promised_amount || 0))} due ${formatDate(ptp.promised_date)}`,
      badge: ptp.status || 'Promise To Pay',
      tone:
        ptp.status === 'Kept'
          ? 'bg-emerald-100 text-emerald-700'
          : ptp.status === 'Broken'
          ? 'bg-rose-100 text-rose-700'
          : 'bg-amber-100 text-amber-700',
    })),
    ...(payments ?? []).map((payment) => ({
      id: `payment-${payment.id}`,
      type: 'Payment',
      date: payment.paid_on || payment.created_at || '',
      title: `Payment logged`,
      subtitle: `${currency(Number(payment.amount || 0))}${payment.product ? ` · ${payment.product}` : ''}`,
      badge: 'Payment',
      tone: 'bg-emerald-100 text-emerald-700',
    })),
    ...(notes ?? []).map((note) => ({
      id: `note-${note.id}`,
      type: 'Note',
      date: note.created_at || '',
      title: note.created_by_name ? `Note by ${note.created_by_name}` : 'Account note',
      subtitle: String(note.body || '').trim() || '-',
      badge: 'Note',
      tone: 'bg-slate-100 text-slate-700',
    })),
  ]
    .sort((a, b) => {
      const at = parseDateLike(a.date)?.getTime() ?? 0;
      const bt = parseDateLike(b.date)?.getTime() ?? 0;
      return bt - at;
    })
    .slice(0, 12);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/accounts"
          className="mb-3 inline-flex text-sm font-medium text-slate-500 hover:text-slate-700"
        >
          ← Back to Portfolio
        </Link>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900">{account.debtor_name}</h1>
            <p className="mt-1 text-slate-500">
              Case hub for account actions, updates and recovery workflow.
            </p>
            {isAgent ? (
              <p className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                Agent view: only your allocated account details are visible
              </p>
            ) : null}
            {isClosed ? (
              <p className="mt-2 inline-flex rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
                This account is closed. Notes and changes are locked until reopened by an admin.
              </p>
            ) : null}
            {!isClosed && account.status === 'Pending Closure Approval' ? (
              <p className="mt-2 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-blue-700">
                Awaiting admin close decision
              </p>
            ) : null}
          </div>

          <span className={`inline-flex w-fit rounded-full px-3 py-1 text-sm font-medium ${statusClasses}`}>
            {account.status}
          </span>
        </div>
      </div>

      {canCloseOrReopen ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            {!isClosed ? (
              <form action={closeAccount}>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Close Account
                </button>
              </form>
            ) : (
              <form action={reopenAccount}>
                <button
                  type="submit"
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Reopen Account
                </button>
              </form>
            )}

            <p className="text-sm text-slate-500">
              {isClosed
                ? 'Reopening restores notes and account updates.'
                : 'Closing locks notes, disposition updates, assignments, payments, PTPs and contact edits.'}
            </p>
          </div>
        </div>
      ) : null}

      {canEditBalances ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Admin Balance Correction</h2>
              <p className="mt-1 text-sm text-slate-500">
                Correct balance and total due when a payment was entered incorrectly. This does not close the account automatically.
              </p>
            </div>
          </div>

          <form action={saveBalanceCorrection} className="mt-5 space-y-4">
            <input type="hidden" name="accountId" value={account.id} />

            <div className="grid gap-4 md:grid-cols-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Balance</label>
                <input
                  type="number"
                  name="balance"
                  step="0.01"
                  min="0"
                  defaultValue={Number(account.balance || 0)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Total Due</label>
                <input
                  type="number"
                  name="totalDue"
                  step="0.01"
                  min="0"
                  defaultValue={Number(account.total_due || 0)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Amount Paid</label>
                <input
                  type="number"
                  name="amountPaid"
                  step="0.01"
                  min="0"
                  defaultValue={Number(account.amount_paid || 0)}
                  className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                />
              </div>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Reason for correction</label>
              <textarea
                name="reason"
                required
                rows={3}
                placeholder="Explain why the balances are being corrected..."
                className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
              >
                Save Balance Correction
              </button>
              <p className="self-center text-xs text-slate-500">
                A correction note will be written to the account timeline.
              </p>
            </div>
          </form>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Balance</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {currency(Number(account.balance || 0))}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Amount Paid</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {currency(Number(account.amount_paid || 0))}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Current DPD</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">{detailValue(effectiveDpd)}</p>
          <p className="mt-1 text-xs text-slate-500">Stored: {detailValue(storedDpd)}</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Days Since Funded</p>
          <p className="mt-2 text-3xl font-semibold text-slate-900">
            {detailValue(loanTimeline.daysSinceFunded)}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Funded: {formatDate(account.funded_date || account.loan_taken_date)}
          </p>
        </div>
      </div>

      {account.customer_id ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <details className="group" open={false}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-900">Other Facilities for This Customer</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isAgent
                    ? `Other visible accounts in your portfolio linked to customer ID ${account.customer_id}.`
                    : `Other accounts linked to customer ID ${account.customer_id}.`}
                </p>
              </div>
              <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600 group-open:bg-slate-900 group-open:text-white">
                Expand
              </span>
            </summary>

            <div className="mt-4">
              {relatedFacilities.length > 0 ? (
                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-600">
                      <tr>
                        <th className="px-4 py-3">Debtor</th>
                        <th className="px-4 py-3">Loan ID</th>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3">Portfolio Category</th>
                        <th className="px-4 py-3">Balance</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3">DPD</th>
                        <th className="px-4 py-3">Open</th>
                      </tr>
                    </thead>
                    <tbody>
                      {relatedFacilities.map((facility: any) => (
                        <tr key={facility.id} className="border-t border-slate-200">
                          <td className="px-4 py-3">{facility.debtor_name || '-'}</td>
                          <td className="px-4 py-3">{facility.account_no || '-'}</td>
                          <td className="px-4 py-3">{facility.product || '-'}</td>
                          <td className="px-4 py-3">{facility.portfolio_category || '-'}</td>
                          <td className="px-4 py-3">{currency(Number(facility.balance || 0))}</td>
                          <td className="px-4 py-3">{facility.status || '-'}</td>
                          <td className="px-4 py-3">{detailValue(facility.dpd)}</td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/accounts/${facility.id}`}
                              className="text-sm font-medium text-slate-700 hover:text-slate-900 hover:underline"
                            >
                              View account
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                  No other facilities found for this customer.
                </div>
              )}
            </div>
          </details>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Follow-up Tracker</h2>
              <p className="mt-1 text-sm text-slate-500">
                Current next step, due date and action status for this account.
              </p>
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${dueMeta.tone}`}>
              {dueMeta.label}
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Current Status</p>
              <p className="mt-2 text-base font-semibold text-slate-900">{detailValue(account.status)}</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Next Action Date</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {formatDate(account.next_action_date)}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Expected Maturity</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {loanTimeline.computedDueDate
                  ? formatDate(loanTimeline.computedDueDate.toISOString())
                  : '-'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Assigned Collector</p>
              <p className="mt-2 text-base font-semibold text-slate-900">
                {detailValue(account.collector_name)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            {isClosed ? (
              <>
                <span className={actionLinkClasses(true)}>Update Follow-up Locked</span>
                <span className={actionLinkClasses(true)}>Add Note Locked</span>
              </>
            ) : (
              <>
                <Link
                  href={`/accounts/${id}/status/update`}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800"
                >
                  Update Follow-up
                </Link>
                <Link
                  href={`/accounts/${id}/notes/new`}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Add Note
                </Link>
              </>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Action Priority</h2>
              <p className="mt-1 text-sm text-slate-500">
                Quick operational view of urgency and discipline signals.
              </p>
            </div>
            <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${priorityMeta.tone}`}>
              {priorityMeta.label}
            </span>
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">Why this priority?</p>
              <p className="mt-1 text-sm text-slate-600">{priorityMeta.reason}</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Bucket</p>
                <p className="mt-2 text-base font-semibold text-slate-900">{bucketLabel}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Loan Age</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {detailValue(loanTimeline.daysSinceFunded)}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Balance Exposure</p>
                <p className="mt-2 text-base font-semibold text-slate-900">
                  {currency(Number(account.balance || 0))}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Expected Maturity</p>
                <p className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-medium ${loanTimeline.maturityTone}`}>
                  {loanTimeline.maturityLabel}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          {isClosed ? (
            <>
              <span className={actionLinkClasses(true)}>Book PTP Locked</span>
              <span className={actionLinkClasses(true)}>Log Payment Locked</span>
              <span className={actionLinkClasses(true)}>Update Disposition Locked</span>
              <span className={actionLinkClasses(true)}>Notes History</span>
              {canManageAssignments ? (
                <span className={actionLinkClasses(true)}>Assign Collector Locked</span>
              ) : null}
              <span className={actionLinkClasses(true)}>Send SMS Locked</span>
              <span className={actionLinkClasses(true)}>Update Contact Details Locked</span>
            </>
          ) : (
            <>
              <Link
                href={`/accounts/${id}/ptps/new`}
                className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Book PTP
              </Link>

              <Link
                href={`/accounts/${id}/payments/new`}
                className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Log Payment
              </Link>

              <Link
                href={`/accounts/${id}/status/update`}
                className="inline-flex min-w-[170px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Update Disposition
              </Link>

              <Link
                href={`/accounts/${id}/notes/new`}
                className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Notes History
              </Link>

              {canManageAssignments ? (
                <Link
                  href={`/accounts/${id}/assign`}
                  className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Assign Collector
                </Link>
              ) : null}

              <Link
                href={`/accounts/${id}/sms/new`}
                className="inline-flex min-w-[150px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Send SMS
              </Link>

              <Link
                href={`/accounts/${id}/contact/update`}
                className="inline-flex min-w-[180px] items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Update Contact Details
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Assigned Strategy</h2>
            <p className="mt-1 text-sm text-slate-500">
              The collection workflow plan currently applied to this account.
            </p>
          </div>

          {canManageAssignments && !isClosed ? <AccountStrategyActions accountId={id} /> : null}
        </div>

        <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          {assignedStrategy ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-slate-900">{assignedStrategy.name}</span>
                <span
                  className={[
                    'inline-flex rounded-full px-3 py-1 text-xs font-medium',
                    assignedStrategy.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700',
                  ].join(' ')}
                >
                  {assignedStrategy.is_active ? 'Active' : 'Inactive'}
                </span>
                <span className="text-xs text-slate-400">{assignedStrategy.id}</span>
              </div>

              {assignedStrategy.description ? (
                <p className="text-sm text-slate-600">{assignedStrategy.description}</p>
              ) : null}

              <div className="flex flex-wrap gap-4 pt-2 text-sm text-slate-600">
                <span>
                  <span className="font-medium text-slate-700">Steps:</span> {stepsCount}
                </span>
                <span>
                  <span className="font-medium text-slate-700">Assigned:</span>{' '}
                  {strategyAssignment?.assigned_at ? formatDate(strategyAssignment.assigned_at) : '-'}
                </span>
                <span>
                  <span className="font-medium text-slate-700">Source:</span>{' '}
                  {strategyAssignment?.source || '-'}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-slate-600">
              <p className="font-medium text-slate-800">No strategy assigned yet.</p>
              <p className="mt-1">
                Strategy controls are available to admin and super admin users only.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Basic Details</h2>
            {isClosed ? (
              <span className="text-sm font-medium text-slate-400">Edit locked</span>
            ) : (
              <Link
                href={`/accounts/${id}/contact/update`}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Edit contact & employer
              </Link>
            )}
          </div>

          <DetailTable rows={basicDetails} />
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Debt Details</h2>
          <DetailTable rows={debtDetails} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Account Timeline</h2>
            <p className="mt-1 text-sm text-slate-500">
              Unified chronological view of recent actions, payments, PTPs and notes.
            </p>
          </div>
          {isClosed ? (
            <span className="text-sm font-medium text-slate-400">Add timeline note locked</span>
          ) : (
            <Link
              href={`/accounts/${id}/notes/new`}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              Add timeline note
            </Link>
          )}
        </div>

        <div className="mt-4 space-y-3">
          {timeline.length > 0 ? (
            timeline.map((item) => (
              <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                      <span className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${item.tone}`}>
                        {item.badge}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-slate-600">{item.subtitle}</p>
                  </div>
                  <p className="text-xs text-slate-500">{formatDate(item.date)}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
              No recent account activity to show yet.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Recent PTPs</h2>
            {isClosed ? (
              <span className="text-sm font-medium text-slate-400">Book PTP locked</span>
            ) : (
              <Link
                href={`/accounts/${id}/ptps/new`}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Book PTP
              </Link>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {ptps && ptps.length > 0 ? (
              ptps.slice(0, 3).map((ptp) => (
                <div key={ptp.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {currency(Number(ptp.promised_amount || 0))}
                    </p>
                    <span
                      className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${
                        ptp.status === 'Kept'
                          ? 'bg-emerald-100 text-emerald-700'
                          : ptp.status === 'Broken'
                          ? 'bg-rose-100 text-rose-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      {ptp.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">Due: {formatDate(ptp.promised_date)}</p>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No PTPs yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-slate-900">Recent Payments</h2>
            {isClosed ? (
              <span className="text-sm font-medium text-slate-400">Log payment locked</span>
            ) : (
              <Link
                href={`/accounts/${id}/payments/new`}
                className="text-sm font-medium text-slate-600 hover:text-slate-900"
              >
                Log payment
              </Link>
            )}
          </div>

          <div className="mt-4 space-y-3">
            {payments && payments.length > 0 ? (
              payments.slice(0, 3).map((payment) => (
                <div key={payment.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">
                      {currency(Number(payment.amount || 0))}
                    </p>
                    <span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                      {payment.product || '-'}
                    </span>
                  </div>

                  <p className="mt-2 text-sm text-slate-600">Paid on: {formatDate(payment.paid_on)}</p>

                  {canEditBalances ? (
                    <form action={reversePayment} className="mt-4 space-y-3">
                      <input type="hidden" name="accountId" value={account.id} />
                      <input type="hidden" name="paymentId" value={payment.id} />

                      <textarea
                        name="reason"
                        required
                        rows={2}
                        placeholder="Reason for unlogging this payment..."
                        className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
                      />

                      <button
                        type="submit"
                        className="rounded-xl border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                      >
                        Unlog Payment
                      </button>
                    </form>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
                No payments yet.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}