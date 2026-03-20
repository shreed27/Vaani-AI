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
  addDoc
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { UserProfile, Transaction, UserRole } from './types';
import VoiceAgent from './components/VoiceAgent';
import { seedOneMonthData } from './services/seed';
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
  CheckCircle2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const App: React.FC = () => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState(false);
  const [autoAnnounce, setAutoAnnounce] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const userDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        if (userDoc.exists()) {
          setProfile(userDoc.data() as UserProfile);
        }
      } else {
        setProfile(null);
      }
      setIsAuthReady(true);
      setLoading(false);
    });
    return () => unsubscribe();
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
      console.error("Firestore error:", error);
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

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-md w-full bg-white rounded-[2.5rem] p-10 shadow-2xl shadow-blue-100 border border-zinc-100 text-center space-y-8"
        >
          <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto shadow-lg shadow-blue-200 rotate-3">
            <Zap className="w-10 h-10 text-white" />
          </div>
          <div className="space-y-2">
            <h1 className="text-4xl font-black text-zinc-900 tracking-tight">Dukaan Dost</h1>
            <p className="text-zinc-500 font-medium">Your AI Voice Agent for Payments & Finance</p>
          </div>
          <button 
            onClick={handleLogin}
            className="w-full bg-zinc-900 text-white py-4 rounded-2xl font-bold hover:bg-zinc-800 transition-all flex items-center justify-center gap-3 shadow-xl shadow-zinc-200"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>
          <div className="pt-4 flex items-center justify-center gap-6 text-zinc-400">
            <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest">
              <ShieldCheck className="w-4 h-4" /> Secure
            </div>
            <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-widest">
              <Zap className="w-4 h-4" /> Real-time
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full space-y-8">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-bold text-zinc-900">Welcome, {user.displayName}!</h2>
            <p className="text-zinc-500">How would you like to use Dukaan Dost?</p>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <button 
              onClick={() => handleSelectRole('merchant')}
              className="group bg-white p-8 rounded-[2rem] border-2 border-transparent hover:border-blue-500 transition-all text-left shadow-sm hover:shadow-xl"
            >
              <div className="w-14 h-14 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Store className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900">I am a Merchant</h3>
              <p className="text-zinc-500 text-sm mt-1">AI Soundbox 2.0. Track shop payments with voice.</p>
            </button>
            <button 
              onClick={() => handleSelectRole('customer')}
              className="group bg-white p-8 rounded-[2rem] border-2 border-transparent hover:border-emerald-500 transition-all text-left shadow-sm hover:shadow-xl"
            >
              <div className="w-14 h-14 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <UserIcon className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-zinc-900">I am a User</h3>
              <p className="text-zinc-500 text-sm mt-1">Personal Finance AI. Track your spending & insights.</p>
            </button>
          </div>
        </div>
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
            <h1 className="font-display font-semibold text-xl text-[#1f1f1f] tracking-tight">Dukaan Dost</h1>
          </div>

          <button 
            onClick={() => window.location.reload()}
            className="flex items-center gap-3 px-4 py-3 bg-[#e1e5ea] hover:bg-[#d2d7dd] rounded-full text-sm font-medium text-[#444746] transition-all mb-6 shadow-sm active:scale-95"
          >
            <PlusCircle className="w-5 h-5" />
            New Chat
          </button>

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
              onClick={() => signOut(auth)}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#e1e5ea] rounded-full text-sm text-[#444746] cursor-pointer transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative bg-white overflow-hidden">
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

        <div className="flex-1 flex flex-col items-center justify-center px-4 overflow-y-auto custom-scrollbar">
          <div className="w-full max-w-4xl flex flex-col items-center py-12">
            {/* Greeting */}
            <div className="text-center mb-16">
              <h2 className="text-5xl md:text-7xl font-display font-medium leading-tight gemini-gradient-text tracking-tight">
                Hello, {profile.name.split(' ')[0]}
              </h2>
              <h3 className="text-2xl md:text-4xl font-display font-medium leading-tight text-[#c4c7c5] mt-3 opacity-80">
                I'm your {profile.role === 'merchant' ? 'Dukaan Dost' : 'Finance Buddy'}
              </h3>
            </div>

            {/* The Central Orb Agent */}
            <div className="w-full flex justify-center">
              <VoiceAgent userId={user.uid} role={profile.role} userName={profile.name} autoAnnounce={autoAnnounce} />
            </div>

            {/* Suggestions Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full max-w-3xl mt-16">
              {[
                { icon: <TrendingUp className="w-5 h-5 text-blue-500" />, text: profile.role === 'merchant' ? "Aaj kitna dhanda hua?" : "Food pe kitna kharcha hua?" },
                { icon: <ShieldCheck className="w-5 h-5 text-emerald-500" />, text: profile.role === 'merchant' ? "₹500 aaya kya?" : "Last week summary" },
                { icon: <FileText className="w-5 h-5 text-orange-500" />, text: profile.role === 'merchant' ? "Aaj ka report bhej do" : "₹500-1000 expenses" },
                { icon: <Zap className="w-5 h-5 text-purple-500" />, text: profile.role === 'merchant' ? "Is payment missing?" : "Top category" }
              ].map((card, i) => (
                <motion.div 
                  key={i} 
                  whileHover={{ y: -4, backgroundColor: '#f8fafd' }}
                  className="suggestion-card p-5 rounded-3xl cursor-pointer flex flex-col justify-between h-36 border border-[#f0f4f9] hover:border-[#d2d7dd] transition-all shadow-sm"
                >
                  <p className="text-sm text-[#1f1f1f] font-medium leading-relaxed line-clamp-3">{card.text}</p>
                  <div className="self-end bg-white p-2 rounded-xl shadow-sm border border-[#f0f4f9]">
                    {card.icon}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>

        <footer className="p-6 text-center shrink-0">
          <p className="text-[11px] text-[#444746] opacity-60 max-w-md mx-auto">
            Dukaan Dost is an experimental AI. It can provide insights on your payments and finance. Always verify important financial info.
          </p>
        </footer>
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

const Loader2 = ({ className }: { className?: string }) => (
  <svg className={className} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </svg>
);

export default App;
