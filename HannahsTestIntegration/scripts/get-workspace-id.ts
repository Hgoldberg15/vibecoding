#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import { DayAIClient } from "../../../day-ai-sdk/src/client.ts";

// Load environment variables
dotenv.config();

async function main() {
  console.log("🔍 Fetching Workspace ID...\n");

  try {
    // Initialize the client (loads from .env automatically)
    const client = new DayAIClient();

    // Get workspace metadata
    const metadata = await client.getWorkspaceMetadata();

    if (!metadata.success) {
      console.error("❌ Failed to get workspace metadata:", metadata.error);
      process.exit(1);
    }

    const { workspaceId, workspaceName, userId } = metadata.data;

    console.log("✅ Workspace info retrieved!");
    console.log(`   Workspace Name: ${workspaceName}`);
    console.log(`   Workspace ID: ${workspaceId}`);
    console.log(`   User ID: ${userId}\n`);

    // Check if --save flag was passed
    if (process.argv.includes("--save")) {
      console.log("💾 Saving WORKSPACE_ID to .env file...");
      updateEnvFile(workspaceId);
      console.log("✅ .env file updated!\n");
    } else {
      console.log("💡 Tip: Run with --save to save WORKSPACE_ID to your .env file");
    }

  } catch (error) {
    console.error(
      "❌ Failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

function updateEnvFile(workspaceId: string) {
  const envPath = path.join(process.cwd(), ".env");
  let envContent = "";

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, "utf8");
  }

  const regex = /^WORKSPACE_ID=.*$/m;
  if (envContent.match(regex)) {
    envContent = envContent.replace(regex, `WORKSPACE_ID=${workspaceId}`);
  } else {
    envContent += `\nWORKSPACE_ID=${workspaceId}`;
  }

  fs.writeFileSync(envPath, envContent.trim() + "\n");
}

// Run
main().catch(console.error);
