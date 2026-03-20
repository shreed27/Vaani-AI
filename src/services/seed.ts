import { collection, addDoc, writeBatch, doc } from "firebase/firestore";
import { db } from "../firebase";
import { Transaction } from "../types";
import { suggestCategory } from "./gemini";

export const seedOneMonthData = async (userId: string, role: 'merchant' | 'customer', userName: string) => {
  const batch = writeBatch(db);
  const transactions: Transaction[] = [];
  
  const startDate = new Date("2026-02-20T00:00:00Z");
  const endDate = new Date("2026-03-20T23:59:59Z");
  
  const merchants = ["Chai Point", "Sharma General Store", "Big Basket", "Uber", "Zomato", "Amazon", "Swiggy", "Reliance Fresh", "Apollo Pharmacy", "Petrol Pump"];
  const customers = ["Aman", "Rohit", "Sneha", "Priya", "Vikram", "Karan", "Anjali", "Siddharth", "Megha", "Rahul"];
  const categories = ["food", "travel", "shopping", "bills", "groceries", "health", "entertainment"];
  
  const isMerchant = role === 'merchant';
  
  // Generate ~100 transactions (3-4 per day on average)
  for (let i = 0; i < 100; i++) {
    const randomTime = startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime());
    const timestamp = new Date(randomTime).toISOString();
    
    const merchant = merchants[Math.floor(Math.random() * merchants.length)];
    const customer = customers[Math.floor(Math.random() * customers.length)];
    
    const tx: Transaction = {
      amount: Math.floor(Math.random() * 5000) + 10,
      currency: "INR",
      timestamp,
      merchantId: isMerchant ? userId : "dummy_merchant_" + Math.floor(Math.random() * 10),
      customerId: isMerchant ? "dummy_customer_" + Math.floor(Math.random() * 10) : userId,
      merchantName: isMerchant ? userName : merchant,
      customerName: isMerchant ? customer : userName,
      category: suggestCategory(isMerchant ? userName : merchant),
      status: Math.random() > 0.1 ? "success" : "failed",
      referenceId: "TXN" + Math.random().toString(36).substring(2, 10).toUpperCase(),
      description: `Payment at ${isMerchant ? userName : merchant}`
    };
    
    const docRef = doc(collection(db, 'transactions'));
    batch.set(docRef, tx);
  }
  
  await batch.commit();
  console.log("Successfully seeded 60 transactions.");
};
