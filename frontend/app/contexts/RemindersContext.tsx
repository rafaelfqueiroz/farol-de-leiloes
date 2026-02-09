'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';

export type ReminderChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';
export type ReminderStatus = 'PENDING' | 'SENT';

export interface Reminder {
  _id: string;
  channel: ReminderChannel;
  scheduledAt: string;
  description: string | null;
  status: ReminderStatus;
  createdAt: string;
  auction: {
    _id: string;
    code: string;
    title: string | null;
    city: string | null;
    state: string | null;
    detailsUrl: string | null;
  };
}

export interface CreateReminderData {
  auctionId: string;
  channel: ReminderChannel;
  scheduledAt: string;
  description?: string;
}

interface RemindersContextType {
  reminders: Reminder[];
  loading: boolean;
  hasReminderForAuction: (auctionCode: string) => boolean;
  getReminderForAuction: (auctionCode: string) => Reminder | undefined;
  createReminder: (data: CreateReminderData) => Promise<Reminder | null>;
  deleteReminder: (id: string) => Promise<boolean>;
  refreshReminders: () => Promise<void>;
}

const RemindersContext = createContext<RemindersContextType | undefined>(undefined);

export function RemindersProvider({ children }: { children: ReactNode }) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('token');
    if (!token) return {};
    return { 'Authorization': `Bearer ${token}` };
  };

  const loadReminders = useCallback(async () => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }

      const response = await fetch('/api/reminders', {
        headers: getAuthHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        setReminders(data);
      } else if (response.status === 401) {
        setReminders([]);
      }
    } catch (error) {
      console.error('Error loading reminders:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReminders();
  }, [loadReminders]);

  const hasReminderForAuction = (auctionCode: string): boolean => {
    return reminders.some(r => r.auction.code === auctionCode);
  };

  const getReminderForAuction = (auctionCode: string): Reminder | undefined => {
    return reminders.find(r => r.auction.code === auctionCode);
  };

  const createReminder = async (data: CreateReminderData): Promise<Reminder | null> => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return null;
    }

    try {
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        const newReminder = await response.json();
        setReminders(prev => [...prev, newReminder]);
        return newReminder;
      } else if (response.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      } else {
        const errorData = await response.json().catch(() => ({}));
        console.error('Error creating reminder:', response.status, errorData);
      }
    } catch (error) {
      console.error('Error creating reminder:', error);
    }

    return null;
  };

  const deleteReminder = async (id: string): Promise<boolean> => {
    const token = localStorage.getItem('token');
    if (!token) {
      router.push('/login');
      return false;
    }

    try {
      const response = await fetch(`/api/reminders/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });

      if (response.ok || response.status === 204) {
        setReminders(prev => prev.filter(r => r._id !== id));
        return true;
      } else if (response.status === 401) {
        localStorage.removeItem('token');
        router.push('/login');
      }
    } catch (error) {
      console.error('Error deleting reminder:', error);
    }

    return false;
  };

  const refreshReminders = async () => {
    setLoading(true);
    await loadReminders();
  };

  return (
    <RemindersContext.Provider
      value={{
        reminders,
        loading,
        hasReminderForAuction,
        getReminderForAuction,
        createReminder,
        deleteReminder,
        refreshReminders,
      }}
    >
      {children}
    </RemindersContext.Provider>
  );
}

export function useReminders() {
  const context = useContext(RemindersContext);
  if (context === undefined) {
    throw new Error('useReminders must be used within a RemindersProvider');
  }
  return context;
}
