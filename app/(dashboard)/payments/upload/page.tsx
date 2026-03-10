'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';

type ParsedRow = Record<string, string>;

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';

const EXPECTED_HEADERS = [
  'CFID',
  'ACCOUNT NO.',
  'PRODUCT',
  'COLLECTOR',
  'AMOUNT',
  'PAID ON',
] as const;

function toNumber(value: string) {
  const cleaned = String(value || '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function cleanText(value: string) {
  const text = String(value || '').trim();
  return text || null;
}

export default function UploadPaymentsPage() {
  const [previewRows, setPreviewRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setPreviewRows([]);
    setMessage('');
    setErrorMessage('');

    if (!file) return;

    setFileName(file.name);
    setLoading(true);

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = (results.meta.fields || []).map((item) => String(item).trim());
        const missing = EXPECTED_HEADERS.filter((header) => !headers.includes(header));

        if (missing.length > 0) {
          setErrorMessage(`Missing headers: ${missing.join(', ')}`);
          setLoading(false);
          return;
        }

        const cleaned = (results.data || []).filter((row) => {
          return (
            String(row['AMOUNT'] || '').trim() !== '' &&
            String(row['PAID ON'] || '').trim() !== ''
          );
        });

        setPreviewRows(cleaned);
        setMessage(`Preview ready. ${cleaned.length} payment row(s) detected.`);
        setLoading(false);
      },
      error: (error) => {
        setErrorMessage(error.message || 'Failed to parse CSV.');
        setLoading(false);
      },
    });
  }

  async function handleImport() {
    setMessage('');
    setErrorMessage('');

    if (!supabase) {
      setErrorMessage('Supabase is not configured.');
      return;
    }

    if (!previewRows.length) {
      setErrorMessage('Please upload a valid payments CSV first.');
      return;
    }

    setImporting(true);

    const cfids = Array.from(
      new Set(previewRows.map((row) => String(row['CFID'] || '').trim()).filter(Boolean))
    );

    const accountNos = Array.from(
      new Set(previewRows.map((row) => String(row['ACCOUNT NO.'] || '').trim()).filter(Boolean))
    );

    const [cfidAccountsResponse, accountNoAccountsResponse] = await Promise.all([
      cfids.length
        ? supabase
            .from('accounts')
            .select('id, cfid, account_no')
            .eq('company_id', COMPANY_ID)
            .in('cfid', cfids)
        : Promise.resolve({ data: [], error: null }),
      accountNos.length
        ? supabase
            .from('accounts')
            .select('id, cfid, account_no')
            .eq('company_id', COMPANY_ID)
            .in('account_no', accountNos)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (cfidAccountsResponse.error || accountNoAccountsResponse.error) {
      setImporting(false);
      setErrorMessage('Failed to resolve accounts for imported payments.');
      return;
    }

    const accountMapByCfid = new Map(
      (cfidAccountsResponse.data || []).map((row) => [String(row.cfid || '').trim(), row.id])
    );

    const accountMapByAccountNo = new Map(
      (accountNoAccountsResponse.data || []).map((row) => [String(row.account_no || '').trim(), row.id])
    );

    const payload = previewRows.map((row) => {
      const cfid = String(row['CFID'] || '').trim();
      const accountNo = String(row['ACCOUNT NO.'] || '').trim();

      return {
        company_id: COMPANY_ID,
        account_id: accountMapByCfid.get(cfid) || accountMapByAccountNo.get(accountNo) || null,
        cfid: cfid || null,
        account_no_ref: accountNo || null,
        collector_name: cleanText(row['COLLECTOR']),
        product: cleanText(row['PRODUCT']) || 'UNSPECIFIED',
        amount: toNumber(row['AMOUNT']) ?? 0,
        paid_on: cleanText(row['PAID ON']),
      };
    });

    const { error } = await supabase.from('payments').insert(payload);

    setImporting(false);

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setMessage(`Import complete. ${payload.length} payments uploaded successfully.`);
    setPreviewRows([]);
    setFileName('');
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Upload Historical Payments</h1>
          <p className="mt-1 text-slate-500">
            Import past payments and optionally link them to accounts using CFID or account number.
          </p>
        </div>

        <a
          href="/payments-import-template.csv"
          download
          className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download Payments Template
        </a>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
        <div>
          <label className="mb-2 block text-sm font-medium text-slate-700">Upload CSV</label>
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700"
          />
          {fileName ? <p className="mt-2 text-sm text-slate-500">Selected file: {fileName}</p> : null}
        </div>

        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Required columns: <strong>AMOUNT</strong> and <strong>PAID ON</strong>. CFID and ACCOUNT NO. help link payments back to accounts.
        </div>

        {loading ? <p className="text-sm text-slate-500">Preparing preview...</p> : null}
        {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
        {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

        {previewRows.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-2xl border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-600">
                  <tr>
                    <th className="px-4 py-3">CFID</th>
                    <th className="px-4 py-3">Account No.</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Collector</th>
                    <th className="px-4 py-3">Amount</th>
                    <th className="px-4 py-3">Paid On</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 10).map((row, index) => (
                    <tr key={index} className="border-t border-slate-200">
                      <td className="px-4 py-3">{row['CFID'] || '-'}</td>
                      <td className="px-4 py-3">{row['ACCOUNT NO.'] || '-'}</td>
                      <td className="px-4 py-3">{row['PRODUCT'] || '-'}</td>
                      <td className="px-4 py-3">{row['COLLECTOR'] || '-'}</td>
                      <td className="px-4 py-3">{row['AMOUNT'] || '-'}</td>
                      <td className="px-4 py-3">{row['PAID ON'] || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleImport}
                disabled={importing}
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {importing ? 'Importing...' : `Import ${previewRows.length} Payments`}
              </button>

              <Link
                href="/payments"
                className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to Payments
              </Link>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}