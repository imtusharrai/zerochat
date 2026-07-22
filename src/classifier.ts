import { VisitorType } from './types';

const SALES_KEYWORDS = [
  'price', 'cost', 'how much', 'rate', 'charge', 'fee', 'quote',
  'delivery', 'deliver', 'shipping', 'order', 'buy', 'purchase',
  'available', 'stock', 'catalog', 'menu', 'product', 'service',
  'book', 'booking', 'reserve', 'appointment',
  'discount', 'offer', 'deal', 'package',
  'kg', 'piece', 'pieces', 'quantity', 'bulk',
  'kitna', 'kimat', 'daam', 'rate kya', 'milega', 'mil jayega',
  'khareedna', 'order karna', 'delivery hoti', 'available hai',
  'bhej', 'bhejna', 'mangwana',
];

const JOB_KEYWORDS = [
  'job', 'vacancy', 'hiring', 'hire', 'apply', 'application',
  'resume', 'cv', 'career', 'position', 'opening', 'internship',
  'work with you', 'looking for work', 'looking for a job',
  'employment', 'recruit', 'freshers', 'experience',
  'naukri', 'kaam', 'kaam chahiye', 'job chahiye',
];

const VENDOR_KEYWORDS = [
  'we offer', 'we provide', 'we supply', 'we manufacture',
  'our company', 'our product', 'our service',
  'partnership', 'collaborate', 'collaboration',
  'bulk supply', 'wholesale', 'supplier', 'distributor',
  'marketing services', 'seo', 'web design', 'social media',
  'packaging', 'raw material',
];

const COMPLAINT_KEYWORDS = [
  'order number', 'order #', 'order id',
  'complaint', 'complain', 'issue', 'problem',
  'refund', 'return', 'exchange', 'replace',
  'broken', 'damaged', 'defective', 'wrong',
  'not received', 'late delivery', 'delayed',
  'bad quality', 'poor quality', 'worst',
  'overcharged', 'extra charged',
];

const SPAM_PATTERNS = [
  /https?:\/\/\S+.*https?:\/\/\S+.*https?:\/\/\S+/i,
  /click here/i,
  /limited (time )?offer/i,
  /\d+k? followers/i,
  /earn money/i,
  /crypto|bitcoin|ethereum/i,
  /make \$\d+/i,
  /work from home.*\$/i,
];

function containsKeyword(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(keyword => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(lower) || lower.includes(keyword.toLowerCase());
  });
}

function isSpam(text: string): boolean {
  if (SPAM_PATTERNS.some(pattern => pattern.test(text))) return true;
  if (text.length > 2000) return true;
  return false;
}

export function classifyMessage(text: string): VisitorType {
  if (isSpam(text)) return 'spam';

  const scores: Record<string, number> = {
    sales: 0,
    job_seeker: 0,
    vendor: 0,
    complaint: 0,
  };

  if (containsKeyword(text, SALES_KEYWORDS)) scores.sales++;
  if (containsKeyword(text, JOB_KEYWORDS)) scores.job_seeker++;
  if (containsKeyword(text, VENDOR_KEYWORDS)) scores.vendor++;
  if (containsKeyword(text, COMPLAINT_KEYWORDS)) scores.complaint++;

  const maxScore = Math.max(...Object.values(scores));
  if (maxScore === 0) return 'unknown';

  const winner = Object.entries(scores).find(([, v]) => v === maxScore);
  return (winner?.[0] as VisitorType) ?? 'unknown';
}
