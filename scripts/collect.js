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
  /\bETF\b/i, /\bTRUST\b/i, /\bFUND\b/i, /\bFUNDS\b/i, /\bINDEX\b/i,
  /\bSHARES\b/i, /\bPORTFOLIO\b/i, /\bISHARES\b/i, /\bSPDR\b/i,
  /\bPROSHARES\b/i, /\bINVESCO\b/i, /\bVANGUARD\b/i, /\bDIREXION\b/i,
  /\bGRAYSCALE\b/i, /\bACQUISITION\s+CORP/i, /\bBLANK\s+CHECK\b/i,
  /\bDEPOSITARY\b/i, /\bSTATUTORY\s+TRUST\b/i, /\bREIT\b/i
];

function isRealCompany(name) {
  return !EXCLUDE_PATTERNS.some(pattern => pattern.test(name));
}

const NEWS_QUERIES = [
  'company "plans IPO" 2026',
  'company "confidentially filed" IPO',
  '"IPO" "has hired" banks underwriters',
  '"going public" "next year" startup',
  'IPO "as soon as" listing US',
  '"ADR" IPO "New York" listing',
  'foreign company "US listing" IPO Nasdaq NYSE'
];

const NEWS_STOPWORDS = new Set([
  'The','A','An','US','U.S.','IPO','Wall','Street','New','York','Nasdaq','NYSE',
  'Reuters','Bloomberg','CNBC','Report','Exclusive','Sources','Why','How','What',
  'Plans','Rare','Safety','Chinese','Firm','Say','Says','Backed','Hong','Kong'
]);

function extractCompany(headline) {
  let clean = headline.replace(/\s+-\s+[^-]+$/, '').trim();
  clean = clean.replace(/['\u2019]s\b/g, '');

  const anchors = clean.match(/\b([A-Z][A-Za-z0-9&.\-]*(?:\s+[A-Z][A-Za-z0-9&.\-]*){0,2})\s+(?:firm|startup|maker|group|holdings)?\s*(?:plans|files|weighs|targets|eyes|seeks|hires|confidentially)/);
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
  const
