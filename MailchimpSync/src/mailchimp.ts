export interface MailchimpContact {
  id: string;
  email_address: string;
  status: string;
  merge_fields: {
    FNAME?: string;
    LNAME?: string;
    PHONE?: string;
    ADDRESS?: {
      addr1?: string;
      addr2?: string;
      city?: string;
      state?: string;
      zip?: string;
      country?: string;
    };
    [key: string]: unknown;
  };
  tags: Array<{ id: number; name: string }>;
  timestamp_signup: string;
  timestamp_opt: string;
  last_changed: string;
}

export interface MailchimpList {
  id: string;
  name: string;
  member_count: number;
}

export interface MailchimpListsResponse {
  lists: MailchimpList[];
  total_items: number;
}

export interface MailchimpMembersResponse {
  members: MailchimpContact[];
  total_items: number;
}

export class MailchimpClient {
  private apiKey: string;
  private serverPrefix: string;
  private baseUrl: string;

  constructor(apiKey: string, serverPrefix: string) {
    this.apiKey = apiKey;
    this.serverPrefix = serverPrefix;
    this.baseUrl = `https://${serverPrefix}.api.mailchimp.com/3.0`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const auth = Buffer.from(`anystring:${this.apiKey}`).toString('base64');

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mailchimp API error (${response.status}): ${errorText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<{ account_name: string; email: string }> {
    return this.request('/');
  }

  async getLists(): Promise<MailchimpList[]> {
    const response = await this.request<MailchimpListsResponse>('/lists?count=100');
    return response.lists;
  }

  async getListMembers(
    listId: string,
    options: { count?: number; offset?: number; status?: string } = {}
  ): Promise<{ members: MailchimpContact[]; totalItems: number }> {
    const { count = 100, offset = 0, status } = options;

    let endpoint = `/lists/${listId}/members?count=${count}&offset=${offset}`;
    if (status) {
      endpoint += `&status=${status}`;
    }

    const response = await this.request<MailchimpMembersResponse>(endpoint);
    return {
      members: response.members,
      totalItems: response.total_items,
    };
  }

  async getAllListMembers(
    listId: string,
    onProgress?: (fetched: number, total: number) => void
  ): Promise<MailchimpContact[]> {
    const allMembers: MailchimpContact[] = [];
    let offset = 0;
    const count = 100;
    let totalItems = 0;

    do {
      const { members, totalItems: total } = await this.getListMembers(listId, { count, offset });
      totalItems = total;
      allMembers.push(...members);
      offset += count;

      if (onProgress) {
        onProgress(allMembers.length, totalItems);
      }
    } while (allMembers.length < totalItems);

    return allMembers;
  }
}
