import { DayAIClient } from '../../../day-ai-sdk/dist/src/index.js';
import { MailchimpContact } from './mailchimp.js';

export interface SyncResult {
  total: number;
  synced: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
}

export interface SyncOptions {
  dryRun?: boolean;
  onProgress?: (current: number, total: number, email: string) => void;
}

export interface ExistingContactsResult {
  emails: Set<string>;
  totalFetched: number;
}

export interface FilterResult {
  newContacts: MailchimpContact[];
  skippedCount: number;
}

/**
 * Fetches all existing Day.ai contacts and returns a Set of their emails.
 * Uses pagination to handle large contact lists.
 */
export async function fetchExistingDayAiEmails(
  dayClient: DayAIClient,
  onProgress?: (fetched: number, hasMore: boolean) => void
): Promise<ExistingContactsResult> {
  const emails = new Set<string>();
  let currentOffset: number | undefined = undefined;
  let hasMore = true;
  let pageCount = 0;

  while (hasMore) {
    pageCount++;

    const response = await dayClient.mcpCallTool('search_objects', {
      offset: currentOffset,
      queries: [{
        objectType: 'native_contact'
      }]
    });

    if (!response.success) {
      throw new Error(response.error || 'Failed to fetch Day.ai contacts');
    }

    // Parse the MCP response - it's a JSON string in content[0].text
    const textContent = response.data?.content?.[0]?.text;
    if (!textContent) {
      throw new Error('Invalid response format from Day.ai');
    }

    const data = JSON.parse(textContent) as {
      hasMore?: boolean;
      nextOffset?: number;
      native_contact?: {
        results: Array<{
          objectId: string;
          email?: string;
          [key: string]: unknown;
        }>;
      };
    };

    // Extract emails from results
    const contacts = data.native_contact?.results || [];
    for (const contact of contacts) {
      if (contact.email) {
        emails.add(contact.email.toLowerCase());
      }
    }

    // Report progress
    if (onProgress) {
      onProgress(emails.size, data.hasMore ?? false);
    }

    // Update pagination state
    hasMore = data.hasMore ?? false;
    currentOffset = data.nextOffset;

    // Safety limit to prevent infinite loops
    if (pageCount > 100) {
      console.warn('Warning: Stopped after 100 pages for safety');
      break;
    }
  }

  return {
    emails,
    totalFetched: emails.size
  };
}

/**
 * Filters Mailchimp contacts to only include those not already in Day.ai.
 */
export function filterNewContacts(
  mailchimpContacts: MailchimpContact[],
  existingEmails: Set<string>
): FilterResult {
  const newContacts: MailchimpContact[] = [];
  let skippedCount = 0;

  for (const contact of mailchimpContacts) {
    const normalizedEmail = contact.email_address.toLowerCase();
    if (existingEmails.has(normalizedEmail)) {
      skippedCount++;
    } else {
      newContacts.push(contact);
    }
  }

  return {
    newContacts,
    skippedCount
  };
}

function formatPhoneNumber(phone: string | undefined): string[] {
  if (!phone) return [];
  return [phone.trim()];
}

function buildFullName(firstName?: string, lastName?: string): string {
  return [firstName, lastName].filter(Boolean).join(' ');
}

export async function syncContactsToDayAi(
  dayClient: DayAIClient,
  contacts: MailchimpContact[],
  options: SyncOptions = {}
): Promise<SyncResult> {
  const { dryRun = false, onProgress } = options;

  const result: SyncResult = {
    total: contacts.length,
    synced: 0,
    failed: 0,
    errors: [],
  };

  for (let i = 0; i < contacts.length; i++) {
    const contact = contacts[i];
    const email = contact.email_address;

    if (onProgress) {
      onProgress(i + 1, contacts.length, email);
    }

    if (dryRun) {
      console.log(`[DRY RUN] Would sync: ${email} (${buildFullName(contact.merge_fields.FNAME, contact.merge_fields.LNAME)})`);
      result.synced++;
      continue;
    }

    try {
      const standardProperties: Record<string, unknown> = {
        email: email,
      };

      if (contact.merge_fields.FNAME) {
        standardProperties.firstName = contact.merge_fields.FNAME;
      }

      if (contact.merge_fields.LNAME) {
        standardProperties.lastName = contact.merge_fields.LNAME;
      }

      const phoneNumbers = formatPhoneNumber(contact.merge_fields.PHONE);
      if (phoneNumbers.length > 0) {
        standardProperties.phoneNumbers = phoneNumbers;
      }

      const response = await dayClient.mcpCallTool('create_or_update_person_organization', {
        objectType: 'native_contact',
        standardProperties,
      });

      if (response.success) {
        result.synced++;
      } else {
        result.failed++;
        result.errors.push({
          email,
          error: response.error || 'Unknown error',
        });
      }
    } catch (error) {
      result.failed++;
      result.errors.push({
        email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
