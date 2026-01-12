# Mailchimp to Day.ai Contact Sync

A simple CLI tool to sync contacts from Mailchimp into Day.ai as people.

## Prerequisites

- Node.js 18+
- A Mailchimp account with API access
- A Day.ai account with OAuth credentials
- The `day-ai-sdk` in a sibling directory (../day-ai-sdk)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure Mailchimp

1. Log in to Mailchimp and go to **Account > Extras > API keys**
2. Create a new API key
3. Note your server prefix (the part after the dash in your API key, e.g., `us1`)

### 3. Configure Day.ai

If you haven't already set up Day.ai OAuth credentials:

```bash
cd ../day-ai-sdk
npm run oauth:setup
```

This will guide you through the OAuth flow and save credentials to `.env`.

### 4. Create your .env file

Copy the example and fill in your credentials:

```bash
cp .env.example .env
```

Edit `.env`:

```env
# Mailchimp Configuration
MAILCHIMP_API_KEY=abc123def456-us1
MAILCHIMP_SERVER_PREFIX=us1

# Day.ai Configuration (copy from day-ai-sdk/.env)
DAY_AI_BASE_URL=https://day.ai
CLIENT_ID=your-client-id
CLIENT_SECRET=your-client-secret
REFRESH_TOKEN=your-refresh-token
```

### 5. Build the project

```bash
npm run build
```

## Usage

### Dry run (preview without making changes)

```bash
npm run sync:dry-run
```

### Run the sync

```bash
npm run sync
```

### Sync a specific Mailchimp list

```bash
node dist/index.js --list=YOUR_LIST_ID
```

## What gets synced

For each Mailchimp contact, the following fields are synced to Day.ai:

| Mailchimp Field | Day.ai Field |
|-----------------|--------------|
| Email Address   | email        |
| FNAME           | firstName    |
| LNAME           | lastName     |
| PHONE           | phoneNumbers |

## Notes

- Contacts are created or updated based on email address matching
- The sync is one-way: Mailchimp -> Day.ai
- Run with `--dry-run` first to preview what will be synced
