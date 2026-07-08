# 🚀 WebFlowMaster

[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](https://github.com/Markg981/WebFlowMaster)
[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/Markg981/WebFlowMaster)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TS-5.6-blue.svg)](https://www.typescriptlang.org/)

> **WebFlowMaster** è la piattaforma enterprise per il test automation end-to-end. Combina un Visual Builder intuitivo con un potente motore di esecuzione basato su Playwright e Puppeteer per garantire la massima affidabilità delle tue applicazioni web.

---

## 🌟 Elevator Pitch
Dimentica script fragili e manutenzione infinita. Con WebFlowMaster, il tuo team QA può creare test complessi in pochi minuti grazie al **No-Code Visual Builder**, registrarli in tempo reale e monitorarli attraverso dashboard analitiche avanzate. È la soluzione definitiva per integrare il testing di alta qualità nel tuo ciclo di CI/CD.

---

## 🛠️ Stack Tecnologico

| Layer | Tecnologie |
| :--- | :--- |
| **Frontend** | React, TypeScript, Vite, TailwindCSS, Shadcn/UI |
| **Backend** | Node.js, Express, Passport.js |
| **Database** | PostgreSQL (produzione), PGlite (sviluppo locale), Drizzle ORM |
| **Automation** | Playwright, Puppeteer |
| **Task Queue** | BullMQ, Redis, Node-cron |
| **Logging** | Winston |

---

## 📋 Prerequisiti
Assicurati di avere installato sul tuo sistema:
- **Node.js** (v20 o superiore)
- **npm** (v10 o superiore)
- **Redis** (necessario per BullMQ e sessioni)
- **PostgreSQL** (o SQLite per sviluppo locale)

---

## 🚀 Installazione Locale

1. **Clona il repository:**
   ```bash
   git clone https://github.com/Markg981/WebFlowMaster.git
   cd WebFlowMaster
   ```

2. **Installa le dipendenze della root e del client:**
   ```bash
   npm install
   npm run install-client
   ```

3. **Configura le variabili d'ambiente:**
   Crea un file `.env` nella root del progetto partendo dal template (vedi sezione sotto).

4. **Inizializza il database:**
   ```bash
   npm run db:push
   ```

5. **Avvia l'ambiente di sviluppo:**
   Apri due terminali e lancia:
   - **Terminale 1 (Backend & Worker):** `npm run dev`
   - **Terminale 2 (Frontend):** `npm run dev:client`

---

## ⚙️ Variabili d'Ambiente (.env)
Copia il template [`.env.example`](./.env.example) in `.env` e valorizza i parametri:

```env
# Database: connection string Postgres OPPURE percorso data dir PGlite locale
DATABASE_URL=./data/local-pg

# Redis (Sessioni e Worker BullMQ)
REDIS_URL=redis://localhost:6379

# Autenticazione — genera con:
#   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=change-me

# Chiave 32-byte (64 hex) per cifrare i secrets salvati (AES-256-GCM)
ENCRYPTION_KEY=change-me-64-hex-characters

# AI Self-Healing (opzionale): senza chiave le funzioni AI sono disabilitate
GEMINI_API_KEY=

# Logging
LOG_LEVEL=info
```

---

## 🧪 Testing
Per eseguire la suite di test completa:
```bash
npm run test
```
Per i test del client:
```bash
npm run test:client
```

---

## 📂 Struttura della Documentazione
Per approfondimenti, consulta la cartella `docs/`:
- [**User Guide**](./docs/USER_GUIDE.md): Manuale per tester e QA Engineer.
- [**Architecture**](./docs/ARCHITECTURE.md): Design tecnico, schema DB e AI Self-Healing.
- [**API Reference**](./docs/API_REFERENCE.md): Riferimento degli endpoint REST.
- [**Contributing**](./docs/CONTRIBUTING.md): Linee guida per contribuire.

---

## 🤝 Contribuire
Siamo aperti a contributi! Se vuoi migliorare WebFlowMaster:
1. Forka il progetto.
2. Crea un branch per la tua feature (`git checkout -b feature/AmazingFeature`).
3. Fai il commit delle modifiche (`git commit -m 'Add some AmazingFeature'`).
4. Pusha il branch (`git push origin feature/AmazingFeature`).
5. Apri una Pull Request.

---

Developed with ❤️ by the **WebFlowMaster Team**.
