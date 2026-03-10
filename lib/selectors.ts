import { accounts, companies, payments, ptps, users } from './mock-data';

export function getCompany(companyId = 'credence') {
  return companies.find((company) => company.id === companyId) ?? companies[0];
}

export function getCurrentUser(userId = 'u1') {
  return users.find((user) => user.id === userId) ?? users[0];
}

export function getCompanyAccounts(companyId = 'credence') {
  return accounts.filter((account) => account.companyId === companyId);
}

export function getCompanyPayments(companyId = 'credence') {
  return payments.filter((payment) => payment.companyId === companyId);
}

export function getCompanyPtps(companyId = 'credence') {
  return ptps.filter((ptp) => ptp.companyId === companyId);
}

export function getCollectorPerformance(companyId = 'credence') {
  const companyPayments = getCompanyPayments(companyId);
  const companyPtps = getCompanyPtps(companyId);
  const companyAccounts = getCompanyAccounts(companyId);

  const collectors = Array.from(new Set(companyAccounts.map((item) => item.collector)));

  return collectors.map((collector) => {
    const collectorPayments = companyPayments.filter((payment) => payment.collector === collector);
    const collectorPtps = companyPtps.filter((ptp) => ptp.collector === collector);
    const collectorAccounts = companyAccounts.filter((account) => account.collector === collector);

    return {
      collector,
      assignedAccounts: collectorAccounts.length,
      totalCollected: collectorPayments.reduce((sum, item) => sum + item.amount, 0),
      loanCollected: collectorPayments.filter((p) => p.product === 'ABSA LOAN').reduce((s, i) => s + i.amount, 0),
      cardCollected: collectorPayments.filter((p) => p.product === 'ABSA CREDIT CARD').reduce((s, i) => s + i.amount, 0),
      openPtps: collectorPtps.filter((ptp) => ptp.status === 'Promise To Pay').length,
      keptRate: collectorPtps.length ? Math.round((collectorPtps.filter((ptp) => ptp.status === 'Kept').length / collectorPtps.length) * 100) : 0,
    };
  });
}
