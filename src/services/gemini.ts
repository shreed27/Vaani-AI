import { GoogleGenAI, Modality, LiveServerMessage, Type } from "@google/genai";
import { collection, query, where, getDocs, orderBy, limit, Timestamp, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Transaction } from "../types";

const getAI = () => {
  const apiKey = (process.env as any).API_KEY || process.env.GEMINI_API_KEY || (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Gemini API Key is missing! Please set GEMINI_API_KEY in your environment.");
  }
  return new GoogleGenAI({ apiKey: apiKey || '' });
};

export const getTransactions = async (userId: string, role: 'merchant' | 'customer', days: number = 1) => {
  const transactionsRef = collection(db, "transactions");
  const field = role === 'merchant' ? 'merchantId' : 'customerId';
  
  const now = new Date();
  const startTime = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  
  const q = query(
    transactionsRef,
    where(field, "==", userId),
    where("timestamp", ">=", startTime.toISOString()),
    orderBy("timestamp", "desc"),
    limit(20)
  );
  
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
};

export const getSummary = async (userId: string, role: 'merchant' | 'customer', period: 'today' | 'week' | 'month' = 'today') => {
  const transactions = await getTransactions(userId, role, period === 'today' ? 1 : period === 'week' ? 7 : 30);
  const total = transactions.reduce((sum, t) => sum + (t.status === 'success' ? t.amount : 0), 0);
  return {
    total,
    count: transactions.length,
    period
  };
};

export const verifyPayment = async (userId: string, amount: number, timeWindowMinutes: number = 10) => {
  const transactionsRef = collection(db, "transactions");
  const now = new Date();
  const startTime = new Date(now.getTime() - timeWindowMinutes * 60 * 1000);
  
  const q = query(
    transactionsRef,
    where("merchantId", "==", userId),
    where("amount", "==", amount),
    where("timestamp", ">=", startTime.toISOString()),
    where("status", "==", "success"),
    orderBy("timestamp", "desc")
  );
  
  const querySnapshot = await getDocs(q);
  return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
};

export const queryTransactions = async (
  userId: string, 
  role: 'merchant' | 'customer', 
  filters: { 
    category?: string; 
    minAmount?: number; 
    maxAmount?: number; 
    days?: number;
    startDate?: string;
    endDate?: string;
    status?: 'success' | 'failed' | 'pending';
    referenceId?: string;
  }
) => {
  const transactionsRef = collection(db, "transactions");
  const field = role === 'merchant' ? 'merchantId' : 'customerId';
  
  let q = query(
    transactionsRef,
    where(field, "==", userId),
    orderBy("timestamp", "desc")
  );

  if (filters.startDate) {
    q = query(q, where("timestamp", ">=", filters.startDate));
  } else if (filters.days) {
    const now = new Date();
    const startTime = new Date(now.getTime() - filters.days * 24 * 60 * 60 * 1000);
    q = query(q, where("timestamp", ">=", startTime.toISOString()));
  }

  if (filters.endDate) {
    q = query(q, where("timestamp", "<=", filters.endDate));
  }

  if (filters.status) {
    q = query(q, where("status", "==", filters.status));
  }

  if (filters.referenceId) {
    q = query(q, where("referenceId", "==", filters.referenceId));
  }
  
  const querySnapshot = await getDocs(q);
  let results = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction));
  
  if (filters.category) {
    results = results.filter(t => t.category.toLowerCase() === filters.category!.toLowerCase());
  }
  if (filters.minAmount !== undefined) {
    results = results.filter(t => t.amount >= filters.minAmount!);
  }
  if (filters.maxAmount !== undefined) {
    results = results.filter(t => t.amount <= filters.maxAmount!);
  }
  
  return results.slice(0, 50);
};

export const categorizeTransaction = async (transactionId: string, category: string) => {
  const transactionRef = doc(db, "transactions", transactionId);
  await updateDoc(transactionRef, { category });
  return { success: true, message: `Transaction categorized as ${category}` };
};

export const suggestCategory = (merchantName: string): string => {
  const name = merchantName.toLowerCase();
  if (name.includes('swiggy') || name.includes('zomato') || name.includes('restaurant') || name.includes('food')) return 'Food';
  if (name.includes('uber') || name.includes('ola') || name.includes('petrol') || name.includes('fuel')) return 'Travel';
  if (name.includes('amazon') || name.includes('flipkart') || name.includes('myntra') || name.includes('mall')) return 'Shopping';
  if (name.includes('jio') || name.includes('airtel') || name.includes('recharge') || name.includes('bill')) return 'Bills';
  if (name.includes('hospital') || name.includes('pharmacy') || name.includes('medical')) return 'Health';
  return 'General';
};

export const getTopCategory = async (userId: string, role: 'merchant' | 'customer', period: 'today' | 'week' | 'month' = 'month') => {
  const days = period === 'today' ? 1 : period === 'week' ? 7 : 30;
  const transactions = await getTransactions(userId, role, days);
  
  if (transactions.length === 0) return { message: "No transactions found for this period." };
  
  const categoryTotals: Record<string, number> = {};
  transactions.forEach(t => {
    if (t.status === 'success') {
      categoryTotals[t.category] = (categoryTotals[t.category] || 0) + t.amount;
    }
  });
  
  const topCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0];
  
  if (!topCategory) return { message: "No successful transactions found." };
  
  return {
    category: topCategory[0],
    amount: topCategory[1],
    period
  };
};

export const checkDispute = async (userId: string, amount: number, referenceId?: string) => {
  const transactionsRef = collection(db, "transactions");
  
  let q = query(
    transactionsRef,
    where("merchantId", "==", userId),
    where("amount", "==", amount),
    where("status", "==", "success")
  );
  
  if (referenceId) {
    q = query(q, where("referenceId", "==", referenceId));
  }
  
  const querySnapshot = await getDocs(q);
  if (querySnapshot.empty) {
    // Check for failed payments
    const failedQ = query(
      transactionsRef,
      where("merchantId", "==", userId),
      where("amount", "==", amount),
      where("status", "==", "failed")
    );
    const failedSnapshot = await getDocs(failedQ);
    if (!failedSnapshot.empty) {
      return { status: "failed", count: failedSnapshot.size, message: "Found failed payments for this amount." };
    }
    return { status: "missing", message: "No payment found for this amount." };
  }
  
  return { status: "success", count: querySnapshot.size, message: "Payment verified successfully." };
};

export const tools = [
  {
    functionDeclarations: [
      {
        name: "getTransactions",
        description: "Get recent transactions for the user. Use this to answer queries about recent payments, last transaction, etc.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            days: { type: Type.NUMBER, description: "Number of days to look back (default 1)" }
          }
        }
      },
      {
        name: "getSummary",
        description: "Get a summary of total earnings or spending for a specific period.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            period: { type: Type.STRING, enum: ["today", "week", "month"], description: "The period for the summary" }
          }
        }
      },
      {
        name: "verifyPayment",
        description: "Verify if a specific amount was received recently. Use this for queries like '₹500 aaya kya?'",
        parameters: {
          type: Type.OBJECT,
          properties: {
            amount: { type: Type.NUMBER, description: "The amount to verify" },
            timeWindowMinutes: { type: Type.NUMBER, description: "Minutes to look back (default 10)" }
          },
          required: ["amount"]
        }
      },
      {
        name: "queryTransactions",
        description: "Advanced filtering for transactions. Use this for queries like 'Show me all food expenses between ₹500 and ₹1000 from last week' or 'Find transaction with reference ID 123'.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, description: "Category of expense (food, travel, etc.)" },
            minAmount: { type: Type.NUMBER, description: "Minimum amount" },
            maxAmount: { type: Type.NUMBER, description: "Maximum amount" },
            days: { type: Type.NUMBER, description: "Number of days to look back" },
            startDate: { type: Type.STRING, description: "Start date in ISO format" },
            endDate: { type: Type.STRING, description: "End date in ISO format" },
            status: { type: Type.STRING, enum: ["success", "failed", "pending"], description: "Transaction status" },
            referenceId: { type: Type.STRING, description: "Reference ID of the transaction" }
          }
        }
      },
      {
        name: "categorizeTransaction",
        description: "Manually categorize a transaction.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            transactionId: { type: Type.STRING, description: "The ID of the transaction" },
            category: { type: Type.STRING, description: "The new category" }
          },
          required: ["transactionId", "category"]
        }
      },
      {
        name: "checkDispute",
        description: "Check if a specific payment was received or is missing. Use this for queries like 'Is ₹500 ka payment hua ya nahi?'",
        parameters: {
          type: Type.OBJECT,
          properties: {
            amount: { type: Type.NUMBER, description: "The amount to check" },
            referenceId: { type: Type.STRING, description: "Optional reference ID" }
          },
          required: ["amount"]
        }
      },
      {
        name: "generateReport",
        description: "Generate a daily report of transactions. Use this when the merchant says 'Aaj ka report bhej do'.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            period: { type: Type.STRING, enum: ["today", "yesterday"], description: "The period for the report" }
          }
        }
      },
      {
        name: "getTopCategory",
        description: "Identify the category with the highest spending or most transactions.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            period: { type: Type.STRING, enum: ["today", "week", "month"], description: "The period to analyze" }
          }
        }
      }
    ]
  }
];

export const createLiveSession = (userId: string, role: 'merchant' | 'customer', callbacks: any) => {
  console.log("Connecting to Vaani Live Session via Backend...");
  console.log("UserId:", userId, "Role:", role);
  
  // Helper for retrying fetch calls
  const fetchWithRetry = async (url: string, options?: RequestInit, retries = 3, delay = 1000): Promise<Response> => {
    try {
      const response = await fetch(url, options);
      if (!response.ok && retries > 0) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (err) {
      if (retries > 0) {
        console.warn(`Fetch failed for ${url}, retrying in ${delay}ms... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchWithRetry(url, options, retries - 1, delay * 2);
      }
      throw err;
    }
  };

  // Verify backend health with retry
  const healthUrl = `${window.location.origin}/api/health`;
  fetchWithRetry(healthUrl)
    .then(r => r.json())
    .then(d => console.log("Backend Status:", d.status))
    .catch(err => console.error("Backend Health Check Failed after retries:", err));

  const merchantPrompt = `
    You are Vaani, an expert AI Voice Assistant for Indian merchants. 
    Your personality is helpful, professional, yet friendly. 
    You speak naturally in Hinglish (a mix of Hindi and English).
    
    CORE CAPABILITIES:
    - Track payments and verify transactions in real-time.
    - Provide daily, weekly, and monthly summaries.
    - Handle disputes and verify specific payment amounts.
    - Generate PDF reports on request.
    - Search transactions with granular filters (status, date range, reference ID).

    HINGLISH GUIDELINES:
    - Use common phrases like "Theek hai", "Bilkul", "Zaroor", "Aapka swagat hai".
    - Mix Hindi and English naturally: "Aapka ₹500 ka payment success ho gaya hai" instead of "Your payment of 500 is successful".
    - Keep responses concise for voice interaction.

    SPECIFIC SCENARIOS:
    - If a merchant asks "₹500 aaya kya?", use verifyPayment.
    - If they ask "Aaj ki kamai?", use getSummary for 'today'.
    - If they want a report, use generateReport.
    - If a payment fails, inform them immediately: "Maaf kijiye, ₹200 ka payment fail ho gaya hai reference ID XYZ ke liye."
    - For complex searches like "Show me all failed payments from yesterday", use queryTransactions with status='failed' and appropriate dates.
  `;

  const customerPrompt = `
    You are Vaani, a smart Personal Finance Assistant.
    You help users manage their expenses and savings.
    You speak naturally in Hinglish.

    CORE CAPABILITIES:
    - Track spending across categories (Food, Travel, Shopping, etc.).
    - Provide spending insights and alerts.
    - Help users find specific transactions using filters (amount, date, status).
    - Analyze spending patterns to find top categories.

    HINGLISH GUIDELINES:
    - Use phrases like "Aapne kaafi kharcha kiya hai", "Bachhat zaroori hai".
    - Mix naturally: "Food pe aapne ₹2000 kharch kiye hain is mahine".

    SPECIFIC SCENARIOS:
    - If they ask "Food pe kitna kharcha hua?", use queryTransactions with category='Food'.
    - If they ask "Last week kitna spend kiya?", use getSummary for 'week'.
    - If they ask "Mera sabse zyada kharcha kahan ho raha hai?", use getTopCategory.
    - For complex queries like "Find my Amazon transactions above ₹1000 from last month", use queryTransactions with merchantName='Amazon' (if supported) or filter results.
    - Be proactive: "Aapka is mahine ka budget cross ho raha hai, thoda dhyan rakhiye."
  `;

  const systemInstruction = role === 'merchant' ? merchantPrompt : customerPrompt;

  // Retry mechanism for transient network issues
  const connectWithRetry = async (retries = 3, delay = 1000): Promise<any> => {
    try {
      // Create a new GoogleGenAI instance right before making an API call to ensure it always uses the most up-to-date API key
      const ai = getAI();
      return await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        callbacks,
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
          },
          systemInstruction,
          tools,
          outputAudioTranscription: {},
          inputAudioTranscription: {}
        },
      });
    } catch (err) {
      if (retries > 0) {
        console.warn(`Connection failed, retrying in ${delay}ms... (${retries} left)`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return connectWithRetry(retries - 1, delay * 2);
      }
      throw err;
    }
  };

  return connectWithRetry();
};
