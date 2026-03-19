'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ParsedRow = Record<string, string>;
type PreviewRow = ParsedRow & {
  __cfid: string;
  __portfolioCategory: string;
  __productCode: string;
};

const EXPECTED_HEADERS = [
  'loan_id',
  'customer_id',
  'customer_names',
  'customer_phoneno',
  'national_id',
  'region',
  'loan_status',
  'loan_type',
  'score',
  'risk_segment',
  'installment_type',
  'funded_date',
  'due_date',
  'last_installment_date',
  'days_late_lastinstallment',
  'duration',
  'total_due',
  'repaid_amounts',
  'Outstanding_balance',
  'days_late',
  'officer',
  'PTP_offered',
  'PTP_due_date',
  'PTP_amount',
  'Reachability',
  'Collectability',
  'Officer Feedback 1',
  'Officer Feedback 2',
] as const;

function padCfid(num: number) {
  return String(num).padStart(3, '0');
}

function getNumericCfid(value: unknown) {
  const digits = String(value || '').replace(/\D/g, '').trim();
  if (!digits) return null;
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeLoanType(value: unknown) {
  const raw = String(value || '').trim();
  return raw || null;
}

function normalizePortfolioCategory(value: unknown) {
  const loanType = String(value || '').trim().toUpperCase();
  if (!loanType) return '';
  return loanType === 'POCHI' ? 'POCHI' : 'Non-Pochi';
}

function normalizeStrategyProductCode() {
  return 'mobile_loan';
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
            (row) =>
              String(row['customer_names'] || '').trim() !== '' ||
              String(row['loan_id'] || '').trim() !== ''
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
              __portfolioCategory: normalizePortfolioCategory(row['loan_type']),
              __productCode: normalizeStrategyProductCode(),
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

      const importedCount = Number(result?.importedCount || previewRows.length || 0);
      const notesImportedCount = Number(result?.notesImportedCount || 0);
      const assignedCount = Number(result?.strategySummary?.assignedCount || 0);
      const skippedCount = Number(result?.strategySummary?.skippedCount || 0);
      const failedCount = Number(result?.strategySummary?.failedCount || 0);

      setMessage(
        `Import complete. ${importedCount} account(s) uploaded successfully. ` +
          `Notes: ${notesImportedCount}. ` +
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
            Use the new standard mobile loans template. CFIDs are generated automatically.
            Loan type is stored as product, portfolio grouping is derived as POCHI or Non-Pochi,
            and strategy compatibility is retained using mobile_loan.
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
            Required in practice: at least <strong>loan_id</strong> or <strong>customer_names</strong>.
            Officer Feedback 1 and Officer Feedback 2 will be imported into notes. PTP fields will
            be carried into account update context and notes.
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
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Loan ID</th>
                      <th className="px-4 py-3">Loan Type</th>
                      <th className="px-4 py-3">Portfolio Category</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Officer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 10).map((row) => (
                      <tr
                        key={`${row.__cfid}-${row['loan_id'] || row['customer_names']}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-4 py-3 font-medium text-slate-900">{row.__cfid}</td>
                        <td className="px-4 py-3">{row['customer_names'] || '-'}</td>
                        <td className="px-4 py-3">{row['loan_id'] || '-'}</td>
                        <td className="px-4 py-3">{normalizeLoanType(row['loan_type']) || '-'}</td>
                        <td className="px-4 py-3">{row.__portfolioCategory || '-'}</td>
                        <td className="px-4 py-3">{row['customer_phoneno'] || '-'}</td>
                        <td className="px-4 py-3">{row['officer'] || '-'}</td>
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