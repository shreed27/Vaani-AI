import React, { useState, useEffect } from 'react';
import { Transaction, UserRole } from '../types';
import { queryTransactions, categorizeTransaction, suggestCategory } from '../services/gemini';
import { 
  Search, 
  Filter, 
  Calendar, 
  CheckCircle, 
  XCircle, 
  Clock, 
  Tag, 
  ChevronDown, 
  ChevronUp,
  RefreshCw,
  Hash,
  Loader2,
  Database
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface TransactionManagerProps {
  userId: string;
  role: UserRole;
  initialTransactions?: Transaction[];
  onSeed?: () => Promise<void>;
}

const TransactionManager: React.FC<TransactionManagerProps> = ({ userId, role, initialTransactions = [], onSeed }) => {
  const [transactions, setTransactions] = useState<Transaction[]>(initialTransactions);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    status: '' as any,
    referenceId: '',
    category: ''
  });
  const [showFilters, setShowFilters] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState('');

  const fetchFilteredTransactions = async () => {
    setLoading(true);
    try {
      const results = await queryTransactions(userId, role, {
        ...filters,
        status: filters.status || undefined
      });
      setTransactions(results);
    } catch (error) {
      console.error("Failed to fetch transactions:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialTransactions.length > 0) {
      setTransactions(initialTransactions);
    } else {
      fetchFilteredTransactions();
    }
  }, [userId, role]);

  const handleCategorize = async (id: string, category: string) => {
    try {
      await categorizeTransaction(id, category);
      setTransactions(prev => prev.map(t => t.id === id ? { ...t, category } : t));
      setEditingId(null);
    } catch (error) {
      console.error("Failed to categorize:", error);
    }
  };

  const categories = ["Food", "Travel", "Shopping", "Bills", "Groceries", "Health", "General"];

  return (
    <div className="w-full max-w-4xl bg-white rounded-[32px] border border-[#f0f4f9] shadow-sm overflow-hidden flex flex-col">
      {/* Header & Search */}
      <div className="p-6 border-b border-[#f0f4f9] space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xl font-display font-semibold text-[#1f1f1f]">Transactions</h3>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowFilters(!showFilters)}
              className={cn(
                "p-2 rounded-full transition-all",
                showFilters ? "bg-blue-50 text-blue-600" : "hover:bg-[#f0f4f9] text-[#444746]"
              )}
            >
              <Filter className="w-5 h-5" />
            </button>
            <button 
              onClick={fetchFilteredTransactions}
              className="p-2 hover:bg-[#f0f4f9] rounded-full text-[#444746] transition-all"
            >
              <RefreshCw className={cn("w-5 h-5", loading && "animate-spin")} />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search by Reference ID..."
            className="w-full pl-10 pr-4 py-3 bg-[#f0f4f9] rounded-2xl border-none focus:ring-2 focus:ring-blue-500/20 transition-all text-sm"
            value={filters.referenceId}
            onChange={(e) => setFilters(prev => ({ ...prev, referenceId: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && fetchFilteredTransactions()}
          />
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Start Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input 
                      type="date" 
                      className="w-full pl-9 pr-3 py-2 bg-[#f0f4f9] rounded-xl text-xs border-none focus:ring-1 focus:ring-blue-500"
                      value={filters.startDate}
                      onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">End Date</label>
                  <div className="relative">
                    <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input 
                      type="date" 
                      className="w-full pl-9 pr-3 py-2 bg-[#f0f4f9] rounded-xl text-xs border-none focus:ring-1 focus:ring-blue-500"
                      value={filters.endDate}
                      onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Status</label>
                  <select 
                    className="w-full px-3 py-2 bg-[#f0f4f9] rounded-xl text-xs border-none focus:ring-1 focus:ring-blue-500 appearance-none"
                    value={filters.status}
                    onChange={(e) => setFilters(prev => ({ ...prev, status: e.target.value }))}
                  >
                    <option value="">All Status</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="pending">Pending</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end mt-4">
                <button 
                  onClick={fetchFilteredTransactions}
                  className="px-6 py-2 bg-blue-600 text-white rounded-full text-xs font-bold hover:bg-blue-700 transition-all shadow-sm"
                >
                  Apply Filters
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            <p className="text-sm text-gray-400">Fetching transactions...</p>
          </div>
        ) : transactions.length > 0 ? (
          <div className="divide-y divide-[#f0f4f9]">
            {transactions.map((tx) => (
              <div key={tx.id} className="p-4 hover:bg-[#f8fafd] transition-colors group">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "w-10 h-10 rounded-2xl flex items-center justify-center shadow-sm",
                      tx.status === 'success' ? "bg-emerald-50 text-emerald-600" : 
                      tx.status === 'failed' ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-600"
                    )}>
                      {tx.status === 'success' ? <CheckCircle className="w-5 h-5" /> : 
                       tx.status === 'failed' ? <XCircle className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-[#1f1f1f]">
                        {role === 'merchant' ? tx.customerName : tx.merchantName}
                      </h4>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 font-medium">
                        <span className="flex items-center gap-1">
                          <Hash className="w-3 h-3" />
                          {tx.referenceId}
                        </span>
                        <span>•</span>
                        <span>{new Date(tx.timestamp).toLocaleDateString()}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-[#1f1f1f]">₹{tx.amount}</p>
                    <span className={cn(
                      "text-[9px] font-bold uppercase tracking-widest",
                      tx.status === 'success' ? "text-emerald-500" : 
                      tx.status === 'failed' ? "text-red-500" : "text-amber-500"
                    )}>
                      {tx.status}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 px-2 py-1 bg-[#f0f4f9] rounded-lg text-[10px] font-medium text-[#444746]">
                      <Tag className="w-3 h-3" />
                      {tx.category}
                    </div>
                    {editingId === tx.id ? (
                      <div className="flex items-center gap-1">
                        <select 
                          className="text-[10px] px-2 py-1 bg-white border border-[#d2d7dd] rounded-lg focus:ring-1 focus:ring-blue-500"
                          value={newCategory}
                          onChange={(e) => setNewCategory(e.target.value)}
                        >
                          {categories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <button 
                          onClick={() => handleCategorize(tx.id!, newCategory)}
                          className="p-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                        >
                          <CheckCircle className="w-3 h-3" />
                        </button>
                        <button 
                          onClick={() => setEditingId(null)}
                          className="p-1 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                        >
                          <XCircle className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => {
                          setEditingId(tx.id!);
                          setNewCategory(tx.category);
                        }}
                        className="text-[10px] text-blue-600 hover:underline font-medium opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        Change Category
                      </button>
                    )}
                  </div>
                  
                  {!tx.category && (
                    <button 
                      onClick={() => handleCategorize(tx.id!, suggestCategory(tx.merchantName))}
                      className="text-[9px] bg-blue-50 text-blue-600 px-2 py-1 rounded-lg font-bold hover:bg-blue-100 transition-colors"
                    >
                      Suggest: {suggestCategory(tx.merchantName)}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="bg-[#f0f4f9] p-6 rounded-full">
              <Database className="w-12 h-12 text-[#444746] opacity-40" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-[#1f1f1f]">No transactions found</p>
              <p className="text-xs text-gray-400 mt-1">Seed some data to get started</p>
            </div>
            <button 
              onClick={async () => {
                if (onSeed) {
                  setLoading(true);
                  await onSeed();
                  await fetchFilteredTransactions();
                }
              }}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-full text-xs font-bold hover:bg-blue-700 transition-all shadow-md active:scale-95"
            >
              Seed 1 Month Data
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default TransactionManager;
