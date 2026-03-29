import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

function normalize(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function parseNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function escapeCsv(value: unknown) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toDateOnly(value: unknown) {
  const raw = String(value ?? '').trim();
  return raw ? raw.slice(0, 10) : '';
}

function getBucketLabel(status: unknown, dpdValue: unknown) {
  if (normalize(status) === 'closed') return 'Closed';

  const dpd = parseNumber(dpdValue);
  if (dpd == null) return 'Unknown';
  if (dpd <= 0) return 'Current';
  if (dpd >= 1 && dpd <= 30) return '1-30';
  if (dpd >= 31 && dpd <= 60) return '31-60';
  if (dpd >= 61 && dpd <= 90) return '61-90';
  if (dpd >= 91 && dpd <= 120) return '91-120';
  return '121+';
}

function matchesBucket(status: unknown, dpdValue: unknown, wantedBucket: string) {
  const actual = normalize(getBucketLabel(status, dpdValue));
  return actual === normalize(wantedBucket);
}

export async function GET(request: NextRequest) {
  try {
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Supabase admin is not configured.' },
        { status: 500 }
      );
    }

    const { searchParams } = new URL(request.url);

    const statusFilter = String(searchParams.get('status') || '').trim();
    const collectorFilter = String(searchParams.get('collector') || '').trim();
    const productFilter = String(searchParams.get('product') || '').trim();
    const bucketFilter = String(searchParams.get('bucket') || '').trim();
    const searchFilter = String(searchParams.get('search') || '').trim();
    const dpdMin = parseNumber(searchParams.get('dpdMin'));
    const dpdMax = parseNumber(searchParams.get('dpdMax'));
    let companyId = String(searchParams.get('companyId') || '').trim();

    if (!companyId) {
      const { data: fixedCompany, error: fixedCompanyError } = await supabaseAdmin
        .from('companies')
        .select('id,name,code')
        .or('name.eq.Pezesha,code.eq.Pezesha')
        .limit(1)
        .maybeSingle();

      if (fixedCompanyError || !fixedCompany?.id) {
        return NextResponse.json(
          { error: 'Unable to resolve Pezesha company.' },
          { status: 500 }
        );
      }

      companyId = String(fixedCompany.id);
    }

    let query = supabaseAdmin
      .from('accounts')
      .select(
        [
          'id',
          'cfid',
          'debtor_name',
          'account_no',
          'customer_id',
          'identification',
          'primary_phone',
          'collector_name',
          'product',
          'product_code',
          'portfolio_category',
          'region',
          'status',
          'dpd',
          'balance',
          'total_due',
          'amount_paid',
          'last_pay_date',
          'last_pay_amount',
          'last_action_date',
          'next_action_date',
          'funded_date',
          'loan_taken_date',
          'due_date',
          'loan_due_date',
          'created_at',
        ].join(',')
      )
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    if (collectorFilter) {
      query = query.eq('collector_name', collectorFilter);
    }

    if (productFilter) {
      query = query.eq('product', productFilter);
    }

    if (dpdMin != null) {
      query = query.gte('dpd', dpdMin);
    }

    if (dpdMax != null) {
      query = query.lte('dpd', dpdMax);
    }

    if (searchFilter) {
      query = query.or(
        [
          `debtor_name.ilike.%${searchFilter}%`,
          `cfid.ilike.%${searchFilter}%`,
          `account_no.ilike.%${searchFilter}%`,
          `customer_id.ilike.%${searchFilter}%`,
          `identification.ilike.%${searchFilter}%`,
          `primary_phone.ilike.%${searchFilter}%`,
        ].join(',')
      );
    }

    const { data: accounts, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const filteredAccounts = (accounts ?? []).filter((account: any) => {
      if (bucketFilter && !matchesBucket(account.status, account.dpd, bucketFilter)) {
        return false;
      }
      return true;
    });

    const headers = [
      'CFID',
      'Debtor Name',
      'Account Number',
      'Customer ID',
      'Identification',
      'Primary Phone',
      'Collector',
      'Product',
      'Product Code',
      'Portfolio Category',
      'Region',
      'Status',
      'Bucket',
      'DPD',
      'Balance',
      'Total Due',
      'Amount Paid',
      'Last Pay Date',
      'Last Pay Amount',
      'Last Action Date',
      'Next Action Date',
      'Funded Date',
      'Loan Taken Date',
      'Due Date',
      'Loan Due Date',
      'Created At',
    ];

    const rows = filteredAccounts.map((account: any) => [
      account.cfid,
      account.debtor_name,
      account.account_no,
      account.customer_id,
      account.identification,
      account.primary_phone,
      account.collector_name,
      account.product,
      account.product_code,
      account.portfolio_category,
      account.region,
      account.status,
      getBucketLabel(account.status, account.dpd),
      account.dpd,
      account.balance,
      account.total_due,
      account.amount_paid,
      toDateOnly(account.last_pay_date),
      account.last_pay_amount,
      toDateOnly(account.last_action_date),
      toDateOnly(account.next_action_date),
      toDateOnly(account.funded_date),
      toDateOnly(account.loan_taken_date),
      toDateOnly(account.due_date),
      toDateOnly(account.loan_due_date),
      account.created_at,
    ]);

    const csv = [headers, ...rows]
      .map((row) => row.map(escapeCsv).join(','))
      .join('\n');

    const filenameParts = ['accounts_export'];
    if (statusFilter) filenameParts.push(`status_${statusFilter}`);
    if (collectorFilter) filenameParts.push(`collector_${collectorFilter}`);
    if (productFilter) filenameParts.push(`product_${productFilter}`);
    if (bucketFilter) filenameParts.push(`bucket_${bucketFilter}`);
    filenameParts.push(new Date().toISOString().slice(0, 10));

    const filename = `${filenameParts.join('_')}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to export accounts.' },
      { status: 500 }
    );
  }
}