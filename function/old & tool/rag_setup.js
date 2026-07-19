import "dotenv/config";
import fs from "fs";
import OpenAI from "openai";

const openai = new OpenAI();

const knowledgeFiles = [
  "knowledge/project.md",
  "knowledge/data-dictionary.md",
  "knowledge/seattle-market.md",
];

async function main() {
  const vectorStore = await openai.vectorStores.create({
    name: "3D Map Knowledge Base",
  });

  console.log("Vector store created:", vectorStore.id);

  for (const filePath of knowledgeFiles) {
    if (!fs.existsSync(filePath)) {
      console.warn(`Skipped missing file: ${filePath}`);
      continue;
    }

    const file = await openai.files.create({
      file: fs.createReadStream(filePath),
      purpose: "assistants",
    });

    await openai.vectorStores.files.create(vectorStore.id, {
      file_id: file.id,
    });

    console.log(`Uploaded: ${filePath}`);
  }

  console.log("\nAdd this value to .env:");
  console.log(`OPENAI_VECTOR_STORE_ID=${vectorStore.id}`);
}

main().catch((error) => {
  console.error("RAG setup failed:", error);
  process.exit(1);
});