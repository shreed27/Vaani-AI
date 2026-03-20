import { collection, addDoc, writeBatch, doc } from "firebase/firestore";
import { db } from "../firebase";
import { Transaction } from "../types";

export const seedOneMonthData = async (userId: string, role: 'merchant' | 'customer', userName: string) => {
  const batch = writeBatch(db);
  const transactions: Transaction[] = [];
  
  const startDate = new Date("2026-02-20T00:00:00Z");
  const endDate = new Date("2026-03-20T23:59:59Z");
  
  const merchants = ["Chai Point", "Sharma General Store", "Big Basket", "Uber", "Zomato", "Amazon", "Swiggy", "Reliance Fresh", "Apollo Pharmacy", "Petrol Pump"];
  const customers = ["Aman", "Rohit", "Sneha", "Priya", "Vikram", "Karan", "Anjali", "Siddharth", "Megha", "Rahul"];
  const categories = ["food", "travel", "shopping", "bills", "groceries", "health", "entertainment"];
  
  const isMerchant = role === 'merchant';
  
  // Generate ~60 transactions (2 per day on average)
  for (let i = 0; i < 60; i++) {
    const randomTime = startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime());
    const timestamp = new Date(randomTime).toISOString();
    
    const tx: Transaction = {
      amount: Math.floor(Math.random() * 2000) + 20,
      currency: "INR",
      timestamp,
      merchantId: isMerchant ? userId : "dummy_merchant_" + Math.floor(Math.random() * 10),
      customerId: isMerchant ? "dummy_customer_" + Math.floor(Math.random() * 10) : userId,
      merchantName: isMerchant ? userName : merchants[Math.floor(Math.random() * merchants.length)],
      customerName: isMerchant ? customers[Math.floor(Math.random() * customers.length)] : userName,
      category: categories[Math.floor(Math.random() * categories.length)],
      status: Math.random() > 0.15 ? "success" : "failed",
      referenceId: "PAYTM" + Math.random().toString(36).substring(7).toUpperCase(),
      description: "Demo transaction for testing"
    };
    
    const docRef = doc(collection(db, 'transactions'));
    batch.set(docRef, tx);
  }
  
  await batch.commit();
  console.log("Successfully seeded 60 transactions.");
};
