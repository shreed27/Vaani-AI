export type UserRole = 'merchant' | 'customer';

export interface UserProfile {
  uid: string;
  name: string;
  role: UserRole;
  email?: string;
  createdAt: string;
}

export interface Transaction {
  id?: string;
  amount: number;
  currency: string;
  timestamp: string;
  merchantId: string;
  customerId: string;
  customerName: string;
  merchantName: string;
  category: string;
  status: 'success' | 'failed' | 'pending';
  referenceId: string;
  description?: string;
}

export interface VoiceAgentConfig {
  role: UserRole;
  userName: string;
  userId: string;
}
