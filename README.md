# Automazione Mail Megaron — Mail → Lead (Gestim + Google Sheets)

Servizio **Node.js 20+** (TypeScript) che:

1. Legge la posta (**Microsoft Graph** + worker in loop, oppure **webhook HTTP**).
2. Estrae **ID annuncio** dal corpo/HTML.
3. Risolve l’annuncio tramite **API** Render o **PostgreSQL** (`gestim_listings`).
4. Legge la **zona** e instrada sul **tab Google Sheet** corretto (mapping da env JSON **oppure** da foglio `mapping` colonne A–B).
5. **Appende** righe lead con colonne: **Email**, **ID annuncio**, **Data assegnazione**, **Telefono**, **Zona**.
6. Regole ID: `0` ID -> tab `no-id-trovato`, `>1` ID -> tab `no-singolo-id`, `1` ID -> lookup `gestim_listings.id_annuncio_gestim` e routing per zona.
7. Regola anti-duplicato: una email già assegnata viene **skippata per 6 mesi** in base alla data presente in colonna **C** (su tutti i tab usati dal routing); dopo 6 mesi viene assegnata di nuovo con nuova data in C.

## Stack

| Componente | Scelta |
|------------|--------|
| Runtime | Node.js ≥ 20 |
| Linguaggio | TypeScript (ESM) |
| HTTP | Express (`POST /webhooks/inbound-email`, `GET /health`) |
| Posta Outlook / Microsoft 365 | Microsoft Graph API (`src/graph/`) |
| Log | pino |
| Validazione env | zod |
| DB (opzionale) | `pg` → `gestim_listings` |
| Fogli | Google Sheets API v4, **service account** |
| Test | Vitest |

## Token Microsoft Graph (posta in arrivo)

Non serve un token “manuale” persistente: l’app ottiene un **access token OAuth 2.0** con **client credentials** (come JospaAutomation).

1. Registra un’**app in Azure AD** (Entra ID): recupera **Tenant ID**, **Client ID**, **Client secret**.
2. Aggiungi permesso applicazione **Microsoft Graph → Mail.Read** (o più restrittivo se la policy lo consente). **Admin consent** sul tenant obbligatorio per i permessi *application*.
3. A runtime il worker esegue `POST` su  
   `https://login.microsoftonline.com/{TENANT_ID}/oauth2/v2.0/token`  
   con body (form):  
   `grant_type=client_credentials&client_id=...&client_secret=...&scope=https://graph.microsoft.com/.default`
4. Con la risposta JSON usi `access_token` nelle chiamate `Authorization: Bearer …` verso Graph, ad esempio:  
   `GET /v1.0/users/{MAILBOX_USER}/mailFolders/inbox/messages?$filter=receivedDateTime ge ...`

Il codice è in `src/graph/microsoftGraph.ts` (`getGraphAccessToken`, `listInboxMessagesSince`, `getMessageDetail`).

## Worker su Render (polling ogni X minuti)

- Comando: `npm run start:worker` → `src/worker.ts`.
- Variabile `WORKER_POLL_INTERVAL_MINUTES` (default **60**).
- Deduplica: tab configurabile `GRAPH_STATE_SHEET_NAME` (default `_graph_processed`), colonna A = **id messaggio Graph** già elaborati (nel file `GRAPH_STATE_SPREADSHEET_ID` o, se omesso, nello stesso spreadsheet del mapping).
- Esempio `render.yaml` in repo.

## Google Cloud / Sheets e “ruolo IAM” per il service account

Per **Google Sheets** non si assegna di solito un “ruolo IAM” tipo AWS sul file Drive:

1. Nel progetto GCP abilita **Google Sheets API**.
2. Crea un **service account** e una **chiave JSON**.
3. **Condividi** ogni spreadsheet (incluso quello con il tab `mapping` e i tab zona) con l’email del service account (`…@….iam.gserviceaccount.com`) come **Editor**.

L’accesso ai fogli è regolato dalla **condivisione Drive** + scope API `https://www.googleapis.com/auth/spreadsheets`.  
Ruoli IAM GCP sul service account (es. *Editor* sul progetto) servono per gestire risorse Google Cloud, **non** per autorizzare Drive dei fogli: lì conta la condivisione del file.

## Mappa zona → foglio

**Opzione A — Foglio Google “mapping” (senza header)**  
Variabili: `MAPPING_SPREADSHEET_ID`, `MAPPING_SHEET_NAME` (es. `mapping`).  
Colonna **A** = testo zona (match con `MAPPING_ZONE_MATCH`: `contains` o `equals`), colonna **B** = **nome del tab** nello **stesso** file dove scrivere i lead.  
`DEFAULT_SPREADSHEET_ID` può essere omesso: viene usato `MAPPING_SPREADSHEET_ID`.

**Opzione B — JSON in env**  
`ZONE_SHEET_MAP_JSON` con `spreadsheetId` e `sheetTitle` per regola (come prima). Richiede `DEFAULT_SPREADSHEET_ID` se non usi la opzione A.

## Variabili d’ambiente (estratto)

| Variabile | Descrizione |
|-----------|-------------|
| `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET` | Azure AD (worker) |
| `MAILBOX_USER` | Casella da leggere (UPN, es. `megaron@dominio.it`) |
| `GRAPH_LOOKBACK_HOURS` | Finestra messaggi da rileggere (default 24) |
| `WORKER_POLL_INTERVAL_MINUTES` | Intervallo tra cicli (default 60) |
| `LISTING_SOURCE` | `api` \| `database` |
| `MAPPING_SPREADSHEET_ID` / `MAPPING_SHEET_NAME` | Mapping A→B da foglio |
| `ZONE_SHEET_MAP_JSON` | Alternativa JSON |
| `DEFAULT_SHEET_TITLE` | Tab fallback |
| `GOOGLE_APPLICATION_CREDENTIALS` o `GOOGLE_SERVICE_ACCOUNT_JSON` | Service account |

Elenco completo: `.env.example`.

## Ingresso webhook (alternativa)

`POST /webhooks/inbound-email` — vedi `src/http/parseWebhookBody.ts`.

## Avvio

```bash
cp .env.example .env
npm install
npm run build
npm start                 # solo HTTP
npm run start:worker      # solo worker Graph + lead
```

## Test

```bash
npm test
```

## Licenza

Uso interno / progetto cliente — adatta come necessario.
