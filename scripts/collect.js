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
    const nameMatch = title.match(/^\S+\s+-\s+(.+?)\s*\(\d{7,10}\)/);
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
const NEWS_QUERIES = [
  'company "plans IPO" 2026',
  'company "confidentially filed" IPO',
  '"IPO" "has hired" banks underwriters',
  '"going public" "next year" startup',
  'IPO "as soon as" listing US'
];

const NEWS_STOPWORDS = new Set([
  'The','A','An','US','U.S.','IPO','Wall','Street','New','York','Nasdaq','NYSE',
  'Reuters','Bloomberg','CNBC','Report','Exclusive','Sources','Why','How','What','Plans','Rare','Safety','Chinese','Firm','Say','Says','Backed'
]);

function extractCompany(headline) {
  let clean = headline.replace(/\s+-\s+[^-]+$/, '').trim();
  clean = clean.replace(/['\u2019]s\b/g, '');

  const anchors = clean.match(/\b([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,2})\s+(?:firm|startup|maker|group|holdings)?\s*(?:plans|files|weighs|targets|eyes|seeks|hires|confidentially|to\s+go\s+public|IPO)/);
  if (anchors && anchors[1]) {
    const candidate = anchors[1].split(/\s+/).filter(w => !NEWS_STOPWORDS.has(w)).join(' ');
    if (candidate.length >= 3) return candidate;
  }

  const words = clean.split(/\s+/);
  const captured = [];
  for (const word of words) {
    const bare = word.replace(/[^A-Za-z0-9&.\-]/g, '');
    if (!bare) break;
    if (/^[A-Z]/.test(bare) && !NEWS_STOPWORDS.has(bare)) {
      captured.push(bare);
      if (captured.length >= 3) break;
    } else if (captured.length > 0) {
      break;
    }
  }

  const name = captured.join(' ');
  return name.length >= 3 ? name : null;
}

async function fetchNews() {
  const results = [];

  for (const query of NEWS_QUERIES) {
    const url = 'https://news.google.com/rss/search?q='
      + encodeURIComponent(query) + '&hl=en-US&gl=US&ceid=US:en';

    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!response.ok) {
        console.log('NEWS FAILED: HTTP ' + response.status);
        continue;
      }

      const xml = await response.text();
      const items = xml.split('<item>').slice(1);

      for (const item of items) {
        const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/);
        const dateMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        if (!titleMatch) continue;

        const headline = titleMatch[1].trim();
        const name = extractCompany(headline);
        if (!name) continue;
        if (!isRealCompany(name)) continue;

        results.push({
          name: name,
          cik: null,
          status: 'rumored',
          confidence: 35,
          signal: headline.slice(0, 140),
          date: dateMatch ? new Date(dateMatch[1]).toISOString().slice(0, 10)
                          : new Date().toISOString().slice(0, 10),
          source: linkMatch ? linkMatch[1].trim() : null
        });
      }
    } catch (error) {
      console.log('NEWS ERROR: ' + error.message);
    }

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const seen = new Set();
  const unique = results.filter(item => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log('OK news: ' + unique.length + ' rumors from ' + results.length + ' headlines');
  return unique;
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
  const rumors = await fetchNews();
  for (const rumor of rumors) {
    const key = rumor.name.toLowerCase() + '|rumored';
    if (!byKey[key]) byKey[key] = rumor;
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
