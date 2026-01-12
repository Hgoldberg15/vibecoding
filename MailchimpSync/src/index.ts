// =============================================================================
// IMPORTS
// =============================================================================
// 'import' statements bring in code from other files or packages so we can use it here.

// This loads environment variables from a .env file into process.env
// Environment variables are a way to store secrets (like API keys) outside your code
import 'dotenv/config';

// Import the Day.ai SDK client - this is a class that handles all Day.ai API communication
import { DayAIClient } from '../../../day-ai-sdk/dist/src/index.js';

// Import our custom Mailchimp client from a local file (the .js extension is required for ES modules)
import { MailchimpClient } from './mailchimp.js';

// Import our sync functions that handle the actual contact syncing logic
import { syncContactsToDayAi, fetchExistingDayAiEmails, filterNewContacts } from './sync.js';

// =============================================================================
// MAIN FUNCTION
// =============================================================================
// 'async' means this function can use 'await' to pause and wait for things like API calls.
// Without async/await, we'd need complex callback chains or promise .then() calls.

async function main() {
  // ---------------------------------------------------------------------------
  // STEP 1: Parse command-line arguments
  // ---------------------------------------------------------------------------
  // process.argv is an array of command-line arguments passed when running the script
  // Example: "node index.js --dry-run --list=abc123"
  // process.argv would be: ['node', 'index.js', '--dry-run', '--list=abc123']
  // .slice(2) removes the first two items (node and script path), leaving just our args

  const args = process.argv.slice(2);

  // .includes() checks if '--dry-run' exists anywhere in the array (returns true/false)
  const dryRun = args.includes('--dry-run');

  // .find() searches the array and returns the first item that matches the condition
  // This looks for an argument that starts with '--list='
  const listIdArg = args.find(arg => arg.startsWith('--list='));

  // The ?. is "optional chaining" - if listIdArg is undefined, it won't crash
  // .split('=') breaks '--list=abc123' into ['--list', 'abc123']
  // [1] gets the second element (the actual ID)
  const specifiedListId = listIdArg?.split('=')[1];

  console.log('=== Mailchimp to Day.ai Contact Sync ===\n');

  if (dryRun) {
    console.log('[DRY RUN MODE] No changes will be made to Day.ai\n');
  }

  // ---------------------------------------------------------------------------
  // STEP 2: Validate environment variables
  // ---------------------------------------------------------------------------
  // process.env contains all environment variables (from .env file and system)
  // We need these API credentials to connect to Mailchimp

  const mailchimpApiKey = process.env.MAILCHIMP_API_KEY;
  const mailchimpServer = process.env.MAILCHIMP_SERVER_PREFIX;

  // If either variable is missing (undefined or empty string), exit with an error
  // The || operator returns the first "truthy" value, so !mailchimpApiKey is true if it's missing
  if (!mailchimpApiKey || !mailchimpServer) {
    console.error('Error: Missing Mailchimp configuration.');
    console.error('Please set MAILCHIMP_API_KEY and MAILCHIMP_SERVER_PREFIX in your .env file.');
    // process.exit(1) stops the program immediately. Exit code 1 means "error"
    // Exit code 0 means "success" - this is a Unix convention
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // STEP 3: Connect to Mailchimp
  // ---------------------------------------------------------------------------
  // Create a new instance of our MailchimpClient class
  // 'new' creates an object from a class, calling its constructor with these arguments

  console.log('Connecting to Mailchimp...');
  const mailchimp = new MailchimpClient(mailchimpApiKey, mailchimpServer);

  // try/catch is for error handling - if anything inside 'try' throws an error,
  // execution jumps to the 'catch' block instead of crashing the whole program
  try {
    // 'await' pauses here until testConnection() finishes (it makes an API call)
    // This is much cleaner than callback-based code!
    const account = await mailchimp.testConnection();

    // Template literals (backticks) let us embed variables with ${variable}
    console.log(`Connected to Mailchimp account: ${account.account_name} (${account.email})\n`);
  } catch (error) {
    // 'error instanceof Error' checks if it's a proper Error object (with .message property)
    // The ternary operator (condition ? valueIfTrue : valueIfFalse) handles both cases
    console.error('Failed to connect to Mailchimp:', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // ---------------------------------------------------------------------------
  // STEP 4: Connect to Day.ai
  // ---------------------------------------------------------------------------
  // The Day.ai client reads its configuration from environment variables automatically

  console.log('Connecting to Day.ai...');
  const dayClient = new DayAIClient();

  try {
    const connectionTest = await dayClient.testConnection();

    // The Day.ai SDK returns { success: boolean, data?: object, error?: string }
    // We check success to see if the connection worked
    if (!connectionTest.success) {
      // 'throw' creates an error that will be caught by the catch block below
      throw new Error(connectionTest.error || 'Connection test failed');
    }

    // ?. (optional chaining) safely accesses nested properties that might not exist
    // Without it, connectionTest.data.workspace.workspaceName would crash if data is undefined
    console.log(`Connected to Day.ai workspace: ${connectionTest.data?.workspace?.workspaceName}\n`);
  } catch (error) {
    console.error('Failed to connect to Day.ai:', error instanceof Error ? error.message : error);
    console.error('Make sure you have run the Day.ai OAuth setup (yarn oauth:setup in day-ai-sdk)');
    process.exit(1);
  }

  // Initialize the MCP (Model Context Protocol) - required before calling Day.ai tools
  await dayClient.mcpInitialize();

  // ---------------------------------------------------------------------------
  // STEP 5: Fetch available Mailchimp lists (audiences)
  // ---------------------------------------------------------------------------
  // Mailchimp organizes contacts into "lists" (also called "audiences")
  // We need to pick which list to sync from

  console.log('Fetching Mailchimp lists...');
  const lists = await mailchimp.getLists();

  // .length gives us the number of items in an array
  if (lists.length === 0) {
    console.log('No lists found in Mailchimp.');
    process.exit(0); // Exit code 0 = success (nothing to do, but not an error)
  }

  // ---------------------------------------------------------------------------
  // STEP 6: Select which list to sync
  // ---------------------------------------------------------------------------
  // 'let' allows the variable to be reassigned (unlike 'const')
  // We need this because we assign it in different branches of the if/else

  let selectedList;

  if (specifiedListId) {
    // User specified a list ID via --list=XXX argument
    // .find() returns undefined if no match is found
    selectedList = lists.find(l => l.id === specifiedListId);

    if (!selectedList) {
      console.error(`List with ID "${specifiedListId}" not found.`);
      console.log('\nAvailable lists:');

      // .forEach() runs a function for each item in the array
      // Arrow function syntax: (parameters) => { code }
      lists.forEach(list => {
        console.log(`  - ${list.name} (ID: ${list.id}, ${list.member_count} members)`);
      });
      process.exit(1);
    }
  } else {
    // No list specified - show available lists and use the first one
    console.log('\nAvailable Mailchimp lists:');

    // forEach with index: the second parameter is the array index (0, 1, 2, ...)
    lists.forEach((list, index) => {
      console.log(`  ${index + 1}. ${list.name} (ID: ${list.id}, ${list.member_count} members)`);
    });

    // Default to the first list (index 0)
    selectedList = lists[0];
    console.log(`\nUsing list: ${selectedList.name}`);
    console.log('(Use --list=LIST_ID to specify a different list)\n');
  }

  // ---------------------------------------------------------------------------
  // STEP 7: Fetch all contacts from the selected list
  // ---------------------------------------------------------------------------

  console.log(`Fetching contacts from "${selectedList.name}"...`);

  // getAllListMembers takes a callback function for progress updates
  // A callback is a function passed as an argument to be called later
  const contacts = await mailchimp.getAllListMembers(
    selectedList.id,
    // This arrow function is called each time a batch of contacts is fetched
    (fetched, total) => {
      // process.stdout.write() prints without a newline
      // \r is a "carriage return" - moves cursor to start of line (overwrites previous text)
      // This creates a live-updating progress counter on a single line
      process.stdout.write(`\r  Fetched ${fetched}/${total} contacts...`);
    }
  );

  // \n adds a newline since our progress updates didn't include one
  console.log(`\n  Found ${contacts.length} contacts\n`);

  if (contacts.length === 0) {
    console.log('No contacts to sync.');
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // STEP 7.5: Fetch existing Day.ai contacts and filter to new ones only
  // ---------------------------------------------------------------------------
  // We only want to sync contacts that don't already exist in Day.ai.
  // This prevents duplicate entries and reduces unnecessary API calls.

  console.log('Fetching existing Day.ai contacts...');

  const existingContacts = await fetchExistingDayAiEmails(
    dayClient,
    (fetched, hasMore) => {
      const status = hasMore ? '...' : ' (complete)';
      process.stdout.write(`\r  Fetched ${fetched} existing contacts${status}`);
    }
  );

  console.log(`\n  Found ${existingContacts.totalFetched} existing contacts in Day.ai\n`);

  // Filter Mailchimp contacts to only include new ones (not already in Day.ai)
  const { newContacts, skippedCount } = filterNewContacts(contacts, existingContacts.emails);

  console.log(`  Mailchimp contacts: ${contacts.length}`);
  console.log(`  Already in Day.ai (will skip): ${skippedCount}`);
  console.log(`  New contacts to sync: ${newContacts.length}\n`);

  if (newContacts.length === 0) {
    console.log('All contacts already exist in Day.ai. Nothing to sync.');
    process.exit(0);
  }

  // ---------------------------------------------------------------------------
  // STEP 8: Sync contacts to Day.ai
  // ---------------------------------------------------------------------------

  console.log('Syncing new contacts to Day.ai...\n');

  // Call our sync function, passing in configuration as an object
  // Object shorthand: { dryRun } is the same as { dryRun: dryRun }
  const result = await syncContactsToDayAi(dayClient, newContacts, {
    dryRun,
    // onProgress is another callback function for tracking sync progress
    onProgress: (current, total, email) => {
      // .padEnd(40) adds spaces to make the string 40 characters long
      // This prevents visual glitches when shorter emails follow longer ones
      process.stdout.write(`\r  Progress: ${current}/${total} - ${email.padEnd(40)}`);
    },
  });

  // ---------------------------------------------------------------------------
  // STEP 9: Display results
  // ---------------------------------------------------------------------------

  console.log('\n\n=== Sync Complete ===');
  console.log(`  Total Mailchimp contacts: ${contacts.length}`);
  console.log(`  Skipped (already in Day.ai): ${skippedCount}`);
  console.log(`  Successfully synced: ${result.synced}`);
  console.log(`  Failed: ${result.failed}`);

  // Only show errors section if there were any
  if (result.errors.length > 0) {
    console.log('\nErrors:');

    // Destructuring in forEach: { email, error } extracts those properties from each object
    // Same as writing: (item) => { const email = item.email; const error = item.error; ... }
    result.errors.forEach(({ email, error }) => {
      console.log(`  - ${email}: ${error}`);
    });
  }
}

// =============================================================================
// RUN THE PROGRAM
// =============================================================================
// Call main() and handle any uncaught errors
// .catch() is called if main() throws an error that wasn't caught inside it

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
