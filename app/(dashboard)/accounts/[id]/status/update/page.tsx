import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { supabaseAdmin } from '@/lib/supabase-admin';
import PTPDispositionForm from './PTPDispositionForm';

type PageProps = {
  params: Promise<{ id: string }>;
};

const ASSIGN_TABLE = 'account_strategies';
const ACCOUNTS_TABLE = 'accounts';
const STRATEGIES_TABLE = 'strategies';
const MAP_TABLE = 'strategy_products';
const PRODUCTS_TABLE = 'products';

function todayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
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
  if (!raw) return null;

  const isoOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoOnly) {
    const year = Number(isoOnly[1]);
    const month = Number(isoOnly[2]);
    const day = Number(isoOnly[3]);
    return new Date(year, month - 1, day);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function diffInDays(from: Date, to: Date) {
  const start = startOfLocalDay(from).getTime();
  const end = startOfLocalDay(to).getTime();
  return Math.max(0, Math.floor((end - start) / 86400000));
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
  const daysElapsed = diffInDays(anchor, today);

  return baseDpd + daysElapsed;
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

async function resolveAutoStrategy(accountId: string) {
  if (!supabaseAdmin) {
    throw new Error('Supabase admin not configured.');
  }

  const { data: acct, error: acctErr } = await supabaseAdmin
    .from(ACCOUNTS_TABLE)
    .select('id,product_code,dpd,created_at,uploaded_at,outsource_date')
    .eq('id', accountId)
    .maybeSingle();

  if (acctErr) throw new Error(acctErr.message);
  if (!acct) throw new Error('Account not found.');

  const productCode = normalize(acct.product_code);
  if (!productCode) {
    throw new Error(
      'Account has no product_code. Set accounts.product_code first, then auto-assign.'
    );
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
      'Auto re-evaluated after disposition/status update.',
      `product=${productCode}`,
      `dpd=${dpd ?? 'unknown'}`,
      `bucket=${bucket.label}`,
      `match=${bucketSpecific ? 'product_and_bucket' : 'product_fallback'}`,
    ].join(' '),
  };
}

async function reassignAccountStrategy(accountId: string) {
  if (!supabaseAdmin || !accountId) {
    return;
  }

  const resolved = await resolveAutoStrategy(accountId);

  const { data: currentActive, error: currentErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .select('id,strategy_id,is_active')
    .eq('account_id', accountId)
    .eq('is_active', true)
    .order('assigned_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentErr) {
    throw new Error(currentErr.message);
  }

  if (currentActive && String(currentActive.strategy_id) === resolved.strategyId) {
    return;
  }

  const { error: offErr } = await supabaseAdmin
    .from(ASSIGN_TABLE)
    .update({ is_active: false })
    .eq('account_id', accountId)
    .eq('is_active', true);

  if (offErr) {
    throw new Error(offErr.message);
  }

  const { error: insErr } = await supabaseAdmin.from(ASSIGN_TABLE).insert({
    account_id: accountId,
    strategy_id: resolved.strategyId,
    source: 'auto',
    notes: resolved.notes,
    is_active: true,
  });

  if (insErr) {
    throw new Error(insErr.message);
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

  const isClosed = isClosedStatus(account.status);

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

    if (isClosedStatus(account.status)) {
      throw new Error('Closed accounts cannot be updated. Reopen the account first.');
    }

    const contactType = String(formData.get('contact_type') || '').trim();
    const contactStatus = String(formData.get('contact_status') || '').trim();
    const nonPaymentReason = String(formData.get('non_payment_reason') || '').trim();
    const callType = String(formData.get('call_type') || '').trim();
    const nextAction = String(formData.get('next_action') || '').trim();
    const nextActionDateRaw = String(formData.get('next_action_date') || '').trim();
    const notes = String(formData.get('notes') || '').trim();

    const ptpAmountRaw = String(formData.get('ptp_amount') || '').trim();
    const ptpDueDate = String(formData.get('ptp_due_date') || '').trim();

    const isPtp = contactStatus === 'Promise To Pay';
    const isDebtCleared = contactStatus === 'Debt Cleared';

    if (isPtp) {
      if (!ptpAmountRaw) {
        throw new Error('PTP amount is required when contact status is Promise To Pay.');
      }

      if (!ptpDueDate) {
        throw new Error('PTP due date is required when contact status is Promise To Pay.');
      }
    }

    const ptpAmount = ptpAmountRaw ? Number(ptpAmountRaw) : null;
    if (isPtp && (!Number.isFinite(ptpAmount) || Number(ptpAmount) <= 0)) {
      throw new Error('PTP amount must be a valid number greater than zero.');
    }

    const interactionOutcome = deriveInteractionOutcome({
      contactType,
      contactStatus,
      nonPaymentReason,
      nextAction,
    });

    const effectiveNextActionDate = isPtp ? ptpDueDate : nextActionDateRaw;

    const updatePayload: Record<string, any> = {
      status: interactionOutcome,
      contact_type: contactType || null,
      contact_status: contactStatus || null,
      non_payment_reason: nonPaymentReason || null,
      next_action_date: effectiveNextActionDate || null,
      last_action_date: todayDateString(),
    };

    const { error: updateError } = await supabase
      .from('accounts')
      .update(updatePayload)
      .eq('id', id);

    if (updateError) {
      throw new Error(updateError.message);
    }

    if (isPtp) {
  const { error: ptpError } = await supabase.from('ptps').insert({
    company_id: account.company_id,
    account_id: id,
    promised_amount: Number(ptpAmount),
    promised_date: ptpDueDate,
    status: 'Promise To Pay',
    collector_name: account.collector_name || null,
    created_by_name: 'System User',
    kept_amount: 0,
    resolution_source: null,
    is_rebooked: false,
  });

  if (ptpError) {
    throw new Error(ptpError.message);
  }
}

try {
  await reassignAccountStrategy(id);
} catch (strategyError) {
  console.error('Strategy reassignment skipped after status update:', strategyError);
}

const noteLines = [
      `Interaction Outcome: ${interactionOutcome}`,
      contactType ? `Contact Type: ${contactType}` : '',
      contactStatus ? `Contact Status: ${contactStatus}` : '',
      nonPaymentReason ? `Non Payment Reason: ${nonPaymentReason}` : '',
      callType ? `Call Type: ${callType}` : '',
      nextAction ? `Next Action: ${nextAction}` : '',
      effectiveNextActionDate ? `Next Action Date: ${effectiveNextActionDate}` : '',
      isPtp && ptpAmount ? `PTP Amount: ${ptpAmount}` : '',
      isPtp && ptpDueDate ? `PTP Due Date: ${ptpDueDate}` : '',
      isDebtCleared
        ? 'Admin Review: Account marked as Debt Cleared and awaiting admin close decision.'
        : '',
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

        {isClosed ? (
          <p className="mt-3 inline-flex rounded-full bg-amber-50 px-3 py-1 text-sm font-medium text-amber-700">
            This account is closed. Disposition updates are locked until reopened by an admin.
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        {isClosed ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-700">
            Closed accounts cannot be updated. Reopen the account first.
          </div>
        ) : (
          <PTPDispositionForm
            action={saveStatus}
            accountId={id}
            debtorName={account.debtor_name || null}
            defaultContactType={account.contact_type || ''}
            defaultContactStatus={account.contact_status || ''}
            defaultNonPaymentReason={account.non_payment_reason || ''}
            defaultNextActionDate={account.next_action_date || ''}
            today={todayDateString()}
            initialInteractionOutcome={initialInteractionOutcome}
          />
        )}
      </div>
    </div>
  );
}