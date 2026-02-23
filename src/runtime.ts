import "dotenv/config";
import { ManagedRuntime } from "effect";
import { MainLayer } from "./layers/main.js";

export const runtime = ManagedRuntime.make(MainLayer);
