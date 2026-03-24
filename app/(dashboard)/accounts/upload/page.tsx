'use client';

import Link from 'next/link';
import Papa from 'papaparse';
import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

type ParsedRow = Record<string, string>;

type PreviewStatus =
  | 'new'
  | 'duplicate_exact'
  | 'conflict_same_loan_diff_customer'
  | 'same_customer_other_facility'
  | 'duplicate_in_file';

type PreviewRow = ParsedRow & {
  __cfid: string;
  __portfolioCategory: string;
  __productCode: string;
  __status: PreviewStatus;
  __statusMessage: string;
  __existingAccountNo: string;
  __existingCustomerId: string;
  __existingDebtorName: string;
};

type CachedPreviewState = {
  fileName: string;
  missingHeaders: string[];
  previewRows: PreviewRow[];
  message: string;
  errorMessage: string;
  resolvedCompanyId: string | null;
  resolvedCompanyName: string;
  cachedAt: number;
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

const PREVIEW_CACHE_KEY = 'accounts-upload-preview-v2';
const PEZESHA_FALLBACK_NAME = 'Pezesha';

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

function toneForStatus(status: PreviewStatus) {
  if (status === 'new') return 'bg-emerald-100 text-emerald-700';
  if (status === 'same_customer_other_facility') return 'bg-amber-100 text-amber-700';
  return 'bg-rose-100 text-rose-700';
}

function labelForStatus(status: PreviewStatus) {
  if (status === 'new') return 'Will Import';
  if (status === 'same_customer_other_facility') return 'Customer Has Another Facility';
  if (status === 'duplicate_exact') return 'Duplicate Existing Account';
  if (status === 'conflict_same_loan_diff_customer') return 'Loan Conflict';
  return 'Duplicate In File';
}

function readCachedPreview(): CachedPreviewState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(PREVIEW_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedPreviewState;

    if (!parsed || !Array.isArray(parsed.previewRows)) return null;

    return parsed;
  } catch {
    return null;
  }
}

function clearCachedPreview() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(PREVIEW_CACHE_KEY);
}

export default function UploadAccountsPage() {
  const [fileName, setFileName] = useState('');
  const [missingHeaders, setMissingHeaders] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PreviewRow[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [resolvedCompanyId, setResolvedCompanyId] = useState<string | null>(null);
  const [resolvedCompanyName, setResolvedCompanyName] = useState(PEZESHA_FALLBACK_NAME);
  const [restoredFromCache, setRestoredFromCache] = useState(false);

  const hasRestoredCacheRef = useRef(false);

  const previewCount = useMemo(() => previewRows.length, [previewRows]);

  const summary = useMemo(() => {
    return {
      newCount: previewRows.filter((row) => row.__status === 'new').length,
      sameCustomerOtherFacilityCount: previewRows.filter(
        (row) => row.__status === 'same_customer_other_facility'
      ).length,
      duplicateExactCount: previewRows.filter((row) => row.__status === 'duplicate_exact').length,
      conflictCount: previewRows.filter(
        (row) => row.__status === 'conflict_same_loan_diff_customer'
      ).length,
      duplicateInFileCount: previewRows.filter((row) => row.__status === 'duplicate_in_file').length,
    };
  }, [previewRows]);

  const importableCount = summary.newCount + summary.sameCustomerOtherFacilityCount;

  useEffect(() => {
    if (hasRestoredCacheRef.current) return;
    hasRestoredCacheRef.current = true;

    const cached = readCachedPreview();
    if (!cached) return;

    setFileName(cached.fileName || '');
    setMissingHeaders(cached.missingHeaders || []);
    setPreviewRows(cached.previewRows || []);
    setMessage(cached.message || '');
    setErrorMessage(cached.errorMessage || '');
    setResolvedCompanyId(cached.resolvedCompanyId || null);
    setResolvedCompanyName(cached.resolvedCompanyName || PEZESHA_FALLBACK_NAME);
    setRestoredFromCache((cached.previewRows || []).length > 0);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasSomethingToCache =
      !!fileName ||
      previewRows.length > 0 ||
      missingHeaders.length > 0 ||
      !!message ||
      !!errorMessage ||
      !!resolvedCompanyId;

    if (!hasSomethingToCache) {
      clearCachedPreview();
      return;
    }

    const payload: CachedPreviewState = {
      fileName,
      missingHeaders,
      previewRows,
      message,
      errorMessage,
      resolvedCompanyId,
      resolvedCompanyName,
      cachedAt: Date.now(),
    };

    window.sessionStorage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(payload));
  }, [
    fileName,
    missingHeaders,
    previewRows,
    message,
    errorMessage,
    resolvedCompanyId,
    resolvedCompanyName,
  ]);

  async function resolveCurrentCompany() {
    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message || 'Unable to load user session.');
    }

    const session = sessionData?.session;
    const userId = session?.user?.id || null;

    let profileCompanyId: string | null = null;

    if (userId) {
      const { data: profile, error: profileError } = await supabase
        .from('user_profiles')
        .select('company_id')
        .eq('id', userId)
        .maybeSingle();

      if (profileError) {
        throw new Error(profileError.message || 'Unable to load user profile.');
      }

      profileCompanyId = String(profile?.company_id || '').trim() || null;
    }

    if (profileCompanyId) {
      return {
        companyId: profileCompanyId,
        companyName: PEZESHA_FALLBACK_NAME,
        accessToken: session?.access_token || '',
      };
    }

    const { data: pezeshaCompany, error: companyError } = await supabase
      .from('companies')
      .select('id,name')
      .ilike('name', PEZESHA_FALLBACK_NAME)
      .limit(1)
      .maybeSingle();

    if (companyError) {
      throw new Error(companyError.message || 'Unable to resolve Pezesha company context.');
    }

    const fallbackCompanyId = String(pezeshaCompany?.id || '').trim() || null;
    const fallbackCompanyName = String(pezeshaCompany?.name || '').trim() || PEZESHA_FALLBACK_NAME;

    return {
      companyId: fallbackCompanyId,
      companyName: fallbackCompanyName,
      accessToken: session?.access_token || '',
    };
  }

  function resetPreviewState(options?: { keepCompany?: boolean }) {
    setMissingHeaders([]);
    setPreviewRows([]);
    setMessage('');
    setErrorMessage('');

    if (!options?.keepCompany) {
      setResolvedCompanyId(null);
      setResolvedCompanyName(PEZESHA_FALLBACK_NAME);
    }

    clearCachedPreview();
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setErrorMessage('');
    setMessage('');
    setPreviewRows([]);
    setMissingHeaders([]);
    setRestoredFromCache(false);

    if (!file) return;

    if (!supabase) {
      setErrorMessage('Supabase is not configured.');
      return;
    }

    setFileName(file.name);
    setLoadingPreview(true);
    setMessage('Preparing preview...');

    try {
      const client = supabase;

      if (!client) {
        setErrorMessage('Supabase is not configured.');
        setLoadingPreview(false);
        return;
      }

      const { companyId, companyName } = await resolveCurrentCompany();

      setResolvedCompanyId(companyId);
      setResolvedCompanyName(companyName || PEZESHA_FALLBACK_NAME);

      Papa.parse<ParsedRow>(file, {
        header: true,
        skipEmptyLines: true,
        worker: true,
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

            const allRows = (results.data || []) as ParsedRow[];
            const filteredRows = allRows.filter(
              (row) =>
                String(row['customer_names'] || '').trim() !== '' ||
                String(row['loan_id'] || '').trim() !== ''
            );

            if (!filteredRows.length) {
              setErrorMessage('The CSV has no usable rows to preview.');
              setLoadingPreview(false);
              return;
            }

            let cfidQuery = client
              .from('accounts')
              .select('cfid')
              .not('cfid', 'is', null)
              .order('cfid', { ascending: false })
              .limit(1);

            let existingByLoanQuery = client
              .from('accounts')
              .select('id,account_no,customer_id,debtor_name');

            let existingByCustomerQuery = client
              .from('accounts')
              .select('id,account_no,customer_id,debtor_name');

            if (companyId) {
              cfidQuery = cfidQuery.eq('company_id', companyId);
              existingByLoanQuery = existingByLoanQuery.eq('company_id', companyId);
              existingByCustomerQuery = existingByCustomerQuery.eq('company_id', companyId);
            }

            const loanIds = Array.from(
              new Set(filteredRows.map((row) => String(row['loan_id'] || '').trim()).filter(Boolean))
            );

            const customerIds = Array.from(
              new Set(
                filteredRows.map((row) => String(row['customer_id'] || '').trim()).filter(Boolean)
              )
            );

            const [
              { data: existingCfids, error: cfidError },
              { data: existingByLoan, error: existingLoanError },
              { data: existingByCustomer, error: existingCustomerError },
            ] = await Promise.all([
              cfidQuery,
              loanIds.length > 0
                ? existingByLoanQuery.in('account_no', loanIds)
                : Promise.resolve({ data: [], error: null } as any),
              customerIds.length > 0
                ? existingByCustomerQuery.in('customer_id', customerIds)
                : Promise.resolve({ data: [], error: null } as any),
            ]);

            if (cfidError) {
              setErrorMessage(`Failed to read existing CFIDs: ${cfidError.message}`);
              setLoadingPreview(false);
              return;
            }

            if (existingLoanError) {
              setErrorMessage(`Failed to read existing loans: ${existingLoanError.message}`);
              setLoadingPreview(false);
              return;
            }

            if (existingCustomerError) {
              setErrorMessage(`Failed to read existing customers: ${existingCustomerError.message}`);
              setLoadingPreview(false);
              return;
            }

            const maxExistingCfid = Math.max(
              0,
              ...((existingCfids || [])
                .map((row: any) => getNumericCfid(row.cfid))
                .filter((value: number | null): value is number => value !== null))
            );

            const existingLoanMap = new Map<string, any>();
            for (const item of existingByLoan || []) {
              const key = String(item.account_no || '').trim();
              if (key) existingLoanMap.set(key, item);
            }

            const existingCustomerMap = new Map<string, any[]>();
            for (const item of existingByCustomer || []) {
              const key = String(item.customer_id || '').trim();
              if (!key) continue;
              const current = existingCustomerMap.get(key) || [];
              current.push(item);
              existingCustomerMap.set(key, current);
            }

            const seenCompoundKeys = new Set<string>();
            const seenLoanIds = new Set<string>();

            let nextNumber = maxExistingCfid + 1;

            const generatedPreview: PreviewRow[] = filteredRows.map((row) => {
              const cfid = padCfid(nextNumber);
              nextNumber += 1;

              const loanId = String(row['loan_id'] || '').trim();
              const customerId = String(row['customer_id'] || '').trim();
              const compoundKey = `${loanId}::${customerId}`;

              const existingLoan = loanId ? existingLoanMap.get(loanId) : null;
              const existingCustomerFacilities = customerId
                ? existingCustomerMap.get(customerId) || []
                : [];

              let status: PreviewStatus = 'new';
              let statusMessage = '';
              let existingAccountNo = '';
              let existingCustomerId = '';
              let existingDebtorName = '';

              if (seenCompoundKeys.has(compoundKey)) {
                status = 'duplicate_in_file';
                statusMessage = 'Duplicate row in this upload with the same loan_id and customer_id.';
              } else if (loanId && seenLoanIds.has(loanId)) {
                status = 'duplicate_in_file';
                statusMessage = 'Duplicate loan_id appears more than once in this upload.';
              } else if (existingLoan) {
                existingAccountNo = String(existingLoan.account_no || '');
                existingCustomerId = String(existingLoan.customer_id || '');
                existingDebtorName = String(existingLoan.debtor_name || '');

                if (String(existingLoan.customer_id || '').trim() === customerId) {
                  status = 'duplicate_exact';
                  statusMessage =
                    'This account already exists with the same loan_id and customer_id.';
                } else {
                  status = 'conflict_same_loan_diff_customer';
                  statusMessage = 'This loan_id already exists under a different customer_id.';
                }
              } else if (
                customerId &&
                existingCustomerFacilities.some(
                  (facility) => String(facility.account_no || '').trim() !== loanId
                )
              ) {
                const otherFacility =
                  existingCustomerFacilities.find(
                    (facility) => String(facility.account_no || '').trim() !== loanId
                  ) || null;

                existingAccountNo = String(otherFacility?.account_no || '');
                existingCustomerId = String(otherFacility?.customer_id || '');
                existingDebtorName = String(otherFacility?.debtor_name || '');
                status = 'same_customer_other_facility';
                statusMessage =
                  'This customer already has another facility in the system. This row can still be imported.';
              }

              if (loanId) seenLoanIds.add(loanId);
              if (loanId || customerId) seenCompoundKeys.add(compoundKey);

              return {
                ...row,
                __cfid: cfid,
                __portfolioCategory: normalizePortfolioCategory(row['loan_type']),
                __productCode: normalizeStrategyProductCode(),
                __status: status,
                __statusMessage: statusMessage,
                __existingAccountNo: existingAccountNo,
                __existingCustomerId: existingCustomerId,
                __existingDebtorName: existingDebtorName,
              };
            });

            setPreviewRows(generatedPreview);
            setMessage(
              `Preview ready for ${companyName || PEZESHA_FALLBACK_NAME}. ${generatedPreview.length} row(s) reviewed.`
            );
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
    } catch (error: any) {
      setLoadingPreview(false);
      setErrorMessage(error?.message || 'Failed to resolve upload context.');
    }
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

    const importableRows = previewRows.filter(
      (row) => row.__status === 'new' || row.__status === 'same_customer_other_facility'
    );

    if (!importableRows.length) {
      setErrorMessage('There are no importable rows. Remove duplicates or conflicts first.');
      return;
    }

    setImporting(true);

    try {
      const { accessToken, companyId, companyName } = await resolveCurrentCompany();

      const response = await fetch('/api/accounts/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({
          rows: previewRows,
          companyId: companyId || null,
          companyName: companyName || PEZESHA_FALLBACK_NAME,
        }),
      });

      const result = await response.json().catch(() => null);

      setImporting(false);

      if (!response.ok) {
        setErrorMessage(result?.error || 'Import failed.');
        return;
      }

      const importedCount = Number(result?.importedCount || 0);
      const notesImportedCount = Number(result?.notesImportedCount || 0);
      const assignedCount = Number(result?.strategySummary?.assignedCount || 0);
      const skippedCount = Number(result?.strategySummary?.skippedCount || 0);
      const failedCount = Number(result?.strategySummary?.failedCount || 0);
      const duplicateExactCount = Number(result?.duplicateSummary?.duplicateExactCount || 0);
      const conflictCount = Number(result?.duplicateSummary?.conflictCount || 0);
      const sameCustomerOtherFacilityCount = Number(
        result?.duplicateSummary?.sameCustomerOtherFacilityCount || 0
      );

      setMessage(
        `Import complete for ${companyName || PEZESHA_FALLBACK_NAME}. ${importedCount} account(s) uploaded successfully. ` +
          `Notes: ${notesImportedCount}. ` +
          `Strategies: ${assignedCount} assigned, ${skippedCount} skipped, ${failedCount} failed. ` +
          `Duplicates blocked: ${duplicateExactCount}. Conflicts blocked: ${conflictCount}. ` +
          `Other facilities allowed: ${sameCustomerOtherFacilityCount}.`
      );

      setPreviewRows([]);
      setFileName('');
      setMissingHeaders([]);
      clearCachedPreview();
    } catch (error: any) {
      setImporting(false);
      setErrorMessage(error?.message || 'Import failed.');
    }
  }

  function handleClearPreview() {
    setFileName('');
    setRestoredFromCache(false);
    resetPreviewState({ keepCompany: false });
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
          <p className="mt-2 text-sm text-slate-500">
            Company context: <span className="font-medium text-slate-700">{resolvedCompanyName}</span>
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
          {restoredFromCache && previewRows.length > 0 ? (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
              Restored your last preview from this browser session so you can continue without
              re-uploading the file.
            </div>
          ) : null}

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
            <p className="text-sm text-red-600">Missing headers: {missingHeaders.join(', ')}</p>
          ) : null}

          {previewRows.length > 0 ? (
            <>
              <div className="grid gap-4 md:grid-cols-5">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Rows Reviewed</p>
                  <p className="mt-2 text-2xl font-semibold text-slate-900">{previewCount}</p>
                </div>

                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-emerald-700">Will Import</p>
                  <p className="mt-2 text-2xl font-semibold text-emerald-800">{summary.newCount}</p>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-amber-700">Other Facilities</p>
                  <p className="mt-2 text-2xl font-semibold text-amber-800">
                    {summary.sameCustomerOtherFacilityCount}
                  </p>
                </div>

                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-rose-700">Duplicates</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-800">
                    {summary.duplicateExactCount + summary.duplicateInFileCount}
                  </p>
                </div>

                <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                  <p className="text-xs uppercase tracking-wide text-rose-700">Conflicts</p>
                  <p className="mt-2 text-2xl font-semibold text-rose-800">{summary.conflictCount}</p>
                </div>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-600">
                    <tr>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Generated CFID</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Loan ID</th>
                      <th className="px-4 py-3">Customer ID</th>
                      <th className="px-4 py-3">Loan Type</th>
                      <th className="px-4 py-3">Portfolio Category</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Officer</th>
                      <th className="px-4 py-3">Preview Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.slice(0, 20).map((row) => (
                      <tr
                        key={`${row.__cfid}-${row['loan_id'] || row['customer_names']}`}
                        className="border-t border-slate-200"
                      >
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-full px-3 py-1 text-xs font-medium ${toneForStatus(
                              row.__status
                            )}`}
                          >
                            {labelForStatus(row.__status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-900">{row.__cfid}</td>
                        <td className="px-4 py-3">{row['customer_names'] || '-'}</td>
                        <td className="px-4 py-3">{row['loan_id'] || '-'}</td>
                        <td className="px-4 py-3">{row['customer_id'] || '-'}</td>
                        <td className="px-4 py-3">{normalizeLoanType(row['loan_type']) || '-'}</td>
                        <td className="px-4 py-3">{row.__portfolioCategory || '-'}</td>
                        <td className="px-4 py-3">{row['customer_phoneno'] || '-'}</td>
                        <td className="px-4 py-3">{row['officer'] || '-'}</td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {row.__statusMessage ? (
                            <div className="space-y-1">
                              <p>{row.__statusMessage}</p>
                              {row.__existingDebtorName || row.__existingAccountNo ? (
                                <p className="text-slate-500">
                                  Existing: {row.__existingDebtorName || '-'} | Loan:{' '}
                                  {row.__existingAccountNo || '-'} | Customer ID:{' '}
                                  {row.__existingCustomerId || '-'}
                                </p>
                              ) : null}
                            </div>
                          ) : (
                            'Ready to import.'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {previewRows.length > 20 ? (
                <p className="text-sm text-slate-500">
                  Showing first 20 rows of {previewRows.length} preview rows.
                </p>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing || importableCount === 0}
                  className="rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {importing ? 'Importing...' : `Import ${importableCount} Accounts`}
                </button>

                <button
                  type="button"
                  onClick={handleClearPreview}
                  disabled={importing || loadingPreview}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Clear Preview
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