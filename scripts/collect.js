const fs = require('fs');

const USER_AGENT = 'IPO Tracker jliang@themesetfs.com';

const FORMS = {
  'S-1':     { status: 'filed',   confidence: 90, signal: 'S-1 filed with SEC' },
  'S-1/A':   { status: 'filed',   confidence: 92, signal: 'S-1 amended' },
  'F-1':     { status: 'filed',   confidence: 90, signal: 'F-1 filed (foreign issuer)' },
  'F-1/A':   { status: 'filed',   confidence: 92, signal: 'F-1 amended' },
  '424B4':   { status: 'priced',  confidence: 99, signal: 'Final prospectus filed, deal priced' },
  '8-A12B':  { status: 'priced',  confidence: 98, signal: 'Exchange registration, listing imminent' }
};

const EXCLUDE_PATTERNS = [
  /\bETF\b/i,
  /\bTRUST\b/i,
  /\bFUND\b/i,
  /\bFUNDS\b/i,
  /\bINDEX\b/i,
  /\bSHARES\b/i,
  /\bPORTFOLIO\b/i,
  /\bSERIES\s+TRUST\b/i,
  /\bISHARES\b/i,
  /\bSPDR\b/i,
  /\bPROSHARES\b/i,
  /\bINVESCO\b/i,
  /\bVANGUARD\b/i,
  /\bDIREXION\b/i,
  /\bGRAYSCALE\b/i,
  /\bACQUISITION\s+CORP/i,
  /\bBLANK\s+CHECK\b/i,
  /\bDEPOSITARY\b/i,
  /\bSTATUTORY\s+TRUST\b/i,
  /\bREIT\b/i
];

function isRealCompany(name) {
  return !EXCLUDE_PATTERNS.some(pattern => pattern.test(name));
}
async function fetchForm(form) {
  const url = 'https://www.sec.gov/cgi-bin/browse-edgar'
    + '?action=getcurrent&type=' + encodeURIComponent(form)
    + '&dateb=&owner=include&count=40&output=atom';

  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    console.log('FAILED ' + form + ': HTTP ' + response.status);
    return [];
  }

  const xml = await response.text();
  const entries = xml.split('<entry>').slice(1);
  const results = [];

  for (const entry of entries) {
    const titleMatch = entry.match(/<title>([^<]*)<\/title>/);
    const linkMatch = entry.match(/href="([^"]*)"/);
    const dateMatch = entry.match(/<updated>([^<]*)<\/updated>/);
    if (!titleMatch) continue;

    const title = titleMatch[1];
    const nameMatch = title.match(/-\s*(.+?)\s*\(\d{7,10}\)/);
    const cikMatch = title.match(/\((\d{7,10})\)/);
    if (!nameMatch) continue;
    if (!isRealCompany(nameMatch[1])) continue;

    const meta = FORMS[form];
    results.push({
      name: nameMatch[1].trim(),
      cik: cikMatch ? cikMatch[1] : null,
      status: meta.status,
      confidence: meta.confidence,
      signal: meta.signal,
      date: dateMatch ? dateMatch[1].slice(0, 10) : new Date().toISOString().slice(0, 10),
      source: linkMatch ? linkMatch[1] : null
    });
  }

  console.log('OK ' + form + ': ' + results.length + ' filings');
  return results;
}

async function main() {
  const existing = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  const byKey = {};

  for (const company of existing.companies || []) {
    if (company.cik) byKey[company.cik + '|' + company.status] = company;
  }

  for (const form of Object.keys(FORMS)) {
    const filings = await fetchForm(form);
    for (const filing of filings) {
      const key = (filing.cik || filing.name) + '|' + filing.status;
      const prior = byKey[key];
      if (!prior || filing.date >= prior.date) byKey[key] = filing;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const companies = Object.values(byKey)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 100);

  const output = {
    updated: new Date().toISOString(),
    summary: existing.summary || '',
    companies: companies
  };

  fs.writeFileSync('data.json', JSON.stringify(output, null, 2));
  console.log('Wrote ' + companies.length + ' companies');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
