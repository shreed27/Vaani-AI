import React, { useState, useEffect } from 'react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  limit,
  addDoc,
  getDocFromServer
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, Transaction, UserRole } from './types';
import { cn } from './lib/utils';
import VoiceAgent from './components/VoiceAgent';
import TransactionManager from './components/TransactionManager';
import { seedOneMonthData } from './services/seed';
import { handleFirestoreError, OperationType } from './utils/errorHandling';
import { 
  Store, 
  User as UserIcon, 
  LogOut, 
  Wallet, 
  TrendingUp, 
  PlusCircle,
  ShieldCheck,
  Zap,
  Clock,
  Menu,
  ChevronLeft, 
  Database,
  CheckCircle2,
  Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const App: React.FC = () => {
  const [user, setUser] = useState<any>({ uid: 'demo-user', displayName: 'Demo User' });
  const [profile, setProfile] = useState<UserProfile | null>({
    uid: 'demo-user',
    name: 'Demo User',
    role: 'merchant',
    createdAt: new Date().toISOString()
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState(false);
  const [autoAnnounce, setAutoAnnounce] = useState(false);
  const [activeView, setActiveView] = useState<'chat' | 'transactions'>('chat');

  useEffect(() => {
    // Auth is disabled as per request
    setLoading(false);
    setIsAuthReady(true);

    // Test connection to Firestore
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. ");
        }
      }
    };
    testConnection();
  }, []);

  useEffect(() => {
    if (!user || !profile) return;

    const field = profile.role === 'merchant' ? 'merchantId' : 'customerId';
    const q = query(
      collection(db, 'transactions'),
      where(field, '==', user.uid),
      orderBy('timestamp', 'desc'),
      limit(10)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
      setTransactions(txs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'transactions');
    });

    return () => unsubscribe();
  }, [user, profile]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      // Ensure user document exists
      const userDoc = await getDoc(doc(db, 'users', result.user.uid));
      if (!userDoc.exists()) {
        // Will trigger role selection
        setProfile(null);
      }
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleSelectRole = async (role: UserRole) => {
    if (!user) return;
    const newProfile: UserProfile = {
      uid: user.uid,
      name: user.displayName || 'User',
      role,
      email: user.email || undefined,
      createdAt: new Date().toISOString()
    };
    await setDoc(doc(db, 'users', user.uid), newProfile);
    setProfile(newProfile);
  };

  const generateDummyTransaction = async () => {
    if (!user || !profile) return;
    
    const merchants = ["Chai Point", "Sharma General Store", "Big Basket", "Uber", "Zomato"];
    const customers = ["Aman", "Rohit", "Sneha", "Priya", "Vikram"];
    const categories = ["food", "travel", "shopping", "bills", "groceries"];
    
    const isMerchant = profile.role === 'merchant';
    
    const tx: Transaction = {
      amount: Math.floor(Math.random() * 1000) + 10,
      currency: "INR",
      timestamp: new Date().toISOString(),
      merchantId: isMerchant ? user.uid : "dummy_merchant_" + Math.floor(Math.random() * 5),
      customerId: isMerchant ? "dummy_customer_" + Math.floor(Math.random() * 5) : user.uid,
      merchantName: isMerchant ? profile.name : merchants[Math.floor(Math.random() * merchants.length)],
      customerName: isMerchant ? customers[Math.floor(Math.random() * customers.length)] : profile.name,
      category: categories[Math.floor(Math.random() * categories.length)],
      status: Math.random() > 0.1 ? "success" : "failed",
      referenceId: "PAYTM" + Math.random().toString(36).substring(7).toUpperCase(),
      description: "Payment for services"
    };

    try {
      await addDoc(collection(db, 'transactions'), tx);
    } catch (error) {
      console.error("Failed to add transaction:", error);
    }
  };

  const handleSeedData = async () => {
    if (!user || !profile) return;
    setIsSeeding(true);
    try {
      await seedOneMonthData(user.uid, profile.role, profile.name);
      setSeedSuccess(true);
      setTimeout(() => setSeedSuccess(false), 3000);
    } catch (error) {
      console.error("Seeding failed:", error);
    } finally {
      setIsSeeding(false);
    }
  };

  if (loading || !profile || !user) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-white overflow-hidden font-sans">
      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ width: isSidebarOpen ? 280 : 0, opacity: isSidebarOpen ? 1 : 0 }}
        className="bg-[#f0f4f9] flex flex-col transition-all duration-300 border-r border-[#d2d7dd]/30 relative overflow-hidden"
      >
        <div className="w-[280px] h-full flex flex-col p-4">
          <div className="flex items-center gap-3 mb-8 px-2">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-sm ${
              profile.role === 'merchant' ? 'bg-blue-600' : 'bg-emerald-600'
            }`}>
              {profile.role === 'merchant' ? <Store className="w-5 h-5 text-white" /> : <Wallet className="w-5 h-5 text-white" />}
            </div>
            <h1 className="font-display font-semibold text-xl text-[#1f1f1f] tracking-tight">Vaani</h1>
          </div>

          <button 
            onClick={() => {
              setActiveView('chat');
              window.location.reload();
            }}
            className="flex items-center gap-3 px-4 py-3 bg-[#e1e5ea] hover:bg-[#d2d7dd] rounded-full text-sm font-medium text-[#444746] transition-all mb-6 shadow-sm active:scale-95"
          >
            <PlusCircle className="w-5 h-5" />
            New Chat
          </button>

          <div className="space-y-1 mb-6">
            <button 
              onClick={() => setActiveView('chat')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm transition-all ${
                activeView === 'chat' ? 'bg-[#e8f0fe] text-[#1967d2] font-medium' : 'hover:bg-[#e1e5ea] text-[#444746]'
              }`}
            >
              <Zap className={`w-4 h-4 ${activeView === 'chat' ? 'fill-[#1967d2]' : ''}`} />
              Vaani AI
            </button>
            <button 
              onClick={() => setActiveView('transactions')}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm transition-all ${
                activeView === 'transactions' ? 'bg-[#e8f0fe] text-[#1967d2] font-medium' : 'hover:bg-[#e1e5ea] text-[#444746]'
              }`}
            >
              <Database className={`w-4 h-4 ${activeView === 'transactions' ? 'fill-[#1967d2]' : ''}`} />
              Transactions
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar">
            <p className="px-4 text-[11px] font-bold text-[#444746] uppercase tracking-wider mb-2 opacity-60">Recent activity</p>
            {transactions.length > 0 ? (
              transactions.slice(0, 10).map((tx, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#e1e5ea] rounded-full text-sm text-[#1f1f1f] cursor-pointer truncate transition-colors group">
                  <Clock className="w-4 h-4 text-[#444746] shrink-0 group-hover:text-blue-500" />
                  <span className="truncate">₹{tx.amount} • {tx.customerName || tx.merchantName}</span>
                </div>
              ))
            ) : (
              <p className="px-4 text-xs text-[#444746] italic">No recent transactions</p>
            )}
          </div>

          <div className="mt-auto pt-4 border-t border-[#d2d7dd] space-y-1">
            <button 
              onClick={handleSeedData}
              disabled={isSeeding}
              className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-full text-sm transition-all active:scale-95 ${
                seedSuccess ? 'bg-emerald-50 text-emerald-600' : 'hover:bg-[#e1e5ea] text-[#444746]'
              }`}
            >
              {isSeeding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : seedSuccess ? (
                <CheckCircle2 className="w-4 h-4" />
              ) : (
                <Database className="w-4 h-4" />
              )}
              {seedSuccess ? "Data Seeded!" : "Seed Demo Data"}
            </button>
            <div 
              onClick={() => setAutoAnnounce(!autoAnnounce)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-full text-sm cursor-pointer transition-all active:scale-95 ${
                autoAnnounce ? 'bg-[#e8f0fe] text-[#1967d2] font-medium' : 'hover:bg-[#e1e5ea] text-[#444746]'
              }`}
            >
              <Zap className={`w-4 h-4 ${autoAnnounce ? 'fill-[#1967d2]' : ''}`} />
              Auto-Announce
            </div>
            <div 
              onClick={() => {
                const newRole = profile.role === 'merchant' ? 'customer' : 'merchant';
                setProfile({ ...profile, role: newRole });
              }}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#e1e5ea] rounded-full text-sm text-[#444746] cursor-pointer transition-colors"
            >
              <UserIcon className="w-4 h-4" />
              Switch to {profile.role === 'merchant' ? 'Customer' : 'Merchant'}
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
        {activeView !== 'chat' && (
          <header className="h-16 flex items-center justify-between px-6 shrink-0 z-20">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                className="p-2 text-[#444746] hover:bg-[#f0f4f9] rounded-full transition-all"
              >
                {isSidebarOpen ? <ChevronLeft className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
              <div className={`px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                profile.role === 'merchant' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'
              }`}>
                {profile.role === 'merchant' ? 'Merchant Mode' : 'Personal Finance'}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-blue-100 to-purple-100 flex items-center justify-center text-blue-700 font-bold text-sm shadow-sm border border-white">
                {profile.name[0]}
              </div>
            </div>
          </header>
        )}

        {/* Floating Navigation for Chat View */}
        {activeView === 'chat' && (
          <div className="absolute top-8 left-1/2 -translate-x-1/2 z-50 flex bg-[#f0f4f9]/80 backdrop-blur-xl p-1 rounded-2xl border border-white/20 shadow-lg">
            <button 
              onClick={() => setActiveView('chat')}
              className={cn(
                "px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                activeView === 'chat' ? "bg-white text-zinc-900 shadow-sm" : "text-[#444746] hover:text-zinc-900"
              )}
            >
              Vaani
            </button>
            <button 
              onClick={() => setActiveView('transactions')}
              className={cn(
                "px-6 py-2 rounded-xl text-xs font-bold uppercase tracking-widest transition-all",
                activeView === 'transactions' ? "bg-white text-zinc-900 shadow-sm" : "text-[#444746] hover:text-zinc-900"
              )}
            >
              Data
            </button>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center px-4 overflow-y-auto custom-scrollbar">
          <div className="w-full max-w-4xl flex flex-col items-center py-12">
            <AnimatePresence mode="wait">
              {activeView === 'chat' ? (
                <motion.div 
                  key="chat"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="w-full flex flex-col items-center"
                >
                  {/* The Central Orb Agent - Now the only thing in Chat View */}
                  <div className="w-full h-[60vh] flex items-center justify-center">
                    <VoiceAgent userId={user.uid} role={profile.role} userName={profile.name} autoAnnounce={autoAnnounce} />
                  </div>
                </motion.div>
              ) : (
                <motion.div 
                  key="transactions"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="w-full"
                >
                  <TransactionManager 
                    userId={user.uid} 
                    role={profile.role} 
                    initialTransactions={transactions} 
                    onSeed={() => seedOneMonthData(user.uid, profile.role, profile.name)}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {activeView !== 'chat' && (
          <footer className="p-6 text-center shrink-0">
            <p className="text-[11px] text-[#444746] opacity-60 max-w-md mx-auto">
              Experimental AI. It can provide insights on your payments and finance. Always verify important financial info.
            </p>
          </footer>
        )}
      </main>
    </div>
  );
};

const FileText = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <line x1="10" y1="9" x2="8" y2="9" />
  </svg>
);

export default App;
