import { GoogleGenAI, Modality, LiveServerMessage, Type } from "@google/genai";
import { collection, query, where, getDocs, orderBy, limit, Timestamp } from "firebase/firestore";
import { db } from "../firebase";
import { Transaction } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

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
  }
) => {
  const transactionsRef = collection(db, "transactions");
  const field = role === 'merchant' ? 'merchantId' : 'customerId';
  
  const now = new Date();
  const startTime = new Date(now.getTime() - (filters.days || 30) * 24 * 60 * 60 * 1000);
  
  let q = query(
    transactionsRef,
    where(field, "==", userId),
    where("timestamp", ">=", startTime.toISOString()),
    orderBy("timestamp", "desc")
  );
  
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
  
  return results.slice(0, 20);
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
        description: "Advanced filtering for transactions. Use this for queries like 'Show me all food expenses between ₹500 and ₹1000 from last week'.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING, description: "Category of expense (food, travel, etc.)" },
            minAmount: { type: Type.NUMBER, description: "Minimum amount" },
            maxAmount: { type: Type.NUMBER, description: "Maximum amount" },
            days: { type: Type.NUMBER, description: "Number of days to look back" }
          }
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
      }
    ]
  }
];

export const createLiveSession = (userId: string, role: 'merchant' | 'customer', callbacks: any) => {
  const systemInstruction = role === 'merchant' 
    ? "You are Dukaan Dost, an AI Voice Assistant for merchants. You are a conversational AI. Speak naturally in Hinglish, keep responses short and engaging, and interrupt if necessary. You help them track payments, verify transactions, and manage their shop. Use the tools provided to query the transaction database. When a merchant asks '₹500 aaya kya?', use verifyPayment. When they ask 'Aaj kitna hua?', use getSummary. For disputes like 'Is ₹500 ka payment hua ya nahi?', use checkDispute. When they ask for a report like 'Aaj ka report bhej do', use generateReport. Be proactive: if you see a failed payment, mention it."
    : "You are Dukaan Dost, a Personal Finance AI Assistant. You are a conversational AI. Speak naturally in Hinglish, keep responses short and engaging, and interrupt if necessary. You help users track their spending, categorize expenses, and manage their money. Be proactive with insights and helpful with queries like 'Food pe kitna kharcha hua?'. Use 'queryTransactions' for advanced filters like 'Show me all food expenses between ₹500 and ₹1000 from last week'. If you notice a spike in spending, bring it up conversationally.";

  return ai.live.connect({
    model: "gemini-2.5-flash-native-audio-preview-12-2025",
    callbacks,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
      },
      systemInstruction,
      tools
    },
  });
};
