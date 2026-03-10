'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ParsedRow = Record<string, string>;
type PreviewRow = ParsedRow & { __cfid: string };

const COMPANY_ID = 'b4f07164-1706-4904-a304-b38efb88ebf3';

const EXPECTED_HEADERS = [
  'CFID',
  'DEBTOR NAMES',
  'IDENTIFICATION',
  'CONTACT(s)',
  'EMAIL(s)',
  'ACCOUNT NO.',
  'SERVICE ACCOUNT',
  'CONTRACT NO.',
  'DEBT CATEGORY',
  'DEBT TYPE',
  'CURRENCY',
  'PRINCIPAL AMOUNT',
  'OUTSOURCED AMOUNT',
  'AMOUNT PAID',
  'ARREARS',
  'BALANCE',
  'WAIVER',
  'BALANCE AFTER WAIVER',
  'LOAN TAKEN DATE',
  'LOAN DUE DATE',
  'OUTSOURCE DATE',
  'AMOUNT REPAID',
  'CLIENT',
  'PRODUCT',
  'DPD',
  'DPD LEVEL',
  'EMI',
  'HELD BY',
  'HELD FOR DAYS',
  'CONTACTABILITY',
  'CONTACT TYPE',
  'CONTACT STATUS',
  'DAYS SINCE OUTSOURCE',
  'LAST PAY DATE',
  'LAST PAY AMOUNT',
  'LAST ACTION DATE',
  'NEXT ACTION DATE',
  'LAST RPC UPDATED DATE',
  'USER ID',
  'BRANCH',
  'CUSTOMER_ID',
  'BATCH NO',
  'LOANS COUNTER',
  'NON PAYMENT REASON',
  'EMPLOYER',
  'RISK CATEGORY',
  'SEGMENTS',
] as const;

function toNumber(value: string) {
  const cleaned = String(value || '').replace(/,/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value: string) {
  const num = toNumber(value);
  return num === null ? null : Math.trunc(num);
}

function toDate(value: string) {
  const raw = String(value || '').trim();
  return raw || null;
}

function cleanText(value: string) {
  const raw = String(value || '').trim();
  return raw || null;
}

function padCfid(num: number) {
  return String(num).padStart(3, '0');
}

function normalizeStatus(row: ParsedRow) {
  const contactStatus = String(row['CONTACT STATUS'] || '').trim();
  if (contactStatus) return contactStatus;
  return 'Open';
}

function normalizeProduct(value: string) {
  const raw = String(value || '').trim();
  return raw || null;
}

function normalizeProductCode(value: string) {
  const raw = String(value || '').trim().toLowerCase();
  return raw || null;
}

function getPrimaryPhone(rawContacts: string) {
  const parts = String(rawContacts || '')
    .split(/[;,/]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return parts[0] || null;
}

function getNumericCfid(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '').trim();
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function UploadAccountsPage() {
  const [fileName, setFileName] = useState('');
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const previewCount = useMemo(() => previewRows.length, [previewRows]);

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setErrorMessage('');
    setMessage('');
    setPreviewRows([]);
    setMissingHeaders([]);

    if (!file) return;

    setFileName(file.name);
    setLoadingPreview(true);

    Papa.parse<ParsedRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        try {
          const headers = (results.meta.fields || []).map((header) => String(header).trim());
          const missing = EXPECTED_HEADERS.filter((header) => !headers.includes(header));
          setMissingHeaders(missing);

          if (missing.length > 0) {
            setErrorMessage(`The CSV is missing these standard headers: ${missing.join(', ')}`);
            setLoadingPreview(false);
            return;
          }

          if (!supabase) {
            setErrorMessage('Supabase is not configured.');
            setLoadingPreview(false);
            return;
          }

          const allRows = (results.data || []) as ParsedRow[];
          const filteredRows = allRows.filter(
            (row) => String(row['DEBTOR NAMES'] || '').trim() !== ''
          );

          const { data: existingCfids, error: cfidError } = await supabase
            .from('accounts')
            .select('cfid')
            .not('cfid', 'is', null);

          if (cfidError) {
            setErrorMessage(`Failed to read existing CFIDs: ${cfidError.message}`);
            setLoadingPreview(false);
            return;
          }

          const maxExistingCfid = Math.max(
            0,
            ...((existingCfids || [])
              .map((row) => getNumericCfid(row.cfid))
              .filter((value): value is number => value !== null))
          );

          let nextNumber = maxExistingCfid + 1;

          const generatedPreview = filteredRows.map((row) => {
            const cfid = padCfid(nextNumber);
            nextNumber += 1;
            return {
              ...row,
              __cfid: cfid,
            };
          });

          setPreviewRows(generatedPreview);
          setMessage(`Preview ready. ${generatedPreview.length} row(s) will be imported.`);
        } catch (error: any) {
          setErrorMessage(error?.message || 'Failed to prepare preview.');
        } finally {
          setLoadingPreview(false);
        }
      },
      error: (error) => {
        setErrorMessage(error.message || 'Failed to parse CSV.');
        setLoadingPreview(false);
      },
    });
  }

  async function handleImport() {
    setErrorMessage('');
    setMessage('');

    if (!supabase) {
      setErrorMessage('Supabase is not configured.');
      return;
    }

    if (!previewRows.length) {
      setErrorMessage('Please upload a valid CSV first.');
      return;
    }

    setImporting(true);

    const payload = previewRows.map((row) => ({
      company_id: COMPANY_ID,
      cfid: row.__cfid,
      debtor_name: cleanText(row['DEBTOR NAMES']),
      identification: cleanText(row['IDENTIFICATION']),
      contacts: cleanText(row['CONTACT(s)']),
      primary_phone: getPrimaryPhone(String(row['CONTACT(s)'] || '')),
      emails: cleanText(row['EMAIL(s)']),
      account_no: cleanText(row['ACCOUNT NO.']),
      service_account: cleanText(row['SERVICE ACCOUNT']),
      contract_no: cleanText(row['CONTRACT NO.']),
      debt_category: cleanText(row['DEBT CATEGORY']),
      debt_type: cleanText(row['DEBT TYPE']),
      currency: cleanText(row['CURRENCY']) || 'KES',
      principal_amount: toNumber(row['PRINCIPAL AMOUNT']),
      outsourced_amount: toNumber(row['OUTSOURCED AMOUNT']),
      amount_paid: toNumber(row['AMOUNT PAID']) ?? 0,
      arrears: toNumber(row['ARREARS']),
      balance: toNumber(row['BALANCE']) ?? 0,
      waiver: toNumber(row['WAIVER']),
      balance_after_waiver: toNumber(row['BALANCE AFTER WAIVER']),
      loan_taken_date: toDate(row['LOAN TAKEN DATE']),
      loan_due_date: toDate(row['LOAN DUE DATE']),
      outsource_date: toDate(row['OUTSOURCE DATE']),
      amount_repaid: toNumber(row['AMOUNT REPAID']),
      client_name: cleanText(row['CLIENT']),
      product: normalizeProduct(row['PRODUCT']),
      product_code: normalizeProductCode(row['PRODUCT']),
      dpd: toInteger(row['DPD']) ?? 0,
      dpd_level: cleanText(row['DPD LEVEL']),
      emi: toNumber(row['EMI']),
      collector_name: cleanText(row['HELD BY']),
      held_by: cleanText(row['HELD BY']),
      held_for_days: toInteger(row['HELD FOR DAYS']),
      contactability: cleanText(row['CONTACTABILITY']),
      contact_type: cleanText(row['CONTACT TYPE']),
      contact_status: cleanText(row['CONTACT STATUS']),
      status: normalizeStatus(row),
      days_since_outsource: toInteger(row['DAYS SINCE OUTSOURCE']),
      last_pay_date: toDate(row['LAST PAY DATE']),
      last_pay_amount: toNumber(row['LAST PAY AMOUNT']),
      last_action_date: toDate(row['LAST ACTION DATE']),
      next_action_date: toDate(row['NEXT ACTION DATE']),
      last_rpc_updated_date: toDate(row['LAST RPC UPDATED DATE']),
      user_id_ref: cleanText(row['USER ID']),
      branch: cleanText(row['BRANCH']),
      customer_id: cleanText(row['CUSTOMER_ID']),
      batch_no: cleanText(row['BATCH NO']),
      loans_counter: toInteger(row['LOANS COUNTER']),
      non_payment_reason: cleanText(row['NON PAYMENT REASON']),
      employer_name: cleanText(row['EMPLOYER']),
      employer_details: cleanText(row['EMPLOYER']),
      risk_category: cleanText(row['RISK CATEGORY']),
      segments: cleanText(row['SEGMENTS']),
      employment_status: 'UNKNOWN',
    }));

    try {
      const response = await fetch('/api/accounts/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ rows: previewRows }),
      });

      const result = await response.json().catch(() => null);

      setImporting(false);

      if (!response.ok) {
        setErrorMessage(result?.error || 'Import failed.');
        return;
      }

      const importedCount = Number(result?.importedCount || payload.length || 0);
      const assignedCount = Number(result?.strategySummary?.assignedCount || 0);
      const skippedCount = Number(result?.strategySummary?.skippedCount || 0);
      const failedCount = Number(result?.strategySummary?.failedCount || 0);

      setMessage(
        `Import complete. ${importedCount} account(s) uploaded successfully. ` +
          `Strategies: ${assignedCount} assigned, ${skippedCount} skipped, ${failedCount} failed.`
      );
      setPreviewRows([]);
      setFileName('');
    } catch (error: any) {
      setImporting(false);
      setErrorMessage(error?.message || 'Import failed.');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-semibold text-slate-900">Upload Accounts CSV</h1>
          <p className="mt-1 text-slate-500">
            Use the standard template headers. Product values are taken exactly as uploaded.
            CFIDs are generated automatically from the next available number.
          </p>
        </div>

        <a
          href="/accounts-import-template.csv"
          download
          className="inline-flex w-fit items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download CSV Template
        </a>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="space-y-5">
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700">Upload CSV</label>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-slate-700"
            />
            {fileName ? (
              <p className="mt-2 text-sm text-slate-500">Selected file: {fileName}</p>
            ) : null}
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
            Required in practice: at least <strong>DEBTOR NAMES</strong>. Most other columns may be blank and can be updated later in the app.
          </div>

          {loadingPreview ? <p className="text-sm text-slate-500">Preparing preview...</p> : null}
          {errorMessage ? <p className="text-sm text-red-600">{errorMessage}</p> : null}
          {message ? <p className="text-sm text-emerald-700">{message}</p> : null}

          {missingHeaders.length > 0 ? (
            <p className="text-sm text-red-600">
              Missing headers: {missingHeaders.join(', ')}
            </p>
          ) : null}

          {previewRows.length > 0 ? (
            <>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Generated CFID</th>
                      <th className="px-4 py-3">Debtor</th>
                      <th className="px-4 py-3">Account No.</th>
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Collector</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 10).map((row) => (
                      <tr
                        key={`${row.__cfid}-${row['ACCOUNT NO.'] || row['DEBTOR NAMES']}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">{row.__cfid}</td>
                        <td className="px-4 py-3">{row['DEBTOR NAMES'] || '-'}</td>
                        <td className="px-4 py-3">{row['ACCOUNT NO.'] || '-'}</td>
                        <td className="px-4 py-3">{row['PRODUCT'] || '-'}</td>
                        <td className="px-4 py-3">{row['CONTACT(s)'] || '-'}</td>
                        <td className="px-4 py-3">{row['HELD BY'] || '-'}</td>
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
                  {importing ? 'Importing...' : `Import ${previewCount} Accounts`}
                </button>

                <Link
                  href="/accounts"
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Back to Accounts
                </Link>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}