import { Types } from 'mongoose';
import { AuctionRecord } from '../../auctions/interfaces/auction.interface';
import { ReminderDocument } from '../schemas/reminder.schema';

/** The auction populated into a reminder; null when the referenced auction no longer exists. */
export type ReminderAuction = (AuctionRecord & { _id: Types.ObjectId }) | null;

/** A reminder read with `.populate('auction')`. */
export type PopulatedReminder = Omit<ReminderDocument, 'auction'> & { auction: ReminderAuction };
