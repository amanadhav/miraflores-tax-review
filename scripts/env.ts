import { config } from "dotenv";

// Next.js reads .env.local on its own; standalone scripts need the same files.
config({ path: [".env.local", ".env"] });
