import type { ScannerModule } from "../types.js";
import { dnsModule } from "./dns.js";
import { emailSecurityModule } from "./email-security.js";
import { headersModule } from "./headers.js";
import { portsModule } from "./ports.js";
import { techModule } from "./tech.js";
import { tlsModule } from "./tls.js";

/** Registry of scanner modules. Add a new check by implementing ScannerModule and listing it here. */
export const SCANNER_MODULES: ScannerModule[] = [
  dnsModule,
  emailSecurityModule,
  tlsModule,
  headersModule,
  portsModule,
  techModule,
];

export const moduleById = (id: string) => SCANNER_MODULES.find((m) => m.id === id);
