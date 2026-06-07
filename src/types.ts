/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  category: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  bankName?: string;
  isSmsDetected?: boolean;
  entryMode?: 'manual' | 'auto';
}

export interface BudgetLimit {
  category: string;
  limit: number;
  month: string;
}

export interface SmsMessage {
  id: string;
  sender: string;
  text: string;
  timestamp: string;
  parsedAmount?: number;
  parsedType?: 'income' | 'expense';
  parsedMerchant?: string;
  parsedBank?: string;
  status: 'pending' | 'confirmed' | 'skipped' | 'applied' | 'ignored';
}

export interface CategoryBudgetStatus {
  category: string;
  budget: number;
  spent: number;
}

export interface MonthlySummary {
  month: string;
  totalIncome: number;
  totalExpense: number;
  savings: number;
}
