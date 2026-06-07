/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Plus, 
  Search, 
  SlidersHorizontal, 
  MessageSquare, 
  TrendingUp, 
  TrendingDown, 
  Download, 
  RotateCcw, 
  AlertCircle, 
  Sparkles, 
  Smartphone, 
  Bell, 
  PiggyBank, 
  DollarSign, 
  Calendar, 
  Tag, 
  Info, 
  ArrowRight, 
  ChevronRight,
  ChevronDown,
  User,
  CheckCircle2,
  Trash2,
  FileText
} from 'lucide-react';

import { Transaction, SmsMessage, BudgetLimit } from './types';
import { HISTORICAL_TRANSACTIONS } from './historicalData';

// Mobile: Direct Gemini API helper
const GEMINI_API_KEY_STORAGE = 'finance_tracker_gemini_key';
function getStoredGeminiKey(): string {
  return localStorage.getItem(GEMINI_API_KEY_STORAGE) || '';
}
async function callGeminiDirect(prompt: string, schema?: object): Promise<string> {
  const apiKey = getStoredGeminiKey();
  if (!apiKey) throw new Error('NO_API_KEY');
  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
  };
  if (schema) {
    body.generationConfig = { ...(body.generationConfig as object), responseMimeType: 'application/json', responseSchema: schema };
  }
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`Gemini error: ${res.status}`);
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Android Native Bridge (reads SMS from native layer) ─────────────────────
// When running as a native APK, MainActivity injects window.AndroidBridge.
// The React app polls this on startup to pick up any SMS detected while closed.
declare global {
  interface Window {
    AndroidBridge?: {
      getPendingSms: () => string;       // returns JSON array of SmsMessage records
      markSmsProcessed: (id: string) => void;
      isAndroidApp: () => boolean;
    };
    __openSmsTab?: (smsId?: string) => void;
    __initialTab?: string;
  }
}
function parseSmartLocal(text: string): {
  amount: number; type: 'income' | 'expense';
  merchant: string; bankName: string; proposedCategory: string;
} {
  const t = text;
  
  // Amount: Rs.3000, Rs 3,000, INR 3000, 3000.00, ₹3000
  const amtMatch = t.match(/(?:Rs\.?|INR|₹)\s*([\d,]+(?:\.\d{1,2})?)/i)
    || t.match(/([\d,]+(?:\.\d{2})?)\s*(?:Rs|INR|₹)/i);
  const amount = amtMatch ? parseFloat(amtMatch[1].replace(/,/g, '')) : 0;

  // Type: credit = income, debit = expense
  const isCredit = /\b(credit|credited|received|refund|cashback|deposited|reversed|added)\b/i.test(t);
  const type: 'income' | 'expense' = isCredit ? 'income' : 'expense';

  // Bank name
  const bankMatch = t.match(/\b(HDFC|SBI|ICICI|Axis|Kotak|YES|PNB|BOI|BOB|Canara|Union|IndusInd|Federal|IDBI|RBL)\s*Bank\b/i);
  const bankName = bankMatch ? bankMatch[0] : 'Bank';

  // Merchant: UPI "To XYZ", "at XYZ", "from VPA xyz@"
  let merchant = 'Unknown';
  const upiTo = t.match(/\bTo\s+([A-Za-z0-9 &'-]+?)(?:\s+On|\s+Ref|\s+UPI|\s+Rs|$)/i);
  const atMerchant = t.match(/\bat\s+([A-Za-z0-9 &'-]+?)(?:\s+on|\s+Rs|,|$)/i);
  const fromVpa = t.match(/from\s+VPA\s+[\w.@]+\s+For\s+(.+?)(?:\s+(?:Ref|UPI|$))/i);
  const upiRef = t.match(/\(UPI\s+[\d]+\)\s+For\s+(.+?)(?:\s*$)/i);
  if (upiTo) merchant = upiTo[1].trim();
  else if (atMerchant) merchant = atMerchant[1].trim();
  else if (fromVpa) merchant = fromVpa[1].trim();
  else if (upiRef) merchant = upiRef[1].trim();

  // Category heuristics
  let proposedCategory = isCredit ? 'Income' : 'Grocery & Essentials';
  const low = t.toLowerCase();
  if (/rapido|uber|ola|auto|metro|bus|train|namma|yulu|bounce|bike/.test(low)) proposedCategory = 'Transport';
  else if (/zomato|swiggy|food|restaurant|cafe|hotel|eat|dominos|kfc|mcdonald|pizza/.test(low)) proposedCategory = 'Food & Beverages';
  else if (/amazon|flipkart|meesho|myntra|ajio|nykaa|shop|store|mart/.test(low)) proposedCategory = 'Grocery & Essentials';
  else if (/netflix|hotstar|prime|spotify|movie|cinema|pvr|inox|theatre/.test(low)) proposedCategory = 'Movie/Outing';
  else if (/doctor|hospital|pharmacy|med|clinic|apollo|health|care/.test(low)) proposedCategory = 'Health';
  else if (/rent|utility|electricity|water|gas|bsnl|jio|airtel|bill|recharge/.test(low)) proposedCategory = 'Rent & Utilities';
  else if (/salary|stipend|payroll|income/.test(low)) proposedCategory = 'Income';

  return { amount, type, merchant, bankName, proposedCategory };
}

// Custom lightweight SVG Radar Chart for visual analytics
const RadarChart = ({ data }: { data: { category: string; spent: number; limit: number }[] }) => {
  const center = 80;
  const maxRadius = 50;
  // Make sure we have at least 3 points, otherwise radar is a straight line
  const displayData = data.length >= 3 ? data : [
    ...data,
    ...['Rent & Utilities', 'Groceries', 'Others']
      .filter(c => !data.some(d => d.category === c))
      .map(c => ({ category: c, spent: 0, limit: 10000 }))
  ].slice(0, 5);

  const numPoints = displayData.length;
  const ringSteps = [0.25, 0.5, 0.75, 1.0];

  // Map each data point with computed angle around circle
  const points = displayData.map((d, index) => {
    const angle = (index * 2 * Math.PI) / numPoints - Math.PI / 2;
    // Calculate spent ratio bounded
    const ratio = d.limit > 0 ? Math.min(1.2, d.spent / d.limit) : 0;
    const r = ratio * maxRadius;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return { x, y, angle, category: d.category, ratio, ...d };
  });

  // Polyline representation
  const polygonPath = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <div className="flex flex-col items-center bg-[#0d0d0d] rounded-2xl border border-[#1a1a1a] p-4 font-mono">
      <div className="flex items-center gap-1.5 self-start mb-2 border-b border-[#141414] w-full pb-1.5">
        <span className="text-[#d4af37] text-xs">◇</span>
        <h4 className="text-[10px] uppercase tracking-wider text-[#d4af37] font-semibold">Category Budget Radar</h4>
      </div>
      
      <div className="relative w-full flex justify-center items-center py-2">
        <svg viewBox="0 0 160 160" className="w-[140px] h-[140px] overflow-visible">
          {/* Grid Concentric Rings */}
          {ringSteps.map((step, idx) => {
            const r = step * maxRadius;
            return (
              <circle
                key={idx}
                cx={center}
                cy={center}
                r={r}
                fill="none"
                stroke="#1c1c1c"
                strokeWidth={idx === 3 ? "1.5" : "0.75"}
                strokeDasharray={idx < 3 ? "2 2" : "none"}
              />
            );
          })}

          {/* Guide Spokes */}
          {points.map((p, idx) => {
            const xOuter = center + maxRadius * Math.cos(p.angle);
            const yOuter = center + maxRadius * Math.sin(p.angle);
            return (
              <line
                key={idx}
                x1={center}
                y1={center}
                x2={xOuter}
                y2={yOuter}
                stroke="#181818"
                strokeWidth="1"
              />
            );
          })}

          {/* Golden Spending Area Polygon */}
          {points.length >= 3 && (
            <polygon
              points={polygonPath}
              className="fill-[#d4af37]/20 stroke-[#d4af37] stroke-2 transition-all duration-500"
            />
          )}

          {/* Interaction Data Node circles */}
          {points.map((p, idx) => (
            <circle
              key={idx}
              cx={p.x}
              cy={p.y}
              r="3"
              className="fill-[#050505] stroke-[#d4af37] stroke-[1.5]"
              title={`${p.category}: ₹${p.spent}`}
            />
          ))}

          {/* Radial Text Labels */}
          {points.map((p, idx) => {
            const labelRadius = maxRadius + 14;
            const xLabel = center + labelRadius * Math.cos(p.angle);
            const yLabel = center + labelRadius * Math.sin(p.angle);
            const shortName = p.category.split(' ')[0].substring(0, 5);

            return (
              <text
                key={idx}
                x={xLabel}
                y={yLabel}
                fill="#888"
                fontSize="7.5"
                textAnchor="middle"
                dominantBaseline="central"
                className="font-mono bg-[#050505] px-1 text-[7px]"
              >
                {shortName}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

// Custom lightweight SVG Bullet Chart for linear comparison against macro targets
const BulletChart = ({ spent, limit }: { spent: number; limit: number }) => {
  const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;

  return (
    <div className="bg-[#0d0d0d] rounded-2xl border border-[#1a1a1a] p-4 font-mono">
      <div className="flex items-center gap-1.5 mb-2 border-b border-[#141414] pb-1.5">
        <span className="text-[#d4af37] text-xs">▩</span>
        <h4 className="text-[10px] uppercase tracking-wider text-[#d4af37] font-semibold">Macro Spend performance (Bullet)</h4>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between text-[9px] text-gray-500">
          <span>Spent: <strong className="text-white">₹{spent.toLocaleString('en-IN')}</strong></span>
          <span>Budget: <strong className="text-white">₹{limit.toLocaleString('en-IN')}</strong></span>
        </div>

        {/* The Bullet Gauge */}
        <div className="relative h-5.5 bg-[#121212] rounded border border-[#222] overflow-hidden flex">
          {/* Shaded Ranges representing Performance Bands */}
          <div className="w-[60%] h-full bg-[#0a0a0a] border-r border-[#222]/20" title="Good (0-60%)" />
          <div className="w-[30%] h-full bg-[#141414] border-r border-[#222]/20" title="Caution (60-90%)" />
          <div className="w-[10%] h-full bg-[#1b0000]" title="Critical Budget Threshold (90-100%+)" />

          {/* Actual value bar overlay */}
          <div 
            className="absolute left-0 top-1.5 h-2.5 bg-gradient-to-r from-yellow-700 to-[#d4af37] rounded-r transition-all duration-500 shadow-md"
            style={{ width: `${Math.min(100, percent)}%` }}
          />

          {/* Target Milestone Indicator Key Line */}
          <div 
            className="absolute h-full w-1 bg-[#d4af37] top-0 shadow"
            style={{ left: `calc(${Math.min(100, percent)}% - 2px)` }}
          />
        </div>

        {/* Dynamic Warning messaging inline within phone */}
        <div className="flex justify-between items-center text-[8px] text-gray-500">
          <span>Target Progress</span>
          <span className={percent >= 90 ? 'text-rose-400 font-bold animate-pulse' : percent >= 65 ? 'text-yellow-500' : 'text-emerald-500'}>
            {percent}% Allocated {percent >= 100 ? '[!] Excess!' : ''}
          </span>
        </div>
      </div>
    </div>
  );
};

export default function App() {
  // Database Persistence with local storage integration
  const [transactions, setTransactions] = useState<Transaction[]>(() => {
    const saved = localStorage.getItem('aurelius_transactions');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return HISTORICAL_TRANSACTIONS;
      }
    }
    return HISTORICAL_TRANSACTIONS;
  });

  // Track user-added custom SMS templates or lists
  const [smsMessages, setSmsMessages] = useState<SmsMessage[]>(() => {
    const saved = localStorage.getItem('aurelius_sms');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  // Category list definitions
  const [categories, setCategories] = useState<string[]>(() => {
    const saved = localStorage.getItem('aurelius_categories');
    if (saved) return JSON.parse(saved);
    return [
      'Income',
      'Rent & Utilities',
      'Transport',
      'Grocery & Essentials',
      'Food & Beverages',
      'Gift',
      'Movie/Outing',
      'Clothing & Accessories',
      'Health',
      'Development'
    ];
  });

  const [categoryIcons, setCategoryIcons] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('aurelius_category_icons');
    if (saved) return JSON.parse(saved);
    return {
      'Income': '💰',
      'Rent & Utilities': '💡',
      'Transport': '🚗',
      'Grocery & Essentials': '🛒',
      'Food & Beverages': '🍔',
      'Gift': '🎁',
      'Movie/Outing': '🎬',
      'Clothing & Accessories': '👕',
      'Health': '💊',
      'Development': '💻'
    };
  });

  const saveNewCategory = (name: string, icon: string) => {
    const newCats = [...categories, name];
    const newIcons = { ...categoryIcons, [name]: icon || '⭐' };
    setCategories(newCats);
    setCategoryIcons(newIcons);
    localStorage.setItem('aurelius_categories', JSON.stringify(newCats));
    localStorage.setItem('aurelius_category_icons', JSON.stringify(newIcons));
  };


  const [showNewCategoryModal, setShowNewCategoryModal] = useState(false);
  const [showManageCategoriesModal, setShowManageCategoriesModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryIcon, setNewCategoryIcon] = useState('[?]️');

  const handleDeleteCategory = (catToDelete: string) => {
    if (catToDelete === 'Income') {
      alert("Core category 'Income' cannot be deleted.");
      return;
    }

    const hasTransactions = transactions.some(t => t.category === catToDelete);
    if (hasTransactions) {
      if (window.confirm(`"${catToDelete}" has transactions. To delete it, they will be marked as "Uncategorized". Proceed?`)) {
        // Ensure "Uncategorized" exists as a fallback category
        if (!categories.includes('Uncategorized')) {
          saveNewCategory('Uncategorized', '[+]');
        }
        setTransactions(prev => prev.map(t => t.category === catToDelete ? { ...t, category: 'Uncategorized' } : t));
        removeCategorySilently(catToDelete);
      }
    } else {
      if (window.confirm(`Are you sure you want to delete the category "${catToDelete}"?`)) {
        removeCategorySilently(catToDelete);
      }
    }
  };

  const removeCategorySilently = (catToDelete: string) => {
    const newCats = categories.filter(c => c !== catToDelete);
    setCategories(newCats);
    localStorage.setItem('aurelius_categories', JSON.stringify(newCats));
    
    // Check if it was selected in form
    if (formCategory === catToDelete) {
      setFormCategory(newCats[0] || '');
    }
    // Also remove any budgets associated with it
    setBudgets(prev => {
      const updated = prev.filter(b => b.category !== catToDelete);
      localStorage.setItem('aurelius_budgets', JSON.stringify(updated));
      return updated;
    });
  };

  // Pre-seed category budget limits
  const [budgets, setBudgets] = useState<BudgetLimit[]>(() => {
    const saved = localStorage.getItem('aurelius_budgets');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return [];
      }
    }
    // Seed budgets for both April-2026 and May-2026 to ensure calculations work out of the box
    return [
      { category: 'Rent & Utilities', limit: 30000, month: 'Apr-2026' },
      { category: 'Food & Beverages', limit: 12000, month: 'Apr-2026' },
      { category: 'Transport', limit: 5000, month: 'Apr-2026' },
      { category: 'Grocery & Essentials', limit: 6000, month: 'Apr-2026' },
      { category: 'Movie/Outing', limit: 3000, month: 'Apr-2026' },
      { category: 'Development', limit: 2000, month: 'Apr-2026' },

      { category: 'Rent & Utilities', limit: 30000, month: 'May-2026' },
      { category: 'Food & Beverages', limit: 10000, month: 'May-2026' },
      { category: 'Transport', limit: 4000, month: 'May-2026' },
      { category: 'Grocery & Essentials', limit: 5000, month: 'May-2026' },
      { category: 'Movie/Outing', limit: 2000, month: 'May-2026' },
      { category: 'Development', limit: 1500, month: 'May-2026' }
    ];
  });

  // UI Navigation states
  // Pages: 'dashboard' | 'sms' | 'add' | 'budgets' | 'history' | 'settings'
  const [navTab, setNavTab] = useState<'dashboard' | 'sms' | 'add' | 'budgets' | 'history' | 'settings'>(
    () => {
      if (typeof window !== 'undefined' && (window as Window).__initialTab === 'sms') return 'sms';
      return 'dashboard';
    }
  );

  // Onboarding: show permission request screen on first launch
  const [showOnboarding, setShowOnboarding] = useState<boolean>(() => {
    return !localStorage.getItem('ft_onboarded');
  });
  const [notifPermission, setNotifPermission] = useState<string>(() => {
    if (typeof Notification !== 'undefined') return Notification.permission;
    return 'unavailable';
  });

  // Sub-navigation on mobile dashboard (either transaction lists or monthly budget limits list)
  const [dashboardView, setDashboardView] = useState<'transactions' | 'budgets'>('transactions');
  const [isFiltersExpanded, setIsFiltersExpanded] = useState(false);
  const [geminiKey, setGeminiKeyState] = useState<string>(() => localStorage.getItem(GEMINI_API_KEY_STORAGE) || '');
  const [geminiKeySaved, setGeminiKeySaved] = useState(false);
  // History tab filters
  const [historyFilterCategory, setHistoryFilterCategory] = useState('All');
  const [historyFilterType, setHistoryFilterType] = useState('All');
  const [historyStartDate, setHistoryStartDate] = useState('');
  const [historyEndDate, setHistoryEndDate] = useState('');

  // Budgets configuration inputs (custom dropdown states instead of JS prompt)
  const [budgetMonth, setBudgetMonth] = useState('May-2026');
  const [budgetCategory, setBudgetCategory] = useState('Food & Beverages');
  const [budgetAmountInput, setBudgetAmountInput] = useState('');

  // New manual entry inputs
  const [formDate, setFormDate] = useState(new Date().toISOString().substring(0, 10));
  const [formCategory, setFormCategory] = useState('Food & Beverages');
  const [formDescription, setFormDescription] = useState('');
  const [formAmount, setFormAmount] = useState('');
  const [formType, setFormType] = useState<'income' | 'expense'>('expense');

  // Filter conditions
  const [filterCategory, setFilterCategory] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterMonth, setFilterMonth] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  // Date range filters
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [recentDateFilter, setRecentDateFilter] = useState('All');

  // Notification overlays for simulated SMS
  const [incomingSmsBanner, setIncomingSmsBanner] = useState<SmsMessage | null>(null);
  
  // Real-time Extraction Pop-up / Wizard Details
  const [parseWizard, setParseWizard] = useState<{
    smsText: string;
    amount: number;
    type: 'income' | 'expense';
    merchant: string;
    bankName: string;
    proposedCategory: string;
    description: string;
    originalSmsId?: string;
  } | null>(null);

  // SMS Generator Inputs (The simulator controls)
  const [customSmsText, setCustomSmsText] = useState('₹350 spent at Ravi Store using HDFC Bank');
  const [isSmsParsing, setIsSmsParsing] = useState(false);

  // AI Summary stats & Neural insights text compiled by server-side Gemini 3.5 Flash
  const [aiInsights, setAiInsights] = useState<string[]>([
    "[+] Income is preloaded with ₹53,195 from actual April & May sheets. Available balance is fully updated.",
    "[i] Tip: Food & Beverages is your highest category! Tap 'Smart AI Advisor' above to formulate custom budgets.",
    "[!] Rent & Utilities makes up over 35% of your total expenditure.",
    "[m] Automatic SMS parser detects bank SMS triggers (credited/debited) in real-time."
  ]);
  const [isAiInsightsLoading, setIsAiInsightsLoading] = useState(false);

  // Synchronization with LocalStorage
  useEffect(() => {
    localStorage.setItem('aurelius_transactions', JSON.stringify(transactions));
  }, [transactions]);

  useEffect(() => {
    localStorage.setItem('aurelius_sms', JSON.stringify(smsMessages));
  }, [smsMessages]);

  useEffect(() => {
    localStorage.setItem('aurelius_budgets', JSON.stringify(budgets));
  }, [budgets]);

  // ── SW message listener: notification tap opens SMS tab ─────────────────
  useEffect(() => {
    // Register global handler for SW → App message
    (window as Window).__openSmsTab = (smsId?: string) => {
      setNavTab('sms');
      if (smsId) console.log('[App] Opening SMS tab for id:', smsId);
    };
    return () => { delete (window as Window).__openSmsTab; };
  }, []);

  // ── SMS auto-expiry: confirmed→3 days, skipped→10 days ──────────────────
  useEffect(() => {
    const now = Date.now();
    setSmsMessages(prev => prev.filter(sms => {
      const age = now - new Date(sms.timestamp).getTime();
      const days = age / (1000 * 60 * 60 * 24);
      if (sms.status === 'confirmed' && days > 3) return false;
      if (sms.status === 'skipped' && days > 10) return false;
      return true;
    }));
  }, []);

  // ── Android native bridge: poll for SMS detected while app was closed ────
  useEffect(() => {
    const pollAndroidSms = () => {
      if (!window.AndroidBridge) return;
      try {
        const raw = window.AndroidBridge.getPendingSms();
        const records: SmsMessage[] = JSON.parse(raw);
        if (!records || records.length === 0) return;

        console.log('[Android] Got', records.length, 'pending SMS records');

        setSmsMessages(prev => {
          // Avoid duplicates by id
          const existingIds = new Set(prev.map(s => s.id));
          const newOnes = records.filter(r => !existingIds.has(r.id));
          if (newOnes.length === 0) return prev;
          return [...newOnes, ...prev];  // newest first
        });

        // Navigate to SMS tab so user sees the new records
        setNavTab('sms');
      } catch (e) {
        console.error('[Android] Bridge error:', e);
      }
    };

    // Poll immediately on mount
    pollAndroidSms();

    // Poll again when app comes back to foreground (user switches back to app)
    const handleFocus = () => pollAndroidSms();
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') pollAndroidSms();
    });

    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  // ── Helper: show notification via Service Worker ─────────────────────────
  const showSmsNotification = (amount: number, merchant: string, txType: 'income' | 'expense', smsId: string) => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'SHOW_SMS_NOTIFICATION',
        amount, merchant, txType, smsId
      });
    } else if ('Notification' in window && Notification.permission === 'granted') {
      // Fallback to direct Notification API
      const sign = txType === 'income' ? '+' : '-';
      const n = new Notification('New Transaction Detected', {
        body: `${sign}Rs.${amount} — ${merchant}\nTap to categorize.`,
        icon: '/icons/icon-192x192.png',
        tag: 'finance-sms-' + smsId,
        requireInteraction: true,
      });
      n.onclick = () => { window.focus(); setNavTab('sms'); n.close(); };
    }
  };

  // Months lists
  const availableMonths = useMemo(() => {
    const list = new Set<string>();
    transactions.forEach(t => {
      // Parse YYYY-MM-DD to Month-YYYY label
      if (t.date) {
        const parts = t.date.split('-');
        if (parts.length >= 2) {
          const year = parts[0];
          const monthNum = parseInt(parts[1], 10);
          const monthNames = [
            'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
            'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
          ];
          const name = `${monthNames[monthNum - 1]}-${year}`;
          list.add(name);
        }
      }
    });
    // Add default options if empty or matching user spreadsheet logs
    list.add('Apr-2026');
    list.add('May-2026');
    return Array.from(list);
  }, [transactions]);

  // Filtered transactions for viewing & calculations
  const filteredTransactions = useMemo(() => {
    return transactions.filter(t => {
      // 1. Search filter
      const textMatch = 
        t.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.category.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (t.bankName || '').toLowerCase().includes(searchQuery.toLowerCase());

      // Category filter
      const catMatch = filterCategory === 'All' || t.category === filterCategory;

      // 3. Type filter
      const typeMatch = 
        filterType === 'All' || 
        (filterType === 'Income' && t.type === 'income') || 
        (filterType === 'Expense' && t.type === 'expense');

      // 4. Custom Month helper filter
      // Mapping Apr-2026 to "2026-04" or similar
      let monthMatch = true;
      if (filterMonth !== 'All') {
        const monthsMap: Record<string, string> = {
          'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04', 'May': '05', 'Jun': '06',
          'Jul': '07', 'Aug': '08', 'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        const [mName, yName] = filterMonth.split('-');
        const monthCode = monthsMap[mName];
        if (monthCode && yName) {
          monthMatch = t.date.startsWith(`${yName}-${monthCode}`);
        }
      }

      // 5. Date Range Matcher
      let rangeMatch = true;
      if (startDate) {
        rangeMatch = rangeMatch && t.date >= startDate;
      }
      if (endDate) {
        rangeMatch = rangeMatch && t.date <= endDate;
      }

      // 6. Recent Date Filter
      let recentDateMatch = true;
      if (recentDateFilter !== 'All') {
        const today = new Date();
        const txDate = new Date(t.date);
        if (recentDateFilter === 'This Month') {
          recentDateMatch = txDate.getMonth() === today.getMonth() && txDate.getFullYear() === today.getFullYear();
        } else if (recentDateFilter === 'Last Month') {
          const lastMonth = today.getMonth() === 0 ? 11 : today.getMonth() - 1;
          const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
          recentDateMatch = txDate.getMonth() === lastMonth && txDate.getFullYear() === year;
        } else if (recentDateFilter === 'Last 3 Months') {
          const threeMonthsAgo = new Date();
          threeMonthsAgo.setMonth(today.getMonth() - 2); // To include this month and the 2 previous
          threeMonthsAgo.setDate(1); // from start of that month
          recentDateMatch = txDate >= threeMonthsAgo;
        }
      }

      return textMatch && catMatch && typeMatch && monthMatch && rangeMatch && recentDateMatch;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [transactions, searchQuery, filterCategory, filterType, filterMonth, startDate, endDate, recentDateFilter]);

  // Analytics of income, expense, and savings based on current filtered selection (or overall month status)
  const currentMonthTotals = useMemo(() => {
    let income = 0;
    let expense = 0;

    filteredTransactions.forEach(t => {
      if (t.type === 'income') {
        income += t.amount;
      } else {
        expense += t.amount;
      }
    });

    const savings = income - expense;
    const savingsPercent = income > 0 ? Math.max(0, Math.min(100, Math.round((savings / income) * 100))) : 0;

    return { income, expense, savings, savingsPercent };
  }, [filteredTransactions]);

  // Overall available liquidity based on EVERY single logged transaction starting from initial balances
  const cumulativeLiquidity = useMemo(() => {
    let balance = 0;
    // Calculate sequentially chronologically to reflect the accurate current balance
    const chronologically = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    chronologically.forEach(t => {
      if (t.type === 'income') {
        balance += t.amount;
      } else {
        balance -= t.amount;
      }
    });
    return balance;
  }, [transactions]);

  // Category wise spending representation for filtered selection
  const categorySpendingList = useMemo(() => {
    const map: Record<string, number> = {};
    let totalExpense = 0;

    filteredTransactions.forEach(t => {
      if (t.type === 'expense') {
        map[t.category] = (map[t.category] || 0) + t.amount;
        totalExpense += t.amount;
      }
    });

    return Object.entries(map).map(([category, amount]) => {
      const percentage = totalExpense > 0 ? Math.round((amount / totalExpense) * 100) : 0;
      return { category, amount, percentage };
    }).sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions]);

  // Category spending pattern parser
  const weeklySpendingTrend = useMemo(() => {
    // Break currently filtered expenses down to 4 relative weeks
    const weeks = [
      { name: 'Week 1', amount: 0 },
      { name: 'Week 2', amount: 0 },
      { name: 'Week 3', amount: 0 },
      { name: 'Week 4', amount: 0 }
    ];

    filteredTransactions.forEach(t => {
      if (t.type === 'expense' && t.date) {
        const parts = t.date.split('-');
        if (parts.length >= 3) {
          const day = parseInt(parts[2], 10);
          if (day <= 7) weeks[0].amount += t.amount;
          else if (day <= 14) weeks[1].amount += t.amount;
          else if (day <= 21) weeks[2].amount += t.amount;
          else weeks[3].amount += t.amount;
        }
      }
    });

    const maxAmt = Math.max(...weeks.map(w => w.amount), 1);
    return weeks.map(w => ({
      ...w,
      percentHeight: Math.round((w.amount / maxAmt) * 100)
    }));
  }, [filteredTransactions]);

  // Comparison totals for April-2026 vs May-2026 for graph visualization
  const monthComparisonStats = useMemo(() => {
    const aprilStats = { income: 0, expense: 0 };
    const mayStats = { income: 0, expense: 0 };

    transactions.forEach(t => {
      if (t.date.startsWith('2026-04')) {
        if (t.type === 'income') aprilStats.income += t.amount;
        else aprilStats.expense += t.amount;
      } else if (t.date.startsWith('2026-05')) {
        if (t.type === 'income') mayStats.income += t.amount;
        else mayStats.expense += t.amount;
      }
    });

    const maxVal = Math.max(aprilStats.expense, mayStats.expense, 1);
    return {
      april: {
        ...aprilStats,
        expensePercent: Math.round((aprilStats.expense / maxVal) * 100)
      },
      may: {
        ...mayStats,
        expensePercent: Math.round((mayStats.expense / maxVal) * 100)
      }
    };
  }, [transactions]);

  // Trigger Automatic API Parsing for bank SMS
  const handleIncomingSmsTrigger = async (targetText: string) => {
    setIsSmsParsing(true);
    try {
      const smsSchema = { type: 'object', properties: { amount: { type: 'number' }, type: { type: 'string' }, merchant: { type: 'string' }, bankName: { type: 'string' }, proposedCategory: { type: 'string' } } };
      const smsPrompt = `Parse this Indian bank SMS. SMS: "${targetText}". Return JSON: amount (number), type (income or expense), merchant, bankName, proposedCategory (Food & Dining/Transport/Shopping/Entertainment/Healthcare/Education/Utilities/Salary/Freelance/Investment/Grocery & Essentials/Others).`;
      let info: Record<string, unknown> = {};
      try {
        info = JSON.parse(await callGeminiDirect(smsPrompt, smsSchema));
      } catch {
        // Fallback: use smart local parser that understands HDFC / UPI formats
        const local = parseSmartLocal(targetText);
        info = { amount: local.amount, type: local.type, merchant: local.merchant, bankName: local.bankName, proposedCategory: local.proposedCategory };
      }
      console.log('Successfully processed SMS payload:', info);

      // STEP: Learning algorithm - Suggest category based on past transactions
      let proposedCat = info.proposedCategory || 'Grocery & Essentials';
      const recentTx = transactions.find(t => t.merchant?.toLowerCase() === info.merchant?.toLowerCase());
      if (recentTx && recentTx.category) {
        proposedCat = recentTx.category;
      }

      // Create new system SMS in state
      const newSms: SmsMessage = {
        id: 'sms-' + Date.now(),
        sender: info.bankName || 'BANK-SMS',
        text: targetText,
        timestamp: new Date().toISOString(),
        status: 'pending',
        parsedAmount: info.amount || 0,
        parsedType: info.type || 'expense',
        parsedMerchant: info.merchant || 'Unknown Merchant',
        parsedBank: info.bankName || 'Bank',
      };

      setSmsMessages(prev => [newSms, ...prev]);
      
      // Simulate Android banner overlay popup
      setIncomingSmsBanner(newSms);
      
      // Prepare the wizard modal automatically inside the emulator app
      setParseWizard({
        smsText: targetText,
        amount: info.amount || 0,
        type: info.type || 'expense',
        merchant: info.merchant || 'Merchant',
        bankName: info.bankName || 'Bank',
        proposedCategory: proposedCat,
        description: '', // Leave description completely empty as requested so user types it manually
        originalSmsId: newSms.id
      });

      // Fire notification via Service Worker (works even when app is backgrounded)
      showSmsNotification(
        Number(info.amount) || 0,
        String(info.merchant || 'Bank'),
        (info.type as 'income' | 'expense') || 'expense',
        newSms.id
      );

      // Navigate to SMS tab so user sees it immediately
      setNavTab('sms');

    } catch (error) {
      console.error('Failed parsing banking SMS via fullstack route:', error);
      // Heuristic manual parse fallback if request failed
      const mockId = 'sms-fail-' + Date.now();
      const newSms: SmsMessage = {
        id: mockId,
        sender: 'VERIFIED-BK',
        text: targetText,
        timestamp: new Date().toISOString(),
        status: 'pending',
        parsedAmount: 450,
        parsedType: 'expense',
        parsedMerchant: 'Store Provider',
        parsedBank: 'Bank',
      };
      setSmsMessages(prev => [newSms, ...prev]);
      setIncomingSmsBanner(newSms);
      setParseWizard({
        smsText: targetText,
        amount: 450,
        type: 'expense',
        merchant: 'Unparsed Merchant',
        bankName: 'HDFC Bank',
        proposedCategory: 'Grocery & Essentials',
        description: '', // Leave description empty so user can fill manually
        originalSmsId: mockId
      });
      setNavTab('sms');
    } finally {
      setIsSmsParsing(false);
    }
  };

  // User saves transaction verified from the SMS extraction tool
  const saveTransactionFromSmsWizard = () => {
    if (!parseWizard) return;

    const newTx: Transaction = {
      id: 'tx-' + Date.now(),
      date: new Date().toISOString().substring(0, 10), // Current date for live tracking
      category: parseWizard.proposedCategory,
      description: parseWizard.description.trim() || 'SMS Transaction', // Taken completely from what the user input
      amount: parseWizard.amount,
      type: parseWizard.type,
      isSmsDetected: true,
      entryMode: 'auto' // Explicitly mark as auto entry
    };

    setTransactions(prev => [newTx, ...prev]);

    // Update status of compiled SMS to applied
    if (parseWizard.originalSmsId) {
      setSmsMessages(prev => 
        prev.map(sms => sms.id === parseWizard.originalSmsId ? { ...sms, status: 'confirmed' } : sms)
      );
    }

    setParseWizard(null);
    setNavTab('dashboard');

    // Smooth scroll inside notification if needed
    alert('[ok] Transaction saved from Bank Notification successfully!');
  };

  // Retrieve Intelligent Insights using server-side Gemini or offline fallback
  const fetchLiveAiInsights = async () => {
    setIsAiInsightsLoading(true);
    try {
      try {
        const insightPrompt = `Finance AI: give 4 concise actionable insights (each under 80 chars) as JSON array of strings. Data: ${JSON.stringify(transactions.slice(-30).map(t => ({ date: t.date, category: t.category, amount: t.amount, type: t.type })))}`;
        const text = await callGeminiDirect(insightPrompt, { type: 'array', items: { type: 'string' } });
        const insights = JSON.parse(text);
        if (Array.isArray(insights)) setAiInsights(insights);
      } catch { /* fallback */ }
    } catch (error) {
      console.error('Failed to query Gemini Insights server route, fallback applied:', error);
      // Offline fallback triggers naturally inside UI
    } finally {
      setIsAiInsightsLoading(false);
    }
  };

  // Quick action presets for instant testing
  const PRESET_SMS_SAMPLES = [
    { label: 'Credit Rs.3000 - UPI received', text: 'Rs.3000.00 credited to HDFC Bank A/c XX7038 on 17-05-25 from VPA 9585064391@axl (UPI 928607196682)' },
    { label: 'Debit Rs.32 - Rapido ride', text: 'Sent Rs.32.00 From HDFC Bank A/C *7038 To Rapido On 09/05/25 Ref 104546884418' },
    { label: 'Debit Rs.350 - Ravi Store', text: 'Rs.350.00 debited from HDFC Bank A/c XX7038 at RAVI STORE on 15-05-25 (UPI 987654321)' },
    { label: 'Credit Rs.17035 - Salary', text: 'Rs.17035.00 credited to HDFC Bank A/c XX7038 on 01-05-25. Ref: SALARY MAY 2025' },
    { label: 'Debit Rs.1200 - Rent transfer', text: 'Sent Rs.1200.00 From HDFC Bank A/C *7038 To LANDLORD On 05/05/25 Ref 200001234567' }
  ];

  // Excel Style Column Exporter matching: Date, Category, Description, Amount In, Amount Out, Balance, Month, Entry Mode
  const handleExportToExcelStyleCsv = () => {
    // Generate accurate data representation conforming directly to user's original spreadsheet
    let csvContent = "Date,Category,Description,Amount In,Amount Out,Balance,Month,Entry Mode\n";
    
    let runningBalance = 0;
    // Walk through chronologically to construct accurate balance tracking column
    const sortedChrono = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
    
    const rows = sortedChrono.map(t => {
      if (t.type === 'income') {
        runningBalance += t.amount;
      } else {
        runningBalance -= t.amount;
      }

      const amountInString = t.type === 'income' ? `"${t.amount}"` : '';
      const amountOutString = t.type === 'expense' ? `"${t.amount}"` : '';
      
      // Determine Month String like April-2026
      const dParts = t.date.split('-');
      let monthLabel = '';
      if (dParts.length >= 2) {
        const year = dParts[0];
        const mIndex = parseInt(dParts[1], 10) - 1;
        const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        monthLabel = `${names[mIndex] || 'Month'}-${year}`;
      }

      // Escape commas in description
      const escapedDesc = t.description ? `${t.description.replace(/"/g, '""')}` : '';
      const entryModeString = t.entryMode || (t.isSmsDetected ? 'auto' : 'manual');

      return `${t.date},${t.category},"${escapedDesc}",${amountInString},${amountOutString},"${runningBalance}",${monthLabel},${entryModeString}`;
    });

    csvContent += rows.join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `aurelius_finance_export_${new Date().toISOString().substring(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Restore seeded data and erase localStorage state
  const handleRestoreDefaultSeed = () => {
    if (window.confirm('Are you sure you want to reset simulated records back to original April-May 2026 spreadsheet data? This overrides custom listings.')) {
      localStorage.removeItem('aurelius_transactions');
      localStorage.removeItem('aurelius_sms');
      localStorage.removeItem('aurelius_budgets');
      setTransactions(HISTORICAL_TRANSACTIONS);
      setSmsMessages([]);
      setNavTab('dashboard');
      alert('Preloaded seeded logs imported successfully!');
    }
  };

  // Add individual manual record
  const handleAddNewManualEntry = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(formAmount);
    if (!val || isNaN(val) || val <= 0) {
      alert('Please enter a valid amount.');
      return;
    }

    const newTx: Transaction = {
      id: 'tx-manual-' + Date.now(),
      date: formDate,
      category: formCategory,
      description: formDescription.trim() || 'Manual Record',
      amount: val,
      type: formType,
      isSmsDetected: false,
      entryMode: 'manual'
    };

    setTransactions(prev => [newTx, ...prev]);
    setFormAmount('');
    setFormDescription('');
    setNavTab('dashboard');
    alert('[ok] Entry saved successfully!');
  };

  // Delete an individual logged item
  const handleDeleteTransaction = (id: string) => {
    if (window.confirm('Are you sure you want to delete this entry?')) {
      setTransactions(prev => prev.filter(t => t.id !== id));
    }
  };

  // Filter shortcuts
  const selectQuickMonthFilter = (mCode: string) => {
    setFilterMonth(mCode);
  };

  return (
    <div className="h-screen w-screen bg-[#050505] text-[#e5e5e5] flex flex-col overflow-hidden font-sans">

      {/* ── ONBOARDING SCREEN ─────────────────────────────────────────── */}
      {showOnboarding && (
        <div className="absolute inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 rounded-full overflow-hidden mb-6 shadow-2xl border-2 border-[#d4af37]/40">
            <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <circle cx="50" cy="50" r="50" fill="#1a1208"/>
              <circle cx="50" cy="50" r="46" fill="none" stroke="#d4af37" strokeWidth="2"/>
              <circle cx="50" cy="50" r="42" fill="#2a1e0a"/>
              <rect x="35" y="35" width="30" height="30" fill="#0a0a0a" stroke="#d4af37" strokeWidth="1.5"/>
              <text x="50" y="32" textAnchor="middle" fill="#d4af37" fontSize="10" fontWeight="bold">芽</text>
              <text x="28" y="55" textAnchor="middle" fill="#d4af37" fontSize="10" fontWeight="bold">祥</text>
              <text x="72" y="55" textAnchor="middle" fill="#d4af37" fontSize="10" fontWeight="bold">道</text>
              <text x="50" y="76" textAnchor="middle" fill="#d4af37" fontSize="10" fontWeight="bold">机</text>
            </svg>
          </div>
          <h1 className="text-2xl font-serif text-white mb-2">Finance Tracker</h1>
          <p className="text-gray-400 text-sm mb-8 leading-relaxed max-w-xs">
            Automatically detects bank SMS and UPI transactions. Enable notifications so you never miss a transaction.
          </p>

          <div className="w-full max-w-xs space-y-3 mb-6">
            <div className="flex items-start gap-3 text-left bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-3">
              <span className="text-lg mt-0.5">🔔</span>
              <div>
                <p className="text-white text-xs font-semibold">Notification Access</p>
                <p className="text-gray-500 text-[10px] mt-0.5">Detects bank SMS alerts automatically</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-left bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-3">
              <span className="text-lg mt-0.5">💳</span>
              <div>
                <p className="text-white text-xs font-semibold">Auto Categorization</p>
                <p className="text-gray-500 text-[10px] mt-0.5">Parses amount, merchant, and type instantly</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-left bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-3">
              <span className="text-lg mt-0.5">📊</span>
              <div>
                <p className="text-white text-xs font-semibold">Budget Tracking</p>
                <p className="text-gray-500 text-[10px] mt-0.5">Alerts when you approach spending limits</p>
              </div>
            </div>
          </div>

          {notifPermission === 'granted' ? (
            <div className="w-full max-w-xs">
              <p className="text-emerald-400 text-xs mb-4 font-mono">Notifications enabled</p>
              <button
                onClick={() => { localStorage.setItem('ft_onboarded', '1'); setShowOnboarding(false); }}
                className="w-full bg-[#d4af37] text-black font-bold py-3.5 rounded-2xl text-sm tracking-wide"
              >
                Get Started
              </button>
            </div>
          ) : (
            <div className="w-full max-w-xs space-y-3">
              <button
                onClick={async () => {
                  if ('Notification' in window) {
                    const perm = await Notification.requestPermission();
                    setNotifPermission(perm);
                    if (perm === 'granted') {
                      // Also subscribe to SW push if available
                      if ('serviceWorker' in navigator) {
                        const reg = await navigator.serviceWorker.ready;
                        console.log('[SW] Ready:', reg.scope);
                      }
                    }
                  }
                  localStorage.setItem('ft_onboarded', '1');
                  setShowOnboarding(false);
                }}
                className="w-full bg-[#d4af37] text-black font-bold py-3.5 rounded-2xl text-sm tracking-wide"
              >
                Enable Notifications
              </button>
              <button
                onClick={() => { localStorage.setItem('ft_onboarded', '1'); setShowOnboarding(false); }}
                className="w-full text-gray-500 text-xs py-2"
              >
                Skip for now
              </button>
            </div>
          )}

          <p className="text-gray-700 text-[10px] mt-6 max-w-xs leading-relaxed">
            Note: For automatic SMS reading, Android requires this app to be installed as a native APK and granted SMS/Notification Listener permission in device settings.
          </p>
        </div>
      )}

          {/* Simulated App Banner Alert for push notifications */}
    {incomingSmsBanner && (
      <div className="w-full max-w-[420px] bg-[#0c0c0c] border border-yellow-950/40 rounded-xl p-4 mb-4 shadow-2xl relative animate-bounce flex gap-3.5">
        <div className="h-10 w-10 shrink-0 bg-yellow-950/30 border border-yellow-900/30 rounded-full flex items-center justify-center text-[#d4af37]">
          <Bell size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-center mb-1">
            <span className="text-xs font-mono font-medium text-yellow-500">Android System SMS Alert</span>
            <button 
              onClick={() => setIncomingSmsBanner(null)} 
              className="text-[10px] font-mono text-gray-600 hover:text-white"
            >
              Dismiss
            </button>
          </div>
          <p className="text-[11px] text-gray-300 truncate font-sans italic">"{incomingSmsBanner.text}"</p>
          <div className="mt-2 flex gap-3 text-[10px]">
            <button 
              onClick={() => {
                setIncomingSmsBanner(null);
                setNavTab('sms');
              }} 
              className="text-[#d4af37] font-semibold tracking-wider hover:underline"
            >
              OPEN AI WORKFLOW
            </button>
          </div>
        </div>
      </div>
    )}

      <div className="flex-1 flex flex-col overflow-hidden bg-[#050505]">

      {/* Top bar with settings button */}
      <div className="flex justify-between items-center px-4 pt-3 pb-1 shrink-0">
        <div className="flex items-center gap-2">
          <img src="/icons/icon-72x72.png" className="w-6 h-6 rounded-lg" alt="logo" />
          <span className="text-[11px] font-mono text-[#d4af37] font-semibold tracking-wide">Finance Tracker</span>
        </div>
        <button
          onClick={() => setNavTab('settings')}
          className={`p-1.5 rounded-xl transition-all ${navTab === 'settings' ? 'bg-[#d4af37]/20 text-[#d4af37]' : 'text-gray-500 hover:text-white'}`}
        >
          <Info size={18} />
        </button>
      </div>
    


    {/* Simulated Screen Content - Dynamic Tab View Rendering */}
    <div className="flex-1 overflow-y-auto px-4.5 py-4 custom-inner-screen">
      
      {/* IF POPUP SMS WIZARD ACTIVE, RENDER IT OVER CURRENT TAB VIEW */}
      {parseWizard ? (
        <div id="sms-parse-modal" className="bg-[#0a0a0a] border border-[#1a1a1a] rounded-2xl p-5 mb-4 shadow-2xl relative animate-fade-in border-l-4 border-l-[#d4af37]">
          
          <div className="flex justify-between items-start mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={16} className="text-[#d4af37]" />
              <span className="text-[10px] font-mono uppercase text-[#d4af37] tracking-wider">SMS Auto-Detection Result</span>
            </div>
            <button 
              onClick={() => setParseWizard(null)}
              className="text-gray-500 hover:text-white text-xs"
            >
              x Close
            </button>
          </div>

          <p className="text-xs text-gray-300 font-serif leading-relaxed mb-4 italic p-3 bg-[#111] rounded-xl border border-[#222]">
            "{parseWizard.smsText}"
          </p>

          <div className="space-y-3.5 mb-5 text-xs text-gray-400">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#121212] p-2.5 rounded-xl border border-[#1a1a1a]">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 block font-mono">Amount</span>
                <span className="text-sm font-semibold text-white">₹{parseWizard.amount}</span>
              </div>
              <div className="bg-[#121212] p-2.5 rounded-xl border border-[#1a1a1a]">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 block font-mono">Type</span>
                <span className={`text-[11px] font-semibold uppercase ${parseWizard.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {parseWizard.type}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-[#121212] p-2.5 rounded-xl border border-[#1a1a1a]">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 block font-mono">Merchant</span>
                <span className="text-xs text-white truncate block">{parseWizard.merchant}</span>
              </div>
              <div className="bg-[#121212] p-2.5 rounded-xl border border-[#1a1a1a]">
                <span className="text-[9px] uppercase tracking-wider text-gray-500 block font-mono">Source / Bank</span>
                <span className="text-xs text-white block">{parseWizard.bankName}</span>
              </div>
            </div>

            <div className="bg-[#121212] p-3 rounded-xl border border-[#1a1a1a] flex flex-col gap-2">
              <label className="text-[9px] uppercase tracking-wider text-[#d4af37] font-mono block">Confirm Category:</label>
              <div className="relative">
                <select
                  value={parseWizard.proposedCategory}
                  onChange={(e) => setParseWizard({ ...parseWizard, proposedCategory: e.target.value })}
                  className="w-full bg-[#050505] p-2 pr-8 rounded-lg text-xs font-mono text-[#e5e5e5] border border-[#222] focus:outline-none focus:border-[#d4af37] appearance-none cursor-pointer"
                >
                  {categories.map(c => (
                    <option key={c} value={c}>{categoryIcons[c]} {c}</option>
                  ))}
                </select>
                <ChevronDown size={14} className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-500 pointer-events-none" />
              </div>
            </div>

            <div className="bg-[#121212] p-3 rounded-xl border border-[#1a1a1a] flex flex-col gap-1.5">
              <label className="text-[9px] uppercase tracking-wider text-[#d4af37] font-mono block">Description Note:</label>
              <input
                type="text"
                value={parseWizard.description}
                onChange={(e) => setParseWizard({ ...parseWizard, description: e.target.value })}
                className="w-full bg-[#050505] p-2 rounded-lg text-xs text-[#e5e5e5] border border-[#222] focus:outline-none focus:border-[#d4af37]"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={saveTransactionFromSmsWizard}
              className="flex-1 bg-[#d4af37] text-black font-semibold text-xs py-2.5 px-3 rounded-xl hover:opacity-95 transition-all text-center uppercase tracking-wider font-mono shadow-md"
            >
              Confirm & Save
            </button>
            <button 
              onClick={() => setParseWizard(null)}
              className="px-4 py-2.5 border border-[#333] hover:border-gray-500 rounded-xl text-xs"
            >
              Skip
            </button>
          </div>
        </div>
      ) : null}


      {/* --- TAB 1: DASHBOARD --- */}
      {navTab === 'dashboard' && (() => {
        // Standard helper to resolve month key for transactions comparison
        const getTransactionMonthKey = (dateStr: string) => {
          const parts = dateStr.split('-');
          if (parts.length >= 2) {
            const year = parts[0];
            const mIndex = parseInt(parts[1], 10) - 1;
            const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            return `${names[mIndex] || 'Month'}-${year}`;
          }
          return '';
        };

        const activeMonthKey = filterMonth === 'All' ? 'May-2026' : filterMonth;

        // Budgets matched against actual spent for this specific month
        const monthBudgetsList = budgets
          .filter(b => (b.month || 'May-2026') === activeMonthKey)
          .map(b => {
            const spent = transactions
              .filter(t => t.type === 'expense' && t.category === b.category && getTransactionMonthKey(t.date) === activeMonthKey)
              .reduce((sum, current) => sum + current.amount, 0);
            return {
              category: b.category,
              limit: b.limit,
              month: activeMonthKey,
              spent
            };
          });

        // Macro spent aggregation for bullet chart
        const overallLimitSum = monthBudgetsList.reduce((sum, b) => sum + b.limit, 0);
        const overallSpentSum = monthBudgetsList.reduce((sum, b) => sum + b.spent, 0);

        return (
          <div className="space-y-4 animate-fade-in pt-4">
            
            {/* Header bar within app */}
            <div className="flex justify-between items-end border-b border-[#1c1c1c] pb-3">
              <div className="flex flex-col">
                <span className="text-[8px] text-[#d4af37] font-mono tracking-widest uppercase font-bold">Ledger Overview</span>
                <h2 className="font-serif text-base text-white tracking-wide">Dashboard</h2>
              </div>
            </div>

            {/* Sub-tab navigation selector: Transactions vs Budgets view */}
            <div className="grid grid-cols-2 gap-1.5 bg-[#0a0a0a] p-1 rounded-xl border border-[#181818]">
              <button
                onClick={() => setDashboardView('transactions')}
                className={`py-1.5 text-[10px] font-semibold rounded-lg transition-all font-mono uppercase tracking-wider flex items-center justify-center gap-1 border ${
                  dashboardView === 'transactions'
                    ? 'bg-[#151515] text-[#d4af37] border-[#d4af37]/20 shadow-md'
                    : 'text-gray-500 border-transparent hover:text-gray-300'
                }`}
              >
                Recent Activity
              </button>
              <button
                onClick={() => setDashboardView('budgets')}
                className={`py-1.5 text-[10px] font-semibold rounded-lg transition-all font-mono uppercase tracking-wider flex items-center justify-center gap-1 border ${
                  dashboardView === 'budgets'
                    ? 'bg-[#151515] text-[#d4af37] border-[#d4af37]/20 shadow-md'
                    : 'text-gray-500 border-transparent hover:text-gray-300'
                }`}
              >
                Smart Alerts
              </button>
            </div>

            {/* Quick statistical aggregate blocks */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-[#0b0b0b] border border-[#1a1a1a] rounded-xl p-3 flex flex-col justify-between h-18">
                <div className="flex items-center gap-1 text-gray-500">
                  <TrendingUp size={11} className="text-emerald-400" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">Inflow</span>
                </div>
                <p className="text-sm font-semibold text-emerald-400 font-mono mt-0.5">
                  ₹{currentMonthTotals.income.toLocaleString('en-IN')}
                </p>
              </div>

              <div className="bg-[#0b0b0b] border border-[#1a1a1a] rounded-xl p-3 flex flex-col justify-between h-18">
                <div className="flex items-center gap-1 text-gray-500">
                  <TrendingDown size={11} className="text-rose-400" />
                  <span className="text-[9px] font-mono uppercase tracking-widest">Outflow</span>
                </div>
                <p className="text-sm font-semibold text-rose-400 font-mono mt-0.5">
                  ₹{currentMonthTotals.expense.toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            {/* CONDITIONAL SUBVIEW A: ACTIVITIES (TRANSACTIONS WITH FILTERS) */}
            {dashboardView === 'transactions' ? (
              <div className="space-y-4">
                
                {/* Main filters drawer button */}
                <div className="bg-[#121212] border border-[#1c1c1c] rounded-2xl overflow-hidden transition-all duration-300">
                  <button 
                    type="button" 
                    onClick={() => setIsFiltersExpanded(!isFiltersExpanded)} 
                    className="w-full p-4 flex justify-between items-center bg-[#121212] hover:bg-[#181818] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="bg-[#d4af37]/10 p-1.5 rounded-lg border border-[#d4af37]/20 text-[#d4af37]">
                        <SlidersHorizontal size={14} />
                      </div>
                      <span className="text-[11px] font-mono font-bold text-[#e5e5e5] tracking-wide uppercase">Filter Transactions</span>
                    </div>
                    <ChevronDown size={14} className={`text-gray-400 transition-transform duration-300 ${isFiltersExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {/* Filters detail drawer - expanded view */}
                  {isFiltersExpanded && (
                    <div className="p-4 pt-0 border-t border-[#1c1c1c] bg-[#121212] space-y-4 animate-fade-in mt-4">
                      
                      {/* 1. Category filter */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] uppercase tracking-wider font-mono text-gray-500 font-semibold">Category</label>
                        <div className="relative">
                          <select
                            value={filterCategory}
                            onChange={(e) => setFilterCategory(e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl py-2 px-3 pr-8 text-xs text-[#e5e5e5] appearance-none outline-none focus:border-[#d4af37] shadow-inner transition-colors cursor-pointer"
                          >
                            <option value="All">🗂 All Categories</option>
                            {categories.map(cat => (
                              <option key={cat} value={cat}>{categoryIcons[cat]} {cat}</option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* 2. Month filter */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] uppercase tracking-wider font-mono text-gray-500 font-semibold">Month</label>
                        <div className="relative">
                          <select
                            value={filterMonth}
                            onChange={(e) => { selectQuickMonthFilter(e.target.value); if (e.target.value !== 'All') setBudgetMonth(e.target.value); }}
                            className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl py-2 px-3 pr-8 text-xs text-[#e5e5e5] appearance-none outline-none focus:border-[#d4af37] shadow-inner transition-colors cursor-pointer"
                          >
                            <option value="All">All Time</option>
                            {availableMonths.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                          <ChevronDown size={12} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* 3 & 4. Start / End date */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[9px] uppercase tracking-wider font-mono text-gray-500 font-semibold">Start</label>
                          <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl py-2 pl-3 pr-2 text-[11px] text-[#e5e5e5] outline-none focus:border-[#d4af37] appearance-none"
                          />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <label className="text-[9px] uppercase tracking-wider font-mono text-gray-500 font-semibold">End</label>
                          <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full bg-[#0a0a0a] border border-[#222] rounded-xl py-2 pl-3 pr-2 text-[11px] text-[#e5e5e5] outline-none focus:border-[#d4af37] appearance-none"
                          />
                        </div>
                      </div>

                      {/* 5. Clear */}
                      <button
                        onClick={() => { setFilterCategory('All'); setFilterMonth('All'); setStartDate(''); setEndDate(''); setSearchQuery(''); }}
                        className="w-full bg-[#d4af37]/10 border border-[#d4af37]/20 text-[#d4af37] hover:bg-[#d4af37]/20 text-[10px] font-mono py-2 rounded-xl transition-colors uppercase tracking-widest font-semibold cursor-pointer"
                      >
                        Clear
                      </button>
                    </div>
                  )}
                </div>

                {/* Traditional Static Visual Progress Bar - Expenditure by category title */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4">
                  <h3 className="font-serif text-[11px] tracking-wide text-[#e5e5e5] italic border-b border-[#222] pb-1.5 mb-3 flex items-center gap-1.5">
                    <span className="text-[#d4af37]">*</span> Expenditure by Category
                  </h3>
                  
                  {categorySpendingList.length === 0 ? (
                    <p className="text-[10px] text-gray-500 italic text-center py-2 font-mono">No expenses registered in this period.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {categorySpendingList.slice(0, 4).map(item => (
                        <div key={item.category} className="w-full">
                          <div className="flex justify-between items-center text-[9px] mb-0.5 font-mono">
                            <span className="text-gray-400 truncate">{item.category}</span>
                            <span className="text-white">
                              ₹{item.amount.toLocaleString('en-IN')} ({item.percentage}%)
                            </span>
                          </div>
                          <div className="w-full h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                            <div 
                              className="bg-[#d4af37] h-full" 
                              style={{ width: `${item.percentage}%` }} 
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Chart section - Category spending pattern in simulated view */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4">
                  <h3 className="font-serif text-[11px] tracking-wide text-[#e5e5e5] italic border-b border-[#222] pb-1.5 mb-3 flex items-center gap-1.5">
                    <span className="text-[#d4af37]">*</span> Category Spend Pattern
                  </h3>

                  <div className="h-24 flex items-end justify-between px-2 pt-2">
                    {weeklySpendingTrend.map((week, index) => (
                      <div key={index} className="flex flex-col items-center gap-1 flex-1">
                        <span className="text-[8px] font-mono text-gray-500">₹{week.amount}</span>
                        <div 
                          className="chart-bar w-5 bg-gradient-to-t from-yellow-800 to-[#d4af37] rounded-t transition-all duration-500" 
                          style={{ height: `${Math.max(6, week.percentHeight * 0.8)}px` }}
                        />
                        <span className="text-[8px] font-mono text-gray-500">{week.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Simulated Recent Transactions list with search */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4">
                  <div className="flex justify-between items-center border-b border-[#222] pb-1.5 mb-3">
                    <h3 className="font-serif text-[11px] tracking-wide text-[#e5e5e5] italic flex items-center gap-1.5">
                      <span className="text-[#d4af37]">*</span> Recent Transactions
                    </h3>
                    <span className="text-[8px] font-mono text-[#d4af37] bg-yellow-950/20 py-0.5 px-2 rounded-full border border-yellow-900/30">{filteredTransactions.length} items</span>
                  </div>

                  {/* Interactive local Search Input */}
                  <div className="flex gap-2 mb-3">
                    <div className="relative w-32">
                      <select 
                        value={recentDateFilter}
                        onChange={(e) => setRecentDateFilter(e.target.value)}
                        className="w-full bg-[#141414] border border-[#222] rounded-lg py-1.5 pl-3 pr-6 text-[10px] text-[#e5e5e5] appearance-none outline-none focus:border-[#d4af37] cursor-pointer"
                      >
                        <option value="All">All Time</option>
                        <option value="This Month">This Month</option>
                        <option value="Last Month">Last Month</option>
                        <option value="Last 3 Months">Last 3 Months</option>
                      </select>
                      <ChevronDown size={10} className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
                    </div>
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-500 text-[10px]">[?]</span>
                      <input
                        type="text"
                        placeholder="Search description, categories..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full bg-[#141414] border border-[#222] rounded-lg pl-7 pr-3 py-1.5 text-[10px] text-[#e5e5e5] focus:outline-none focus:border-[#d4af37]"
                      />
                    </div>
                  </div>

                  {/* Log Scroller */}
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {filteredTransactions.length === 0 ? (
                      <p className="text-[10px] text-gray-500 text-center py-6 font-mono italic">No items match filters.</p>
                    ) : (
                      filteredTransactions.map(item => (
                        <div 
                          key={item.id} 
                          className="bg-[#141414] rounded-lg p-2 border border-[#1d1d1d] flex justify-between items-center text-[11px] group"
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-medium text-white block truncate">{item.description}</span>
                              <span className={`text-[7px] px-1 rounded uppercase font-mono font-extrabold shrink-0 border ${
                                item.entryMode === 'auto' || item.isSmsDetected
                                  ? 'bg-yellow-950/40 text-[#d4af37] border-yellow-900/40'
                                  : 'bg-emerald-950/40 text-emerald-400 border-emerald-900/40'
                              }`}>
                                {item.entryMode || (item.isSmsDetected ? 'auto' : 'manual')}
                              </span>
                            </div>
                            <div className="flex gap-1.5 text-[8px] text-[#888] font-mono mt-0.5">
                              <span>{item.date}</span>
                              <span>•</span>
                              <span className="text-gray-400 font-mono">{item.category}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0 font-mono text-right">
                            <span className={`text-[10px] font-bold ${item.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {item.type === 'income' ? '+' : '-'}₹{item.amount}
                            </span>
                            <button
                              onClick={() => handleDeleteTransaction(item.id)}
                              className="text-gray-600 hover:text-red-400 transition-all p-1"
                              title="Remove item"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              </div>
            ) : (
              /* CONDITIONAL SUBVIEW B: MONTHLY BUDGET COMPARISON IN DASHBOARD */
              <div className="space-y-4">
                
                {/* Overall month text overview */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-3 flex justify-between items-center">
                  <div className="flex flex-col">
                    <span className="text-[8px] text-gray-500 font-mono">Calculated For</span>
                    <span className="text-white text-xs font-mono font-bold uppercase">{activeMonthKey}</span>
                  </div>
                  <div className="text-right flex flex-col items-end">
                    <span className="text-[8px] text-gray-500 font-mono">Active Limits Set</span>
                    <span className="text-[#d4af37] text-xs font-mono font-bold">{monthBudgetsList.length} Categories</span>
                  </div>
                </div>

                {/* Custom SVG Bullet Chart overall progress */}
                <BulletChart spent={overallSpentSum} limit={overallLimitSum} />

                {/* Real-time configured month budget actual comparison list */}
                <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-4">
                  <h3 className="font-serif text-[11px] tracking-wide text-[#e5e5e5] italic border-b border-[#222] pb-1.5 mb-3 flex items-center gap-1.5">
                    <span className="text-[#d4af37]">*</span> Smart Alerts Actual vs Budget List
                  </h3>

                  {monthBudgetsList.length === 0 ? (
                    <p className="text-[10px] text-gray-500 italic text-center py-6 font-mono border border-dashed border-[#222] rounded-lg">
                      No budgets configured for {activeMonthKey}. Select 'Budgets' in the tab navigation to configure limits.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {monthBudgetsList.map(b => {
                        const percentage = b.limit > 0 ? Math.round((b.spent / b.limit) * 100) : 0;
                        const isOver = b.spent > b.limit;

                        return (
                          <div key={b.category} className="p-3 bg-[#141414] rounded-xl border border-[#1a1a1a]">
                            <div className="flex justify-between items-center text-[10px] font-mono leading-none mb-1">
                              <span className="text-white font-medium truncate max-w-[110px]">{b.category}</span>
                              <span className="text-gray-400 text-[9px]">
                                Spent: <strong className="text-white">₹{b.spent}</strong> / <span className="text-[#d4af37] font-semibold">₹{b.limit}</span>
                              </span>
                            </div>

                            {/* Visual Slider Meter */}
                            <div className="w-full h-1 bg-[#1a1a1a] rounded-full overflow-hidden mt-1 bg-gray-900">
                              <div 
                                className={`h-full transition-all duration-300 ${isOver ? 'bg-red-500' : 'bg-[#d4af37]'}`}
                                style={{ width: `${Math.min(100, percentage)}%` }}
                              />
                            </div>

                            <div className="flex justify-between items-center mt-1.5 text-[8px] font-mono">
                              <span className={percentage >= 100 ? 'text-red-400 font-semibold' : percentage >= 80 ? 'text-yellow-500' : 'text-gray-500'}>
                                {percentage}% utilized
                              </span>
                              {isOver && (
                                <span className="text-red-400 text-[8px] font-bold flex items-center gap-0.5 animate-pulse">
                                  [!]️ Limit Alert! Exceeded ₹{b.spent - b.limit}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Custom SVG Radar Chart representing actual distribution vs expectations */}
                <RadarChart data={monthBudgetsList} />

              </div>
            )}

          </div>
        );
      })()}


      {/* --- TAB 2: MANUAL ENTRY FORM WITH INCREMENT ARROWS --- */}
      {navTab === 'add' && (
        <div className="space-y-4 animate-fade-in pt-5 text-xs">
          
          <div className="flex flex-col border-b border-[#1c1c1c] pb-3">
            <span className="text-[9px] text-[#888] font-mono tracking-widest uppercase font-bold">Input Module</span>
            <h2 className="font-serif text-base text-white">Add Entry Record</h2>
          </div>

          <form onSubmit={handleAddNewManualEntry} className="space-y-4 bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-5">
            
            {/* Income vs Expense Selection Tabs */}
            <div className="grid grid-cols-2 gap-2 bg-[#050505] p-1 rounded-xl border border-[#222]">
              <button
                type="button"
                onClick={() => setFormType('expense')}
                className={`py-2 text-[10px] uppercase font-mono tracking-wider font-semibold rounded-lg transition-all ${
                  formType === 'expense' 
                    ? 'bg-rose-950/50 text-rose-400 border border-rose-900/30' 
                    : 'text-gray-400'
                }`}
              >
                Sent
              </button>
              <button
                type="button"
                onClick={() => setFormType('income')}
                className={`py-2 text-[10px] uppercase font-mono tracking-wider font-semibold rounded-lg transition-all ${
                  formType === 'income' 
                    ? 'bg-emerald-950/50 text-emerald-400 border border-emerald-900/30' 
                    : 'text-gray-400'
                }`}
              >
                Received
              </button>
            </div>

            {/* Date selection */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] text-gray-500 uppercase font-mono tracking-wider font-semibold">Date</label>
              <div className="relative">
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full bg-[#141414] border border-[#222] rounded-xl p-3 text-xs text-[#e5e5e5] focus:outline-none focus:border-[#d4af37] appearance-none cursor-pointer"
                />
              </div>
            </div>

            {/* Amount Section with Mobile-Friendly touch arrows up/down */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] text-gray-500 uppercase font-mono tracking-wider">Amount (₹)</label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const curr = parseFloat(formAmount) || 0;
                    setFormAmount(String(Math.max(0, curr - 100)));
                  }}
                  className="bg-[#121212] border border-[#222] hover:border-gray-600 text-[#d4af37] font-mono font-extrabold w-11 h-11 rounded-xl flex items-center justify-center text-base active:scale-95 transition-all shrink-0 select-none shadow-md"
                >
                  -100
                </button>
                <div className="relative flex-1">
                  <input
                    type="number"
                    required
                    placeholder="e.g. 350"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full bg-[#141414] border border-[#222] rounded-xl p-3 text-center text-sm font-mono font-bold text-white placeholder-gray-800 focus:outline-none focus:border-[#d4af37] [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const curr = parseFloat(formAmount) || 0;
                    setFormAmount(String(curr + 100));
                  }}
                  className="bg-[#121212] border border-[#222] hover:border-gray-600 text-[#d4af37] font-mono font-extrabold w-11 h-11 rounded-xl flex items-center justify-center text-base active:scale-95 transition-all shrink-0 select-none shadow-md"
                >
                  +100
                </button>
              </div>
              {/* Quick touch incremental options for mobile phone users */}
              <div className="grid grid-cols-4 gap-1.5 mt-1">
                {[500, 1000, 2000, 5000].map(val => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => {
                      const curr = parseFloat(formAmount) || 0;
                      setFormAmount(String(curr + val));
                    }}
                    className="bg-[#0b0b0b] border border-[#222] text-gray-400 font-mono hover:text-white text-[9px] py-1.5 rounded-lg active:scale-95 transition-colors text-center"
                  >
                    +{val}
                  </button>
                ))}
              </div>
            </div>

            {/* Category list */}
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between items-center">
                <label className="text-[9px] text-gray-500 uppercase font-mono tracking-wider font-semibold">Category</label>
                <button 
                  type="button" 
                  onClick={() => setShowManageCategoriesModal(true)}
                  className="text-[9px] text-[#d4af37] opacity-80 hover:opacity-100 transition-all font-mono uppercase tracking-wider font-semibold"
                >
                  Manage
                </button>
              </div>
              <div className="relative">
                <select
                  value={formCategory}
                  onChange={(e) => {
                    if (e.target.value === 'ADD_NEW') {
                      setShowNewCategoryModal(true);
                    } else {
                      setFormCategory(e.target.value);
                    }
                  }}
                  className="w-full bg-[#141414] border border-[#222] rounded-xl p-3 pr-10 text-xs text-[#e5e5e5] focus:outline-none focus:border-[#d4af37] appearance-none cursor-pointer"
                >
                  {categories.map(category => (
                    <option key={category} value={category}>{categoryIcons[category]} {category}</option>
                  ))}
                  <option value="ADD_NEW">+ Add New Category</option>
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </div>

            {/* Description */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[9px] text-gray-500 uppercase font-mono tracking-wider">Description / Notes</label>
              <input
                type="text"
                required
                placeholder="e.g. Rice, Milk, Coffee details..."
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                className="w-full bg-[#141414] border border-[#222] rounded-xl p-3 text-xs text-[#e5e5e5] placeholder-gray-700 focus:outline-none focus:border-[#d4af37]"
              />
            </div>

            {/* Action save */}
            <button
              type="submit"
              className="w-full bg-[#d4af37] text-black font-semibold text-xs py-3 px-4 rounded-xl mt-2 tracking-widest uppercase font-mono hover:opacity-90 transition-all cursor-pointer"
            >
              Add Entry
            </button>

          </form>

          {showNewCategoryModal && (
            <div className="p-4 bg-[#141414] border border-[#222] rounded-xl flex flex-col gap-3 font-mono animate-fade-in shadow-lg">
              <label className="text-[10px] text-[#d4af37] uppercase tracking-wider font-semibold block">Create Custom Category</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Icon (e.g. [!])" 
                  value={newCategoryIcon}
                  onChange={(e) => setNewCategoryIcon(e.target.value)}
                  className="bg-[#050505] border border-[#222] rounded-lg p-2 text-xs w-16 text-center text-white focus:outline-none focus:border-[#d4af37]"
                />
                <input 
                  type="text" 
                  placeholder="Category Name" 
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  className="bg-[#050505] border border-[#222] rounded-lg p-2 text-xs flex-1 text-white focus:outline-none focus:border-[#d4af37]"
                />
              </div>
              <div className="flex gap-2">
                <button 
                  type="button"
                  onClick={() => {
                    setShowNewCategoryModal(false);
                    setNewCategoryName('');
                  }}
                  className="flex-1 bg-transparent border border-[#333] text-gray-400 py-2 rounded-lg text-[10px] uppercase tracking-wider hover:bg-[#1a1a1a] transition-all"
                >
                  Cancel
                </button>
                <button 
                  type="button"
                  onClick={() => {
                    if (newCategoryName.trim()) {
                      saveNewCategory(newCategoryName.trim(), newCategoryIcon);
                      setFormCategory(newCategoryName.trim());
                      setShowNewCategoryModal(false);
                      setNewCategoryName('');
                    }
                  }}
                  className="flex-1 bg-[#d4af37] text-black py-2 rounded-lg text-[10px] font-semibold uppercase tracking-wider hover:opacity-90 transition-all"
                >
                  Save Category
                </button>
              </div>
            </div>
          )}

          {showManageCategoriesModal && (
            <div className="p-4 bg-[#141414] border border-[#222] rounded-xl flex flex-col gap-3 animate-fade-in shadow-lg">
              <div className="flex justify-between items-center pb-2 border-b border-[#222]">
                <label className="text-[10px] text-[#d4af37] uppercase font-mono tracking-wider font-semibold">Manage Categories</label>
                <button 
                  type="button"
                  onClick={() => setShowManageCategoriesModal(false)}
                  className="text-gray-400 hover:text-white"
                >
                  ×
                </button>
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 no-scrollbar">
                {categories.map((cat) => (
                  <div key={cat} className="flex justify-between items-center bg-[#0a0a0a] border border-[#1a1a1a] rounded-lg p-2 text-xs">
                    <div className="flex items-center gap-2 text-[#e5e5e5]">
                      <span>{categoryIcons[cat]}</span>
                      <span>{cat}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategory(cat)}
                      className="text-gray-500 hover:text-red-400 transition-colors p-1"
                      title="Delete Category"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

        </div>
      )}


      {/* --- TAB 3: SMS INBOX --- */}
      {navTab === 'sms' && (
        <div className="space-y-3 animate-fade-in pt-5 text-xs">

          <div className="flex justify-between items-center pb-3 border-b border-[#1c1c1c]">
            <div className="flex items-center gap-2">
              <h2 className="font-serif text-base text-white">SMS Inbox</h2>
              <span className="text-[9px] bg-red-950/40 text-red-400 font-mono px-2 py-0.5 rounded-full border border-red-900/30">
                {smsMessages.filter(s => s.status === 'pending').length} pending
              </span>
            </div>
            <div className="flex gap-2 items-center">
              {smsMessages.filter(s => s.status === 'pending').length > 0 && (
                <button
                  onClick={() => setSmsMessages(prev => prev.map(s => s.status === 'pending' ? { ...s, status: 'skipped' } : s))}
                  className="text-[9px] font-mono border border-[#333] text-gray-400 hover:text-white px-2.5 py-1 rounded-lg transition-all"
                >
                  Skip All
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            {smsMessages.length === 0 ? (
              <div className="text-center py-10 bg-[#0f0f0f] rounded-xl border border-[#1a1a1a]">
                <MessageSquare className="mx-auto text-gray-700 mb-2.5" size={20} />
                <p className="text-gray-500 text-[11px]">No SMS messages yet.</p>
                <p className="text-gray-600 text-[10px] mt-1">Bank SMS will appear here automatically.</p>
              </div>
            ) : (
              smsMessages.map(sms => (
                <div
                  key={sms.id}
                  className={`p-3.5 rounded-xl border text-[11px] flex flex-col gap-2.5 relative transition-all ${
                    sms.status === 'confirmed'
                      ? 'bg-emerald-950/20 border-emerald-900/40 opacity-70'
                      : sms.status === 'skipped'
                      ? 'bg-[#0f0f0f] border-[#1a1a1a] opacity-50'
                      : 'bg-[#0f0f0f] border-l-4 border-l-[#d4af37] border-[#1e1a0a] shadow-lg'
                  }`}
                >
                  {/* Header row */}
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-yellow-400 font-bold font-mono text-[10px]">{sms.sender || 'BANK-SMS'}</span>
                      <p className="text-gray-400 font-mono text-[9px] mt-0.5">
                        {new Date(sms.timestamp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                        {' '}
                        {new Date(sms.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full border font-bold ${
                      sms.status === 'confirmed' ? 'text-emerald-400 border-emerald-800 bg-emerald-950/30' :
                      sms.status === 'skipped'   ? 'text-gray-500 border-gray-800 bg-[#111]' :
                      'text-yellow-400 border-yellow-900 bg-yellow-950/20'
                    }`}>
                      {sms.status === 'confirmed' ? 'Confirmed' : sms.status === 'skipped' ? 'Skipped' : 'Pending'}
                    </span>
                  </div>

                  {/* SMS text */}
                  <p className="text-gray-300 leading-relaxed">{sms.text}</p>

                  {/* Parsed amount */}
                  {sms.parsedAmount ? (
                    <div className="flex gap-3 text-[10px] font-mono">
                      <span className="text-gray-500">Amount: <strong className={sms.parsedType === 'income' ? 'text-emerald-400' : 'text-red-400'}>
                        {sms.parsedType === 'income' ? '+' : '-'}Rs.{sms.parsedAmount.toLocaleString('en-IN')}
                      </strong></span>
                      {sms.parsedBank && <span className="text-gray-600">{sms.parsedBank}</span>}
                    </div>
                  ) : null}

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1 border-t border-[#1a1a1a]">
                    {sms.status === 'pending' && (
                      <>
                        <button
                          onClick={() => {
                            let proposedCat = sms.parsedType === 'income' ? 'Income' : 'Grocery & Essentials';
                            const recentTx = transactions.find(t => t.merchant?.toLowerCase() === sms.parsedMerchant?.toLowerCase());
                            if (recentTx?.category) proposedCat = recentTx.category;
                            setParseWizard({
                              smsText: sms.text,
                              amount: sms.parsedAmount || 0,
                              type: sms.parsedType || 'expense',
                              merchant: sms.parsedMerchant || 'Merchant',
                              bankName: sms.parsedBank || 'Bank',
                              proposedCategory: proposedCat,
                              description: '',
                              originalSmsId: sms.id
                            });
                          }}
                          className="flex-1 bg-[#d4af37] hover:bg-[#c9a227] text-black font-mono font-bold text-[10px] uppercase tracking-wide py-2 rounded-lg transition-all"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setSmsMessages(prev => prev.map(s => s.id === sms.id ? { ...s, status: 'skipped' } : s))}
                          className="flex-1 border border-[#333] text-gray-400 hover:text-white font-mono text-[10px] uppercase tracking-wide py-2 rounded-lg transition-all"
                        >
                          Skip
                        </button>
                      </>
                    )}
                    {sms.status === 'skipped' && (
                      <button
                        onClick={() => {
                          let proposedCat = sms.parsedType === 'income' ? 'Income' : 'Grocery & Essentials';
                          setParseWizard({
                            smsText: sms.text,
                            amount: sms.parsedAmount || 0,
                            type: sms.parsedType || 'expense',
                            merchant: sms.parsedMerchant || 'Merchant',
                            bankName: sms.parsedBank || 'Bank',
                            proposedCategory: proposedCat,
                            description: '',
                            originalSmsId: sms.id
                          });
                        }}
                        className="flex-1 border border-[#d4af37]/40 text-[#d4af37] hover:bg-[#d4af37] hover:text-black font-mono text-[10px] uppercase py-2 rounded-lg transition-all"
                      >
                        Confirm Now
                      </button>
                    )}
                    <button
                      onClick={() => {
                        if (window.confirm('Delete this SMS record permanently?')) {
                          setSmsMessages(prev => prev.filter(s => s.id !== sms.id));
                        }
                      }}
                      className="w-8 border border-red-900/40 text-red-500 hover:bg-red-950/30 font-mono text-[10px] rounded-lg transition-all flex items-center justify-center"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>

                  {/* Confirmed state: no actions, just delete */}
                  {sms.status === 'confirmed' && (
                    <div className="flex justify-between items-center pt-1 border-t border-[#1a1a1a]">
                      <span className="text-emerald-400 text-[10px] font-mono">Added to ledger</span>
                      <button
                        onClick={() => {
                          if (window.confirm('Delete this confirmed record?')) {
                            setSmsMessages(prev => prev.filter(s => s.id !== sms.id));
                          }
                        }}
                        className="text-red-600 hover:text-red-400 transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}


      {/* --- TAB 4: BUDGET CONTROL & LIMIT ALERTS (SETTING ONLY) --- */}
      {navTab === 'budgets' && (
        <div className="space-y-4 animate-fade-in pt-5 text-xs text-gray-400">
          
          <div className="flex flex-col border-b border-[#1c1c1c] pb-3">
            <span className="text-[9px] text-[#888] font-mono tracking-widest uppercase font-bold">Budget Management</span>
            <h2 className="font-serif text-base text-white">Budget Setup</h2>
          </div>

          <p className="text-[11px] font-sans leading-relaxed text-gray-400">
            Set spending limits per category. Alerts appear on Dashboard when limits are approached.
          </p>

          {/* Highly Polished Adjust Category Limit Module - NO basic selectors or basic prompts */}
          <div className="bg-[#0f0f0f] border border-[#d4af37]/15 rounded-2xl p-4 mt-2 space-y-4">
            <div className="flex items-center gap-1.5 border-b border-[#222] pb-1.5">
              <p className="font-mono text-[#d4af37] text-[10px] uppercase font-bold">⚙️ Budget Settings</p>
            </div>

            {/* Month Filter Selector for setup */}
            <div className="space-y-1.5">
              <label className="text-[9px] font-mono text-gray-500 uppercase tracking-wider block">Budget Month</label>
              <div className="grid grid-cols-2 gap-2">
                {['Apr-2026', 'May-2026'].map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBudgetMonth(m)}
                    className={`py-2 px-3 rounded-xl text-xs font-mono border text-center transition-all ${
                      budgetMonth === m
                        ? 'bg-[#d4af37]/20 border-[#d4af37] text-[#d4af37] font-semibold'
                        : 'bg-[#141414] border-[#222] text-gray-400 hover:bg-[#1a1a1a]'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Premium Custom Category Selector Grid to replace Basic basic dropdown */}
            <div className="space-y-2">
              <label className="text-[9px] font-mono text-gray-500 uppercase tracking-wider block">Category</label>
              <div className="grid grid-cols-2 gap-1.5 max-h-44 overflow-y-auto pr-1 no-scrollbar border border-[#1a1a1a] rounded-xl p-2 bg-[#050505]">
                {categories.filter(c => c !== 'Income').map(cat => {
                  const isSelected = budgetCategory === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setBudgetCategory(cat)}
                      className={`p-2.5 rounded-lg text-[10px] text-left font-mono transition-all border flex items-center justify-between ${
                        isSelected
                          ? 'bg-[#d4af37]/10 border-[#d4af37] text-[#d4af37] font-bold'
                          : 'bg-[#0f0f0f]/80 border-[#222]/80 text-gray-400 hover:border-gray-600'
                      }`}
                    >
                      <span className="truncate">{cat}</span>

                    </button>
                  );
                })}
              </div>
            </div>

            {/* Limit Input Box Integrated Inline */}
            <div className="space-y-1.5">
              <label className="text-[9px] font-mono text-gray-500 uppercase tracking-wider block">Limit Amount (₹)</label>
              <div className="relative">
                <span className="absolute left-3 top-2.5 text-gray-500 font-mono text-xs">₹</span>
                <input
                  type="number"
                  placeholder="Set expectation limit amount, e.g. 15000"
                  value={budgetAmountInput}
                  onChange={(e) => setBudgetAmountInput(e.target.value)}
                  className="bg-[#141414] border border-[#222] p-2.5 pl-7 rounded-xl text-xs text-white focus:outline-none focus:border-[#d4af37] font-mono w-full"
                />
              </div>
            </div>

            {/* Save Action Trigger */}
            <button
              type="button"
              onClick={() => {
                const val = parseFloat(budgetAmountInput);
                if (isNaN(val) || val <= 0) {
                  alert('Please enter a valid numeric limit.');
                  return;
                }
                setBudgets(prev => {
                  // Check if budget already exists for that specific month & category
                  const existsIndex = prev.findIndex(b => b.category === budgetCategory && (b.month || 'May-2026') === budgetMonth);
                  if (existsIndex >= 0) {
                    const updated = [...prev];
                    updated[existsIndex] = { category: budgetCategory, limit: val, month: budgetMonth };
                    return updated;
                  } else {
                    return [...prev, { category: budgetCategory, limit: val, month: budgetMonth }];
                  }
                });
                alert(`Success! Configured ${budgetCategory} limit = ₹${val} for ${budgetMonth}`);
                setBudgetAmountInput('');
              }}
              className="w-full bg-[#d4af37] hover:opacity-95 text-black font-semibold uppercase text-[10px] tracking-wider py-3 px-4 rounded-xl shadow-lg transition-all font-mono"
            >
              Apply Limit
            </button>
          </div>

          {/* Current Setup Listing */}
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-4 mt-4 space-y-3">
            <div className="flex justify-between items-center border-b border-[#222] pb-1.5">
              <span className="text-[10px] font-mono text-white">Active Limits List ({budgets.length})</span>
              <span className="text-[8px] font-mono text-gray-500 uppercase font-bold">{budgetMonth} selection view</span>
            </div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {budgets.length === 0 ? (
                <p className="text-[10px] text-gray-500 italic text-center py-4 font-mono">No category limits exist. Create above!</p>
              ) : (
                [...budgets]
                  .sort((a, b) => (a.month || 'May-2026').localeCompare(b.month || 'May-2026') || a.category.localeCompare(b.category))
                  .map((b, idx) => (
                    <div key={`${b.category}-${b.month}-${idx}`} className="bg-[#141414] rounded-lg p-2.5 border border-[#1d1d1d] flex justify-between items-center text-[10px] font-mono">
                      <div>
                        <span className="text-white block font-medium">{b.category}</span>
                        <span className="text-gray-500 text-[8px]">Period: <strong className="text-gray-300 font-mono text-[9px]">{b.month || 'May-2026'}</strong></span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[#d4af37] font-bold">₹{b.limit.toLocaleString('en-IN')}</span>
                        <button
                          onClick={() => {
                            if (confirm(`Do you want to discard the ${b.category} budget limit for ${b.month || 'May-2026'}?`)) {
                              setBudgets(prev => prev.filter(item => !(item.category === b.category && (item.month || 'May-2026') === (b.month || 'May-2026'))));
                            }
                          }}
                          className="text-gray-500 hover:text-red-400 text-[10px]"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </div>

        </div>
      )}


      {/* --- TAB 5: HISTORY --- */}
      {navTab === 'history' && (
        <div className="space-y-4 animate-fade-in pt-2 text-xs">

          <div className="flex justify-between items-center pb-3 border-b border-[#1c1c1c]">
            <div>
              <span className="text-[9px] text-[#888] font-mono tracking-widest uppercase font-bold">Transaction Log</span>
              <h2 className="font-serif text-base text-white">History</h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleExportToExcelStyleCsv}
                className="bg-[#141414] border border-[#222] hover:border-[#d4af37] text-[#d4af37] py-1.5 px-3 rounded-xl flex items-center gap-1.5 transition-all font-mono text-[9px] uppercase tracking-wider"
              >
                <Download size={12} /> Export
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-gray-500 font-mono uppercase tracking-wider">Category</label>
                <select
                  value={historyFilterCategory}
                  onChange={e => setHistoryFilterCategory(e.target.value)}
                  className="bg-[#141414] border border-[#222] rounded-lg py-1.5 px-2 text-[10px] text-white appearance-none outline-none focus:border-[#d4af37]"
                >
                  <option value="All">All</option>
                  {categories.map(c => <option key={c} value={c}>{categoryIcons[c]} {c}</option>)}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-gray-500 font-mono uppercase tracking-wider">Type</label>
                <select
                  value={historyFilterType}
                  onChange={e => setHistoryFilterType(e.target.value)}
                  className="bg-[#141414] border border-[#222] rounded-lg py-1.5 px-2 text-[10px] text-white appearance-none outline-none focus:border-[#d4af37]"
                >
                  <option value="All">All</option>
                  <option value="income">Received</option>
                  <option value="expense">Sent</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-gray-500 font-mono uppercase tracking-wider">Start</label>
                <input type="date" value={historyStartDate} onChange={e => setHistoryStartDate(e.target.value)}
                  className="bg-[#141414] border border-[#222] rounded-lg py-1.5 px-2 text-[10px] text-white outline-none focus:border-[#d4af37]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[9px] text-gray-500 font-mono uppercase tracking-wider">End</label>
                <input type="date" value={historyEndDate} onChange={e => setHistoryEndDate(e.target.value)}
                  className="bg-[#141414] border border-[#222] rounded-lg py-1.5 px-2 text-[10px] text-white outline-none focus:border-[#d4af37]" />
              </div>
            </div>
            {(historyFilterCategory !== 'All' || historyFilterType !== 'All' || historyStartDate || historyEndDate) && (
              <button onClick={() => { setHistoryFilterCategory('All'); setHistoryFilterType('All'); setHistoryStartDate(''); setHistoryEndDate(''); }}
                className="text-[9px] text-[#d4af37] font-mono uppercase tracking-wider hover:underline">
                Clear Filters
              </button>
            )}
          </div>

          {/* Transaction list — latest 20 */}
          <div className="space-y-1.5">
            {(() => {
              let list = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
              if (historyFilterCategory !== 'All') list = list.filter(t => t.category === historyFilterCategory);
              if (historyFilterType !== 'All') list = list.filter(t => t.type === historyFilterType);
              if (historyStartDate) list = list.filter(t => t.date >= historyStartDate);
              if (historyEndDate) list = list.filter(t => t.date <= historyEndDate);
              list = list.slice(0, 20);

              if (list.length === 0) return (
                <div className="text-center py-10 text-gray-600 font-mono text-[10px]">No transactions match filters.</div>
              );

              return list.map(item => (
                <div key={item.id} className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-xl p-3 flex justify-between items-center">
                  <div className="min-w-0 flex-1 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium text-white truncate">{item.description}</span>
                    </div>
                    <div className="flex gap-1.5 text-[9px] text-gray-500 font-mono mt-0.5">
                      <span>{item.date}</span>
                      <span>•</span>
                      <span>{categoryIcons[item.category]} {item.category}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-[11px] font-bold font-mono ${item.type === 'income' ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {item.type === 'income' ? '+' : '-'}₹{item.amount.toLocaleString('en-IN')}
                    </p>
                    <p className="text-[8px] text-gray-600 font-mono">{item.type === 'income' ? 'Received' : 'Sent'}</p>
                  </div>
                </div>
              ));
            })()}
          </div>

        </div>
      )}

      {/* --- TAB 6: SETTINGS --- */}
      {navTab === 'settings' && (
        <div className="space-y-4 animate-fade-in text-xs p-1">
          <div className="flex flex-col">
            <span className="text-[9px] text-[#888] font-mono tracking-widest uppercase">Configuration</span>
            <h2 className="font-serif text-lg text-white">Settings</h2>
          </div>
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-[#1a1a1a] pb-2">
              <Sparkles size={14} className="text-[#d4af37]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#d4af37] font-semibold">Gemini AI API Key</span>
            </div>
            <p className="text-[#666] text-[10px] font-mono leading-relaxed">
              Get a free key at aistudio.google.com — needed for AI SMS parsing and smart insights.
            </p>
            <input
              type="password"
              placeholder="AIza..."
              value={geminiKey}
              onChange={e => setGeminiKeyState(e.target.value)}
              className="w-full bg-[#141414] border border-[#222] text-white text-xs font-mono px-3 py-2.5 rounded-xl focus:outline-none focus:border-[#d4af37] placeholder-[#444]"
            />
            <button
              onClick={() => {
                localStorage.setItem(GEMINI_API_KEY_STORAGE, geminiKey);
                setGeminiKeySaved(true);
                setTimeout(() => setGeminiKeySaved(false), 2000);
              }}
              className="w-full bg-[#d4af37] hover:bg-[#c9a227] text-black font-mono font-bold text-[10px] uppercase tracking-wider py-2.5 rounded-xl transition-all flex items-center justify-center gap-2"
            >
              {geminiKeySaved ? <><CheckCircle2 size={13} /> Saved!</> : 'Save API Key'}
            </button>
            {geminiKey
              ? <p className="text-green-400 text-[9px] font-mono text-center">AI features enabled</p>
              : <p className="text-[#555] text-[9px] font-mono text-center">No key — app uses offline fallback</p>
            }
          </div>
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2 border-b border-[#1a1a1a] pb-2">
              <Info size={14} className="text-[#d4af37]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#d4af37] font-semibold">About</span>
            </div>
            <p className="text-[#888] text-[10px] font-mono">Finance Tracker v1.0.0</p>
            <p className="text-[#555] text-[9px] font-mono leading-relaxed">All data stays on your device. No login required.</p>
          </div>

          {/* Notification permission status */}
          <div className="bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-2 border-b border-[#1a1a1a] pb-2">
              <Bell size={14} className="text-[#d4af37]" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-[#d4af37] font-semibold">Notification Permission</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-400 text-[10px] font-mono">Status:</span>
              <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full border ${
                notifPermission === 'granted' ? 'text-emerald-400 border-emerald-800 bg-emerald-950/20' :
                notifPermission === 'denied' ? 'text-red-400 border-red-900 bg-red-950/20' :
                'text-yellow-400 border-yellow-900 bg-yellow-950/20'
              }`}>
                {notifPermission === 'granted' ? 'Enabled' : notifPermission === 'denied' ? 'Blocked' : 'Not set'}
              </span>
            </div>
            {notifPermission !== 'granted' && (
              <button
                onClick={async () => {
                  if ('Notification' in window) {
                    const perm = await Notification.requestPermission();
                    setNotifPermission(perm);
                  }
                }}
                className="w-full border border-[#d4af37]/40 text-[#d4af37] font-mono text-[10px] uppercase py-2 rounded-xl hover:bg-[#d4af37]/10 transition-all"
              >
                {notifPermission === 'denied' ? 'Open Device Settings to Enable' : 'Enable Notifications'}
              </button>
            )}
            <p className="text-[#444] text-[9px] font-mono leading-relaxed">
              For automatic SMS detection on Android: install the APK, then go to Settings → Apps → Finance Tracker → Permissions → enable SMS and Notifications.
            </p>
          </div>
        </div>
      )}

    </div>

    {/* Bottom Navigation Bar - PhonePe style with prominent Add */}
    <div className="h-20 bg-[#090909] border-t border-[#141414] px-2 flex justify-between items-center text-gray-500 select-none shrink-0 relative">

      {/* Dashboard */}
      <button onClick={() => setNavTab('dashboard')} className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all ${navTab === 'dashboard' ? 'text-[#d4af37]' : 'text-gray-500'}`}>
        <TrendingUp size={20} />
        <span className="text-[9px] font-mono tracking-wide">Home</span>
      </button>

      {/* SMS */}
      <button onClick={() => setNavTab('sms')} className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full relative transition-all ${navTab === 'sms' ? 'text-[#d4af37]' : 'text-gray-500'}`}>
        <div className="relative">
          <MessageSquare size={20} />
          {smsMessages.filter(s => s.status === 'pending').length > 0 && (
            <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full flex items-center justify-center text-white text-[8px] font-bold">
              {smsMessages.filter(s => s.status === 'pending').length}
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono tracking-wide">SMS</span>
      </button>

      {/* Add — PhonePe/BHIM style prominent center button */}
      <button onClick={() => setNavTab('add')} className="flex flex-col items-center justify-center gap-1 flex-1 h-full transition-all -mt-6">
        <div className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg border-4 transition-all ${
          navTab === 'add'
            ? 'bg-[#d4af37] border-[#b8962a] shadow-[0_0_20px_rgba(212,175,55,0.4)]'
            : 'bg-[#d4af37] border-[#b8962a] shadow-[0_4px_15px_rgba(0,0,0,0.5)]'
        }`}>
          <Plus size={26} className="text-black" strokeWidth={3} />
        </div>
        <span className={`text-[9px] font-mono tracking-wide ${navTab === 'add' ? 'text-[#d4af37]' : 'text-gray-500'}`}>Add</span>
      </button>

      {/* Budgets */}
      <button onClick={() => setNavTab('budgets')} className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all ${navTab === 'budgets' ? 'text-[#d4af37]' : 'text-gray-500'}`}>
        <AlertCircle size={20} />
        <span className="text-[9px] font-mono tracking-wide">Budget</span>
      </button>

      {/* History */}
      <button onClick={() => setNavTab('history')} className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-all ${navTab === 'history' ? 'text-[#d4af37]' : 'text-gray-500'}`}>
        <FileText size={20} />
        <span className="text-[9px] font-mono tracking-wide">History</span>
      </button>

    </div>
      </div>

    </div>
  );
}
