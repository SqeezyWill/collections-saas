import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { supabase } from '@/lib/supabase';

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';
const EXPORT_BATCH_SIZE = 1000;

const AVAILABLE_COLUMNS = [
  { key: 'cfid', label: 'CFID' },
  { key: 'debtor_name', label: 'Debtor' },
  { key: 'phone', label: 'Phone' },
  { key: 'account_no', label: 'Account' },
  { key: 'product', label: 'Product' },
  { key: 'collector_name', label: 'Collector' },
  { key: 'balance', label: 'Balance' },
  { key: 'amount_paid', label: 'Amount paid' },
  { key: 'status', label: 'Status' },
  { key: 'last_action_date', label: 'Last action' },
  { key: 'identification', label: 'Identification' },
  { key: 'customer_id', label: 'Customer ID' },
] as const;

const DEFAULT_COLUMNS = [
  'cfid',
  'debtor_name',
  'phone',
  'account_no',
  'product',
  'collector_name',
  'balance',
  'amount_paid',
  'status',
  'last_action_date',
];

function buildBaseQuery(params: {
  search: string;
  collector: string;
  status: string;
  minBalance: string;
  maxBalance: string;
  lastActionFrom: string;
  lastActionTo: string;
}) {
  let query = supabase
    ?.from('accounts')
    .select('*')
    .eq('company_id', COMPANY_ID)
    .order('created_at', { ascending: false });

  if (!query) return null;

  if (params.search) {
    const safeSearch = params.search.replace(/,/g, '');
    query = query.or(
      [
        `cfid.ilike.%${safeSearch}%`,
        `debtor_name.ilike.%${safeSearch}%`,
        `contacts.ilike.%${safeSearch}%`,
        `primary_phone.ilike.%${safeSearch}%`,
        `secondary_phone.ilike.%${safeSearch}%`,
        `tertiary_phone.ilike.%${safeSearch}%`,
        `account_no.ilike.%${safeSearch}%`,
        `identification.ilike.%${safeSearch}%`,
        `customer_id.ilike.%${safeSearch}%`,
      ].join(',')
    );
  }

  if (params.collector) query = query.eq('collector_name', params.collector);
  if (params.status) query = query.eq('status', params.status);
  if (params.minBalance) query = query.gte('balance', Number(params.minBalance));
  if (params.maxBalance) query = query.lte('balance', Number(params.maxBalance));
  if (params.lastActionFrom) query = query.gte('last_action_date', params.lastActionFrom);
  if (params.lastActionTo) query = query.lte('last_action_date', params.lastActionTo);

  return query;
}

async function fetchAllAccounts(params: {
  search: string;
  collector: string;
  status: string;
  minBalance: string;
  maxBalance: string;
  lastActionFrom: string;
  lastActionTo: string;
}) {
  const allRows: any[] = [];
  let from = 0;

  while (true) {
    const to = from + EXPORT_BATCH_SIZE - 1;
    const query = buildBaseQuery(params);

    if (!query) {
      throw new Error('Supabase is not configured.');
    }

    const { data, error } = await query.range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    const batch = data ?? [];
    allRows.push(...batch);

    if (batch.length < EXPORT_BATCH_SIZE) {
      break;
    }

    from += EXPORT_BATCH_SIZE;
  }

  return allRows;
}

export async function GET(request: NextRequest) {
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase is not configured.' }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);

  const search = searchParams.get('search')?.trim() || '';
  const collector = searchParams.get('collector')?.trim() || '';
  const status = searchParams.get('status')?.trim() || '';
  const minBalance = searchParams.get('minBalance')?.trim() || '';
  const maxBalance = searchParams.get('maxBalance')?.trim() || '';
  const lastActionFrom = searchParams.get('lastActionFrom')?.trim() || '';
  const lastActionTo = searchParams.get('lastActionTo')?.trim() || '';
  const columnsParam = searchParams.get('columns')?.trim() || DEFAULT_COLUMNS.join(',');

  const selectedColumns = columnsParam
    .split(',')
    .map((item) => item.trim())
    .filter((item) => AVAILABLE_COLUMNS.some((col) => col.key === item));

  const finalColumns = selectedColumns.length > 0 ? selectedColumns : DEFAULT_COLUMNS;

  try {
    const data = await fetchAllAccounts({
      search,
      collector,
      status,
      minBalance,
      maxBalance,
      lastActionFrom,
      lastActionTo,
    });

    const exportRows = data.map((row) => {
      const result: Record<string, string | number> = {};

      finalColumns.forEach((column) => {
        const label = AVAILABLE_COLUMNS.find((item) => item.key === column)?.label || column;

        switch (column) {
          case 'phone':
            result[label] = row.primary_phone || row.contacts || '';
            break;
          case 'balance':
            result[label] = Number(row.balance || 0);
            break;
          case 'amount_paid':
            result[label] = Number(row.amount_paid || 0);
            break;
          case 'last_action_date':
            result[label] = row.last_action_date || '';
            break;
          default:
            result[label] = row[column] || '';
        }
      });

      return result;
    });

    const worksheet = XLSX.utils.json_to_sheet(exportRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Accounts');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="accounts-export.xlsx"',
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Failed to export accounts.' },
      { status: 500 }
    );
  }
}